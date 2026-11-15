# 极客记账与预算管理系统：PRD 逆向对比与最新事实数据字典（V2）

> **文档说明**：本文档基于最初的《极客大学生专属：个人记账与预算管理系统需求规格说明书（PRD）与 SQL 架构》（[prd.md](file:///c:/Users/Faneter/Documents/Projects/ledger/prd.md)），全面扫描当前 Web 项目实际落地的核心领域模型与算法（[types.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/core/src/types.ts)、[allocation.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/core/src/allocation.ts)、[dsl-parser.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/core/src/dsl-parser.ts)、[mastercard-fx.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/core/src/mastercard-fx.ts)）、SQLite 数据库 Schema 与仓储层（[schema.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/db/src/schema.ts)、[ledger-repository.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/db/src/ledger-repository.ts)）、后端 REST API（[app.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/apps/server/src/app.ts)）、离线优先状态引擎（[local-replica.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/apps/client/src/sync/local-replica.ts)）及前端组件（[apps/client/src/components](file:///c:/Users/Faneter/Documents/Projects/ledger/apps/client/src/components)），逆向对比输出系统的真实工程落地状态（不涉及 UI 样式细节）。

---

## 一、【完整保留的核心机制】

当前系统已前后端全链路演进为**「彻底去账户化、纯月度预算池与专项预算驱动」**的记账与预算管控系统。原 PRD 中的**四大月度预算池、跨品类凑单满减分摊算法、有偿立减金购券成本结转、外币预授权冻结与清算返现两阶段状态机、极速记账 DSL 解析器及周期性扣款规则**作为核心机制被完整保留。以下为各机制在当前代码中的**实际生效字段名**与实现位置：

### 1.1 核心财务不变量（Financial Invariants）
| 核心公理 | 原 PRD 定义 | 当前代码落地实现与实际字段名 | 核心代码位置 |
| :--- | :--- | :--- | :--- |
| **本位币锚定原则** | 以人民币（`CNY`）为唯一记账本位币；外币入账最终锁定 `CNY` 净额。 | 全链路使用 `Decimal.js`（`ROUND_HALF_UP` 四舍五入），金额固定保留 2 位小数（`roundCny` / `formatCny`），汇率固定保留 6 位小数（`formatRate`）。外币流水在 `transaction_headers` 中记录 `original_currency`、`original_amount`、`exchange_rate`，并最终锁定人民币 `total_gross`、`payment_discount`、`total_net`。 | [allocation.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/core/src/allocation.ts) |
| **订单头与明细行守恒定律** | $\sum \text{Item Gross} = \text{Header Gross}$<br>$\sum \text{Item Net} = \text{Header Net}$ | 在 `computeOrderAllocation`、`recordTransaction` 及 `updateTransaction` 中强制校验：所有明细行 `transaction_items.item_gross` 之和严格等于单据头 `transaction_headers.total_gross`；明细行 `transaction_items.item_net` 之和严格等于单据头预算口径净额（无有偿券成本结转时严格等于 `transaction_headers.total_net`），偏差超出容差即抛出 `Conservation law violated` 异常拒绝入库。 | [allocation.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/core/src/allocation.ts)<br>[ledger-repository.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/db/src/ledger-repository.ts) |

---

### 1.2 四大月度常规预算池与专项预算互斥隔离（Budget Pools & Project Tags）
- **四大月度预算池（`budget_pools`，[schema.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/db/src/schema.ts#L10-L29)，均设 `is_monthly_budget = 1`）**：
  1. `POOL_FIXED`（`pool_type = 'FIXED'`）：固定刚需与定投池（房租、宽带、话费、游戏月卡）。
  2. `POOL_DAILY`（`pool_type = 'DAILY'`）：高频生活池（三餐、零食、水饮、日常洗护），支持**动态日均可用额**计算：
     $$\text{Daily Allowance} = \frac{\text{Remaining Budget}}{\max(1, \text{DaysInMonth} - \text{CurrentDay} + 1)}$$
  3. `POOL_FLEX`（`pool_type = 'FLEX'`）：月度弹性发展池（服饰、日用百货、单片机电路、软件外设、交通资料、考证学习与大件支出默认归属池）。
  4. `POOL_EMERGENCY`（`pool_type = 'EMERGENCY'`）：纯粹医疗与突发意外维修池。
- **月度额度快照与视图口径（`monthly_budgets` [schema.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/db/src/schema.ts#L47-L57) & `v_monthly_budget_status` [schema.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/db/src/schema.ts#L240-L260)）**：
  - 实际表字段：`year_month`、`pool_id`、`base_allocation`（月初基准分配额）、`rollover_from_prev`（上月结余滚入/超支扣减）、`reserved_fixed`、`swept_to_fund`、`note`。
  - 视图计算列：`total_available_budget = base_allocation + rollover_from_prev`；`remaining_budget = base_allocation + rollover_from_prev - swept_to_fund - spent_net`。
- **跨期专项预算（`projects_and_tags`）与月度池互斥隔离**：
  - 记账时支出归属在「月度预算资金池（`budget_pool_id`）」与「专项预算（`project_tag_id`）」之间二选一。凡绑定了非空 `project_tag_id` 的明细行，仅计入对应专项预算支出进度（`target_budget`），并在 `v_monthly_budget_status` / `getMonthlyBudgetStatus` 统计中自动豁免月度常规资金池扣减。

---

### 1.3 跨品类凑单满减分摊与尾差修正引擎（Split Allocation Engine）
在 [allocation.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/core/src/allocation.ts) 中完整实现了 `allocateSplitDiscounts` 与 `computeOrderAllocation`，支持原 PRD 定义的全部 4 种 `AllocationMode`（`transaction_headers.allocation_mode`）：

1. **`'SINGLE'`（单品无拆分）**：单明细行直接承接整单 `total_gross`、`allocated_discount` 与 `item_net`。
2. **`'PROPORTIONAL'`（按原价等比分摊 + 尾差兜底）**：
   - 前 $N-1$ 个子项按原价权重比例计算并四舍五入：
     $$\text{Allocated Discount}_i = \text{round\_half\_up}\left(\text{Total Discount} \times \frac{\text{Item Gross}_i}{\text{Total Gross}}, 2\right)$$
   - 第 $N$ 个（最后一项）子项采用减法兜底吸收 `0.01` 元精度尾差：
     $$\text{Allocated Discount}_N = \text{Total Discount} - \sum_{i=1}^{N-1} \text{Allocated Discount}_i$$
3. **`'PRIMARY_ITEM'`（主商品独占优惠）**：标记 `is_primary_item = 1`（或在 DSL 中以 `*` / `!` 开头）的子项独占 `100%` 的 `totalDiscount`，其余凑单品按原价（`allocated_discount = '0.00', item_net = item_gross`）入账。
4. **`'MANUAL'`（手动指定各子项净额）**：校验用户指定的各子项净额之和严格等于整单目标净额。

---

### 1.4 有偿立减金与免费优惠券卡包闭环（Voucher Wallet Lifecycle）
在 `vouchers` 表（[schema.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/db/src/schema.ts#L79-L96)）、[allocation.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/core/src/allocation.ts)、[AccountMatrixPanel.tsx](file:///c:/Users/Faneter/Documents/Projects/ledger/apps/client/src/components/AccountMatrixPanel.tsx)、[ledger-repository.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/db/src/ledger-repository.ts) 及 [local-replica.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/apps/client/src/sync/local-replica.ts) 中完整实现了两类核心消费券（`voucher_type`: `'PREPAID_COUPON' | 'FREE_COUPON'`）的生命周期：

1. **阶段一：有偿购券入库（`buyVoucher` / `tx_type = 'VOUCHER_BUY'`）**
   - 当 `acquire_cost > 0` 时，自动生成一笔 `tx_type = 'VOUCHER_BUY'` 的购券支出流水（`total_gross = acquire_cost`, `total_net = acquire_cost`, `items = []`），**购券当下不扣减任何月度预算池**；同时在 `vouchers` 表插入 `status = 'AVAILABLE'` 的卡券并关联 `purchase_tx_id`。
2. **阶段二：消费核销与购券成本结转**
   - 强制校验卡券 `status === 'AVAILABLE'`，且订单折合人民币总原价 `total_gross >= min_spend`（不满足门槛时前端下拉项禁用、服务端与本地引擎均抛错拦截）。
   - **购券成本结转公式**：将购券实付成本 $C_{\text{cost}}$（`acquire_cost`）结转计入本次消费的预算池净支出：
     $$\text{Effective Budget Net} = P_{\text{cash}} + C_{\text{cost}}, \quad \text{Payment Discount} = V_{\text{face}} - C_{\text{cost}}$$

---

### 1.5 外币 102% 预授权冻结与返现清算两阶段状态机（FX Pre-hold & Settlement）
在 [mastercard-fx.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/core/src/mastercard-fx.ts) 中通过 `processMastercardFxLifecycle` 完整落地，并彻底解耦为全账本通用的外币记账状态机：

- **阶段一：外币消费预授权挂起（`settlement_status = 'PENDING_HOLD'`）**
  - 记录外币原价 `original_currency`、`original_amount`，以及按冻结比例（全局默认 `1.020`，支持单笔覆盖）计算的预授权冻结人民币金额 `hold_amount_cny`。
  - **预算池预扣**：按剔除预授权溢价后的基准额计算预估返现并预先扣减预算池：
    $$\text{Estimated Base} = \text{round}\left(\frac{\text{Hold Amount}}{\text{Hold Ratio}}, 2\right), \quad \text{Provisional Net} = \text{Estimated Base} - \text{round}(\text{Estimated Base} \times r_{\text{cashback}}, 2)$$
- **阶段二：正式清算入账与多退少补（`settlement_status = 'SETTLED'`）**
  - 在概览页待清算列表输入银行最终清算人民币金额 `settledAmountCny`（优先读取该笔单据记录的 `fx_cashback_rate`，亦支持清算时显式覆盖）。
  - **预算池与单据修正**：释放原 `hold_amount_cny` 归 `'0.00'`，锁定 `total_gross = settledAmountCny`、`payment_discount = round(settledAmountCny * cashbackRate)`、`total_net = settledAmountCny - payment_discount`，反推锁定 6 位真实汇率 `exchange_rate = formatRate(settledAmountCny / original_amount)`，同步更新 `transaction_items` 与月度预算池水位。

---

### 1.6 极速记账 DSL 解析器与周期性扣款规则
- **极速记账 DSL 解析器（[dsl-parser.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/core/src/dsl-parser.ts)）**：
  - 手写词法分析器与递归下降四则运算解析器，返回 `QuickParseDslResult`（通过 `is_fx_detected` 标记外币消费检测结果），支持：
    1. 单品/多品四则运算公式：`16.8-0.15 + 20-1.08*3 #饮食`
    2. 跨池凑单 + 实付覆盖 + 主商品独占优惠：`*单片机 35 #硬件 + 抽纸 15 #日用 = 40`
    3. 外币预授权速记：`$4.35 冻结31.95 #数字服务`
    4. 通过 `#资金池名称`、`#专项名称` 或 `#商品分类关键词` 路由预算归属。
- **周期性扣款规则（`recurring_rules`，[schema.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/db/src/schema.ts#L178-L193) & `executeRecurringRule`）**：
  - 支持配置 `rule_type`（`'FIXED_EXPENSE' | 'FX_SUBSCRIPTION'`）与 `cron_cycle`（`'MONTHLY' | 'YEARLY'`）的人民币或外币周期性支出规则，绑定目标月度预算池，一键手动触发生成对应 `EXPENSE` 消费流水。

---

## 二、【被删减或简化的需求（Deprecated / Simplified）】

对比原 `prd.md` 与当前实际代码，以下模块在演进中已被**前后端彻底移除或业务简化**：

### 2.1 【核心架构变更】账户体系（`accounts`）、内部转账（`TRANSFER`）、还款券（`REPAY_COUPON`）与定投规则（`AUTO_INVEST`）已前后端彻底清理
在前期前端 UI 解耦之后，当前代码库已完成**全栈前后端物理清理**，系统不再维护任何资金账户余额或借贷负债实体：

| 维度 | 清理前遗留状态 | 当前前后端真实落地状态（已彻底清除） |
| :--- | :--- | :--- |
| **数据库表与视图** | `schema.ts` 保留 `accounts` 表、`v_account_dashboard` 视图以及 `transaction_headers` / `recurring_rules` 中的 `account_id`、`target_account_id` 外键列。 | `schema.ts` 已物理删除 `accounts` 表与 `v_account_dashboard` 视图；`transaction_headers` 与 `recurring_rules` 已彻底移除 `account_id`、`target_account_id`；`LedgerRepository.ensureSchemaMigrations()` 在打开存量库时自动执行原子重建迁移并删表删视图。 |
| **领域模型与算法** | `@ledger/core` 定义了 `Account*` 类型、`DEFAULT_ACCOUNTS`、`ACCOUNT_ALIASES`、`resolveAccount`、`TRANSFER`、`REPAY_COUPON`、`AUTO_INVEST` 及 `'ACCOUNT'` 同步实体，且存在 `balance-recalculator.ts`。 | 以上账户类型、映射、枚举与 `packages/db/src/balance-recalculator.ts` **已全部物理删除**；`dsl-parser.ts` 中 `should_wake_fx_account` 已重命名为与账户无关的 `is_fx_detected`；`SyncEntityType`（[types.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/core/src/types.ts#L364-L373)）不再包含 `'ACCOUNT'`。 |
| **后端 API 与仓储层** | `app.ts` 暴露 `/api/accounts*`；`ledger-repository.ts` 在写入时静默回退默认 `'ACC_UNION_MAIN'` 并触发全账本余额重算。 | [app.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/apps/server/src/app.ts) 已彻底删除 `/api/accounts`、`/api/accounts/:id/initial-balance`、`/api/accounts/:id/calibrate`、`/api/accounts/:id/market-value`、`/api/accounts/:id` 及 `GET /api/state` / `POST /api/sync/reseed` 中的 `accounts` 字段；[ledger-repository.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/db/src/ledger-repository.ts) 已移除全部账户 CRUD 与重算方法。 |
| **前端状态与页面** | `LocalLedgerEngine` 仍持有 `accounts`、`SEED_ACCOUNTS`、`CLEAN_SEED_ACCOUNTS` 并在后台执行 `recalculateAllBalances`。 | [local-replica.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/apps/client/src/sync/local-replica.ts) 已彻底移除 `accounts` 状态字段、种子数组与账户操作方法；UI 仅保留导航状态键 `'accounts'` 用于渲染「卡包与周期」页面（[AccountMatrixPanel.tsx](file:///c:/Users/Faneter/Documents/Projects/ledger/apps/client/src/components/AccountMatrixPanel.tsx)，仅包含优惠券卡包与周期性扣款）；[OverviewPage.tsx](file:///c:/Users/Faneter/Documents/Projects/ledger/apps/client/src/components/OverviewPage.tsx)、[QuickInputBar.tsx](file:///c:/Users/Faneter/Documents/Projects/ledger/apps/client/src/components/QuickInputBar.tsx)、[TransactionsView.tsx](file:///c:/Users/Faneter/Documents/Projects/ledger/apps/client/src/components/TransactionsView.tsx) 已清除所有 `TRANSFER` / `REPAY_COUPON` 残留引用。 |

---

### 2.2 固定资产折旧看板（`fixed_assets`）与分类管理 UI 从前端移除（后端仍保留底层表与路由）
- **原 PRD 设计（模块 5 & 表 9）**：独立追踪大件固定资产（如 iPhone、笔记本）的持有天数、二手回血与日均折旧成本，并提供多级商品分类树管理 UI。
- **当前落地现状**：
  - [BudgetPoolsDashboard.tsx](file:///c:/Users/Faneter/Documents/Projects/ledger/apps/client/src/components/BudgetPoolsDashboard.tsx) 已移除「固定资产折旧」与「商品分类管理」界面，仅保留「月度预算资金池」与「专项预算」。
  - **后端/存储保留**：`fixed_assets` 与 `categories` 表、后端 `/api/fixed-assets` 与 `/api/categories` 接口、以及 `local-replica.ts` 中的 `fixedAssets` / `categories` 数组仍保留（其中 `categories.keywords` 仍用于为 DSL 极速记账提供 `#关键词` 自动匹配资金池的能力）。

---

### 2.3 蓄水池 `POOL_FUND` / `POOL_ASSET` 与 `/api/budgets/sweep-to-fund` 彻底清理
- **原 PRD 设计（2.2 节 & 12.2 节）**：在 `budget_pools` 表中预设 6 个资金池（含 `POOL_FUND` 年度专项考证基金池、`POOL_ASSET` 数码大件固定资产库），并提供将高频生活池月末结余一键划入 `POOL_FUND` 的能力。
- **当前落地现状（前后端均已清理）**：
  - `packages/db/src/schema.ts` 的 `SEED_SQL` 与前端 `CLEAN_SEED_BUDGET_POOLS` **仅初始化四大核心月度池**（`POOL_FIXED`、`POOL_DAILY`、`POOL_FLEX`、`POOL_EMERGENCY`）；`CAT_EXAM_CERT`、`CAT_MAJOR_ASSET`、`TAG_JLPT_N2` 的默认关联池已统一重映射为 `'POOL_FLEX'`。
  - `apps/server/src/app.ts` 已删除 `POST /api/budgets/sweep-to-fund` 路由；`LedgerRepository` 与 `LocalLedgerEngine` 已删除 `sweepDailyPoolToSinkingFund` / `sweepDailyToFund`。
  - 存量数据库通过 `ensureSchemaMigrations()`、历史 JSON 备份导入与增量同步逻辑自动清理未被引用的 `POOL_FUND` 与 `POOL_ASSET`。

---

### 2.4 月末结余滚存默认策略统一与周期性规则触发简化
- **月末结余滚存默认策略变更**：四个初始月度资金池（`POOL_FIXED`、`POOL_DAILY`、`POOL_FLEX`、`POOL_EMERGENCY`）的默认 `rollover_strategy` 已全部统一为 **`'ACCUMULATE'`（默认结余滚存到下月）**；前端仅提供 `'ACCUMULATE'` 与 `'RESET'`（月末清零）两种策略（`SWEEP_TO_FUND` 仅作为历史类型签名兼容保留）。
- **周期性规则自动预留（`reserved_fixed`）与定时执行简化**：`monthly_budgets.reserved_fixed` 未与 `recurring_rules` 自动联动冻结，恒为 `'0.00'`；规则支持 `'MONTHLY' | 'YEARLY'`，不依赖后台静默 Cron 进程，由用户在「卡包与周期 -> 周期性扣款」页面手动点击触发 `executeRecurringRule`。

---

### 2.5 外币单月返现封顶（`fx_monthly_cap`）、独立返现流水（`CASHBACK_OFFSET`）与 `REFUNDED` 退货状态机简化
- **外币单月返现封顶（`fx_monthly_cap`）与 `CASHBACK_OFFSET`**：外币返现直接按单笔或全局设定的 `fx_cashback_rate` 在清算时内联计算入 `payment_discount`，不再按卡统计月度封顶上限，也不再生成独立 `CASHBACK_OFFSET` 流水。
- **退货退款**：不走独立的逆向退款状态机，而是直接通过**编辑账单金额**或**软删除账单**（自动退还已核销立减金并重算预算池）闭环处理。

---

## 三、【开发期新增的隐性需求（Added）】

在开发演进过程中，代码库新增了以下原 PRD 未包含的**分布式同步机制、原地无损数据库迁移、外币覆盖参数及级联防御逻辑**：

### 3.1 基于 HLC（混合逻辑时钟）的离线优先分布式同步、冲突检测与防炸机自愈体系
在 [hlc-sync.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/core/src/hlc-sync.ts)、[local-replica.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/apps/client/src/sync/local-replica.ts)、[ledger-repository.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/db/src/ledger-repository.ts) 与 [app.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/apps/server/src/app.ts) 中新增：

1. **新增 3 张同步专用表**（[schema.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/db/src/schema.ts#L198-L224)）：
   - `sync_meta`：存储服务端纪元标识 `server_epoch_id`。
   - `sync_oplog`：按混合逻辑时钟 `hlc` 主键记录增量变更操作日志（`hlc`, `node_id`, `entity_type`, `entity_id`, `op_type`, `payload_json`, `created_at`）。
   - `sync_conflicts`：持久化并发冲突（`id`, `conflict_type`, `entity_id`, `winner_hlc`, `loser_hlc`, `winner_summary`, `loser_summary`, `loser_payload_json`, `status`, `created_at`）。
2. **三类语义冲突检测与人工仲裁（`ConflictType` & `resolveConflict`）**：
   - 自动识别 `'CONCURRENT_TX_EDIT'`、`'VOUCHER_DOUBLE_SPEND'`、`'CONCURRENT_FX_SETTLE'`（[types.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/core/src/types.ts#L399-L402)），支持用户在冲突中心裁决 `'KEEP_WINNER'` 或 `'USE_LOSER'`。
3. **服务端炸机检测（Epoch Mismatch）与全量 JSON 备份恢复**：
   - 同步时比对 `server_epoch_id`；检测到云端空库或重置时，阻断空库覆盖本地，允许通过 `POST /api/sync/reseed` 全量重播恢复，并支持完整 JSON 备份包 `FullSyncBundle` 导出/导入。

---

### 3.2 原地无损 SQLite Schema 迁移与历史兼容守卫（In-Place DB Migration & Legacy Guards）
为确保去账户化与去废置池改造不损坏历史数据库与旧版 JSON 备份，开发期新增以下向后兼容防护机制：

1. **后端原地事务性数据库迁移（`LedgerRepository.ensureSchemaMigrations`，[ledger-repository.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/db/src/ledger-repository.ts#L78-L325)）**：
   - 实例化 `LedgerRepository` 时自动检测旧版结构：是否缺失 `transaction_headers.fx_cashback_rate`、是否存在 `accounts` 表 / `v_account_dashboard` 视图、`transaction_headers` 或 `recurring_rules` 是否含 `account_id` / `target_account_id`、`vouchers` CHECK 约束是否含 `'REPAY_COUPON'`、或存在 `POOL_FUND` / `POOL_ASSET`。
   - 若命中任一旧结构，自动在 `PRAGMA foreign_keys = OFF` + `BEGIN IMMEDIATE` 事务内安全执行表结构重建与清洗：`ALTER TABLE` 补列、重建剥离账户列的 `transaction_headers`（过滤 `'TRANSFER'`）与 `recurring_rules`（清理 `'AUTO_INVEST'`）、重建 `vouchers` 并将 `'REPAY_COUPON'` 转正为 `'FREE_COUPON'`、删除 `accounts` 与 `v_account_dashboard`、清理 `'ACCOUNT'` 同步日志、将 `categories`/`projects_and_tags` 引用由 `POOL_FUND`/`POOL_ASSET` 重映射至 `'POOL_FLEX'` 并清理未被引用的废置池、重建 `v_monthly_budget_status` 视图。
   - **完整保留用户存量记账交易、卡券、专项标签、周期规则以及 `sync_meta.server_epoch_id`**，迁移后满足 `PRAGMA foreign_key_check` 零外键错误。
2. **历史同步日志与 JSON 备份清洗守卫**：
   - `LedgerRepository.applyRemoteOpLogs` / `reseedFromBundle` 与 `LocalLedgerEngine.loadFromStorage` / `importFullSyncBundle` 对历史数据中的 `accounts` 字段、`'ACCOUNT'` 实体操作日志、`'AUTO_INVEST'` 规则及未引用 `POOL_FUND` / `POOL_ASSET` 执行自动忽略、剥离或降级映射（`'REPAY_COUPON'` -> `'FREE_COUPON'`），防止老备份导入报错。

---

### 3.3 全局与单笔外币预授权/返现率配置（`FxPreferenceConfig` & `transaction_headers.fx_cashback_rate`）
1. `LocalReplicaState` 维护全局外币默认规则 `fxConfig: FxPreferenceConfig`（默认 `{ defaultHoldRatio: '1.020', defaultCashbackRate: '0.0100' }`，可在设置页调整）。
2. `transaction_headers` 新增 `fx_cashback_rate NUMERIC(5, 4) DEFAULT NULL`。记账时支持单笔显式指定返现比例（如 `'0.0000'` 表示 0% 返现），清算 `settleMastercardPending` / `settleMastercardTransaction` 时优先读取单据记录的 `fx_cashback_rate`，防止被全局默认 1% 覆盖。

---

### 3.4 账单修改/删除的预算与卡券级联回滚 & 拆单多子项独立编辑
1. **单据软删除与卡券双向级联回滚（`deleteTransaction` & `deleteVoucher`）**：
   - `transaction_headers` 新增 `is_deleted INTEGER NOT NULL DEFAULT 0` 与 `applied_voucher_id INTEGER DEFAULT NULL`。
   - **删除消费单（`deleteTransaction`）**：若曾核销卡券（`applied_voucher_id` 或 `vouchers.used_tx_id == txId`），自动将该卡券恢复为 `'AVAILABLE'` 并清空 `used_tx_id`，释放对应预算池已用额度，不再涉及任何账户余额重算。
   - **删除购券单（`VOUCHER_BUY`）与删除卡券（`deleteVoucher`）双向联动**：删 `VOUCHER_BUY` 流水时级联删除关联卡券；在卡包中删除有偿购买的立减金时，自动软删除其关联 `purchase_tx_id` 流水。
2. **拆单多子项独立编辑归属池与比例缩放（`updateTransaction` 的 `item_updates`）**：
   - 编辑由算式拆单生成的多子项账单时，支持按子项逐行独立修改各自的 `budget_pool_id`（月度预算池）或 `project_tag_id`（专项预算），同时保留各子项名称与拆分权重；若同步修改总额或优惠额，按原价权重等比缩放并重新调用 `allocateSplitDiscounts` 处理尾差。
3. **主数据删除前置保护**：
   - 删除资金池（`deleteBudgetPool`）、专项预算（`deleteProjectTag`）前，检查是否存在未删除流水子项或周期规则引用；若仍被引用则拒绝删除并提示中文错误信息。

---

### 3.5 开发期新增的其它业务字段与辅助能力
| 所属模块 | 新增字段 / 函数 | 实际用途说明 |
| :--- | :--- | :--- |
| **专项预算起止归档 (`ProjectTag`)** | `start_date?: string \| null`、`end_date?: string \| null` | 支持设置专项预算起止日期；当本地日期超过 `end_date` 时自动移入预算页底部「已归档专项预算」折叠区。 |
| **周期规则外币折算** | `executeRecurringRule` 外币自动折算 | 当周期规则币种为外币时，触发执行自动按 `DEFAULT_FX_RATES` 折算人民币扣减绑定月度预算池。 |
| **卡券自动命名 (`generateVoucherTitle`)** | `generateVoucherTitle(voucherType, faceValue, minSpend)`（[types.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/core/src/types.ts#L164-L185)） | 未传名称时根据类型、面额与门槛自动生成标准卡券名称（如 `满30减10立减金`、`5元无门槛优惠券`）。 |
| **本地时区日期工具** | `getLocalTodayDateStr()`、`getLocalYearMonthStr()`（[types.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/core/src/types.ts#L190-L202)） | 基于本地时区生成 `YYYY-MM-DD` / `YYYY-MM`，避免跨时区或凌晨记账出现日期偏差。 |
| **状态版本号通知 (`stateVersion`)** | `LocalLedgerEngine.stateVersion` | 每次本地写入、删除或同步后自增，驱动 React `useMemo` 实时更新（例如核销后立减金下拉选项立即移除）。 |

---

## 四、【最新事实数据字典】

以下为当前代码库（[packages/db/src/schema.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/db/src/schema.ts) 与 [packages/core/src/types.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/core/src/types.ts)）**实际生效的 12 张 SQLite 物理表与 1 个分析视图（`v_monthly_budget_status`）** 完整结构。原 `accounts` 表及 `v_account_dashboard` 视图**已在前后端全量物理删除**，不在此字典中留存。

### 4.1 表 1：`budget_pools`（预算池定义表 —— **核心生效**）
| 字段名 | SQLite 类型 | 约束与默认值 | 当前状态 | 业务说明 |
| :--- | :--- | :--- | :---: | :--- |
| `id` | `VARCHAR(32)` | `PRIMARY KEY` | 核心生效 | 预设 4 个月度核心池：`POOL_FIXED`, `POOL_DAILY`, `POOL_FLEX`, `POOL_EMERGENCY` |
| `name` | `VARCHAR(64)` | `NOT NULL` | 核心生效 | 资金池名称 |
| `pool_type` | `VARCHAR(24)` | `NOT NULL CHECK IN ('FIXED', 'DAILY', 'FLEX', 'EMERGENCY', 'SINKING_FUND', 'CAPITAL_ASSET')` | 演进简化 | 池类型（当前默认种子与前端仅使用前 4 类月度池；后两种仅类型签名保留） |
| `is_monthly_budget` | `BOOLEAN` | `NOT NULL DEFAULT 1` | 核心生效 | 是否属于月度常规预算池（`1` 是，`0` 否） |
| `rollover_strategy` | `VARCHAR(24)` | `NOT NULL DEFAULT 'ACCUMULATE' CHECK IN ('ACCUMULATE', 'RESET', 'SWEEP_TO_FUND')` | 演进修改 | 月末结余滚存策略（4 个初始池均默认为 `'ACCUMULATE'`；前端可选 `'ACCUMULATE'` / `'RESET'`） |
| `description` | `TEXT` | — | 核心生效 | 用途说明 |
| `sort_order` | `SMALLINT` | `NOT NULL DEFAULT 100` | 核心生效 | 排序权重 |

---

### 4.2 表 2：`categories`（商品/服务基础属性分类表 —— **仅后台/DSL 路由生效**）
| 字段名 | SQLite 类型 | 约束与默认值 | 当前状态 | 业务说明 |
| :--- | :--- | :--- | :---: | :--- |
| `id` | `VARCHAR(32)` | `PRIMARY KEY` | 后台生效 | 14 个预设分类 ID（如 `CAT_FOOD`, `CAT_DIGITAL_SUB`） |
| `parent_id` | `VARCHAR(32)` | `REFERENCES categories(id)` | 底层简化 | 父分类 ID |
| `name` | `VARCHAR(64)` | `NOT NULL` | 后台生效 | 分类名称（前端已移除独立分类管理页） |
| `default_pool_id` | `VARCHAR(32)` | `NOT NULL REFERENCES budget_pools(id)` | 后台生效 | 默认映射归属的月度预算池 ID（原指向 `POOL_FUND`/`POOL_ASSET` 的分类已改绑 `'POOL_FLEX'`） |
| `icon_name` | `VARCHAR(32)` | — | 底层简化 | 图标名 |
| `keywords` | `TEXT` | — | **后台生效** | **供 DSL 解析器识别 `#关键词` 与商户自动分类匹配对应 `default_pool_id`** |
| `sort_order` | `SMALLINT` | `NOT NULL DEFAULT 100` | 后台生效 | 排序权重 |

---

### 4.3 表 3：`monthly_budgets`（月度预算分配与结余滚存快照表 —— **核心生效**）
| 字段名 | SQLite 类型 | 约束与默认值 | 当前状态 | 业务说明 |
| :--- | :--- | :--- | :---: | :--- |
| `id` | `INTEGER` | `PRIMARY KEY AUTOINCREMENT` | 核心生效 | 自增主键 |
| `year_month` | `CHAR(7)` | `NOT NULL` | 核心生效 | 预算所属年月（`'YYYY-MM'`，与 `pool_id` 构成 `UNIQUE` 约束） |
| `pool_id` | `VARCHAR(32)` | `NOT NULL REFERENCES budget_pools(id)` | 核心生效 | 关联的预算池 ID |
| `base_allocation` | `NUMERIC(10, 2)` | `NOT NULL DEFAULT 0.00` | 核心生效 | 本月月初分配基准额度（CNY） |
| `rollover_from_prev` | `NUMERIC(10, 2)` | `NOT NULL DEFAULT 0.00` | 核心生效 | 上月结余滚入或超支扣减调整额 |
| `reserved_fixed` | `NUMERIC(10, 2)` | `NOT NULL DEFAULT 0.00` | 演进简化 | 原周期规则月初预留字段（当前未联动，恒为 `0.00`） |
| `swept_to_fund` | `NUMERIC(10, 2)` | `NOT NULL DEFAULT 0.00` | 演进简化 | 原划入专项基金池扣减字段（划转功能已移除，新记录恒为 `0.00`） |
| `note` | `TEXT` | — | 核心生效 | 预算备注 |

---

### 4.4 表 4：`projects_and_tags`（跨期场景标签与专项预算表 —— **核心生效**）
| 字段名 | SQLite 类型 | 约束与默认值 | 当前状态 | 业务说明 |
| :--- | :--- | :--- | :---: | :--- |
| `id` | `VARCHAR(32)` | `PRIMARY KEY` | 核心生效 | 专项唯一标识 |
| `name` | `VARCHAR(64)` | `NOT NULL UNIQUE` | 核心生效 | 专项预算名称 |
| `tag_type` | `VARCHAR(24)` | `NOT NULL CHECK IN ('PROJECT', 'SCENE', 'STOCK_CONSUME')` | 演进简化 | 前端新建专项默认统一使用 `'PROJECT'` |
| `target_budget` | `NUMERIC(10, 2)` | `DEFAULT NULL` | 核心生效 | 专项独立预算上限（CNY） |
| `linked_pool_id` | `VARCHAR(32)` | `REFERENCES budget_pools(id)` | 演进简化 | 关联池（`TAG_JLPT_N2` 已迁移至 `'POOL_FLEX'`；前端新建常设 `NULL`，按 `project_tag_id` 独立隔离统计） |
| `is_active` | `BOOLEAN` | `NOT NULL DEFAULT 1` | 核心生效 | 是否启用 |
| `start_date` / `end_date` | *(TS / JSON 扩展字段)* | `string \| null` | **开发新增** | **专项起止日期（超过 `end_date` 自动归档展示）** |
| `created_at` | `TIMESTAMP` | `NOT NULL DEFAULT CURRENT_TIMESTAMP` | 核心生效 | 创建时间 |

---

### 4.5 表 5：`vouchers`（优惠券与立减金虚拟卡包表 —— **核心生效**）
| 字段名 | SQLite 类型 | 约束与默认值 | 当前状态 | 业务说明 |
| :--- | :--- | :--- | :---: | :--- |
| `id` | `INTEGER` | `PRIMARY KEY AUTOINCREMENT` | 核心生效 | 卡券自增主键 |
| `title` | `VARCHAR(128)` | `NOT NULL` | 核心生效 | 券名称（支持 `generateVoucherTitle` 自动命名） |
| `voucher_type` | `VARCHAR(24)` | `NOT NULL CHECK IN ('PREPAID_COUPON', 'FREE_COUPON')` | 核心生效 | **有偿立减金（`PREPAID_COUPON`）与免费优惠券（`FREE_COUPON`）；已彻底移除 `'REPAY_COUPON'`** |
| `face_value` | `NUMERIC(10, 2)` | `NOT NULL` | 核心生效 | 券面抵扣金额 $V_{\text{face}}$ |
| `acquire_cost` | `NUMERIC(10, 2)` | `NOT NULL DEFAULT 0.00` | 核心生效 | 购券实付成本 $C_{\text{cost}}$（核销时自动结转入预算净成本） |
| `min_spend` | `NUMERIC(10, 2)` | `NOT NULL DEFAULT 0.00` | 核心生效 | 最低满减门槛（`0.00` 为无门槛） |
| `status` | `VARCHAR(16)` | `NOT NULL DEFAULT 'AVAILABLE' CHECK IN ('AVAILABLE', 'USED', 'EXPIRED', 'REFUNDED')` | 核心生效 | 卡券状态 |
| `purchase_tx_id` | `VARCHAR(36)` | `DEFAULT NULL` | 核心生效 | 关联的 `VOUCHER_BUY` 购券流水 ID |
| `used_tx_id` | `VARCHAR(36)` | `DEFAULT NULL` | 核心生效 | 核销该券的消费流水 ID（删单时据此退回 `'AVAILABLE'`） |
| `expire_date` | `DATE` | `DEFAULT NULL` | 核心生效 | 到期日 |
| `created_at` | `TIMESTAMP` | `NOT NULL DEFAULT CURRENT_TIMESTAMP` | 核心生效 | 创建时间 |

---

### 4.6 表 6：`transaction_headers`（交易流水单据头表 —— **核心生效，已移除账户外键**）
| 字段名 | SQLite 类型 | 约束与默认值 | 当前状态 | 业务说明 |
| :--- | :--- | :--- | :---: | :--- |
| `id` | `VARCHAR(36)` | `PRIMARY KEY` | 核心生效 | 交易单据全局唯一 ID |
| `tx_date` | `DATE` | `NOT NULL` | 核心生效 | 记账日期（`YYYY-MM-DD`，已建立 `idx_tx_headers_date` 索引） |
| `tx_timestamp` | `TIMESTAMP` | `NOT NULL DEFAULT CURRENT_TIMESTAMP` | 核心生效 | 精确交易时间戳 |
| `tx_type` | `VARCHAR(24)` | `NOT NULL CHECK IN ('EXPENSE', 'INCOME', 'VOUCHER_BUY', 'VOUCHER_EXPIRE')` | 演进简化 | **交易类型；已彻底删除 `'TRANSFER'` 与 `'CASHBACK_OFFSET'`** |
| `total_gross` | `NUMERIC(12, 2)` | `NOT NULL` | 核心生效 | 折合人民币单据总原价 |
| `platform_discount` | `NUMERIC(12, 2)` | `NOT NULL DEFAULT 0.00` | 核心生效 | 算式内减免 / 商家平台优惠 |
| `payment_discount` | `NUMERIC(12, 2)` | `NOT NULL DEFAULT 0.00` | 核心生效 | 支付优惠 / 用券净省 / 外币返现折扣 |
| `total_net` | `NUMERIC(12, 2)` | `NOT NULL` | 核心生效 | 最终人民币实付净额 |
| `allocation_mode` | `VARCHAR(20)` | `NOT NULL DEFAULT 'PROPORTIONAL' CHECK IN ('SINGLE', 'PROPORTIONAL', 'PRIMARY_ITEM', 'MANUAL')` | 核心生效 | 凑单分摊模式 |
| `original_currency` | `VARCHAR(8)` | `NOT NULL DEFAULT 'CNY'` | 核心生效 | 原始交易币种 |
| `original_amount` | `NUMERIC(12, 2)` | `DEFAULT NULL` | 核心生效 | 外币原价金额 |
| `exchange_rate` | `NUMERIC(12, 6)` | `DEFAULT 1.000000` | 核心生效 | 人民币折算汇率（6 位小数） |
| `settlement_status` | `VARCHAR(20)` | `NOT NULL DEFAULT 'SETTLED' CHECK IN ('PENDING_HOLD', 'SETTLED', 'REFUNDED')` | 核心生效 | 清算状态（已建立 `idx_tx_headers_status` 索引） |
| `hold_amount_cny` | `NUMERIC(12, 2)` | `NOT NULL DEFAULT 0.00` | 核心生效 | 外币预授权冻结金额（清算后归 `0.00`） |
| `fx_cashback_rate` | `NUMERIC(5, 4)` | `DEFAULT NULL` | **开发新增** | **单笔外币返现率显式覆盖（如 `'0.0000'`）** |
| `settled_at` | `TIMESTAMP` | `DEFAULT NULL` | 核心生效 | 外币正式清算时间 |
| `raw_input_text` | `TEXT` | — | 核心生效 | 极速记账原始输入文本 |
| `merchant_or_note` | `TEXT` | — | 核心生效 | 商户名称或消费备注 |
| `applied_voucher_id` | `INTEGER` | `DEFAULT NULL REFERENCES vouchers(id)` | **开发新增** | **核销的卡券 ID（删单时据此自动回滚可用状态）** |
| `is_deleted` | `INTEGER` | `NOT NULL DEFAULT 0` | **开发新增** | **软删除标记（`0` 正常，`1` 已软删除）** |
| `updated_hlc` | `VARCHAR(64)` | `DEFAULT NULL` | **开发新增** | **最后变更的 HLC 混合逻辑时钟戳** |
| `created_at` | `TIMESTAMP` | `NOT NULL DEFAULT CURRENT_TIMESTAMP` | 核心生效 | 创建时间 |

*(注：原 `account_id` 与 `target_account_id` 列已从本表彻底删除。)*

---

### 4.7 表 7：`transaction_items`（交易拆单明细子表 —— **核心生效**）
| 字段名 | SQLite 类型 | 约束与默认值 | 当前状态 | 业务说明 |
| :--- | :--- | :--- | :---: | :--- |
| `id` | `INTEGER` | `PRIMARY KEY AUTOINCREMENT` | 核心生效 | 明细行自增主键 |
| `header_id` | `VARCHAR(36)` | `NOT NULL REFERENCES transaction_headers(id) ON DELETE CASCADE` | 核心生效 | 所属单据头 ID |
| `item_name` | `VARCHAR(128)` | `NOT NULL` | 核心生效 | 子商品名称 |
| `category_id` | `VARCHAR(32)` | `NOT NULL REFERENCES categories(id)` | 核心生效 | 自然属性分类 ID |
| `budget_pool_id` | `VARCHAR(32)` | `NOT NULL REFERENCES budget_pools(id)` | 核心生效 | **月度预算池 ID（支持多子项独立编辑，已建索引 `idx_tx_items_pool`）** |
| `project_tag_id` | `VARCHAR(32)` | `REFERENCES projects_and_tags(id)` | 核心生效 | **专项预算 ID（非空时计入专项且豁免月度池，已建索引 `idx_tx_items_project`）** |
| `item_gross` | `NUMERIC(12, 2)` | `NOT NULL` | 核心生效 | 子项人民币原价 |
| `allocated_discount` | `NUMERIC(12, 2)` | `NOT NULL DEFAULT 0.00` | 核心生效 | 子项分摊到的总优惠金额 |
| `item_net` | `NUMERIC(12, 2)` | `NOT NULL` | 核心生效 | **子项最终净支出成本** |
| `is_primary_item` | `BOOLEAN` | `NOT NULL DEFAULT 0` | 核心生效 | `PRIMARY_ITEM` 模式下是否为主商品 |
| `raw_formula_expr` | `VARCHAR(64)` | `DEFAULT NULL` | 核心生效 | 子项原始 DSL 算式片段 |

---

### 4.8 表 8：`fixed_assets`（大件固定资产追踪表 —— **后端/Store 保留，前端 UI 已移除**）
| 字段名 | SQLite 类型 | 约束与默认值 | 当前状态 | 业务说明 |
| :--- | :--- | :--- | :---: | :--- |
| `id` | `INTEGER` | `PRIMARY KEY AUTOINCREMENT` | 后端保留 | 资产自增主键 |
| `asset_name` | `VARCHAR(128)` | `NOT NULL` | 后端保留 | 资产名称 |
| `purchase_item_id` | `INT` | `REFERENCES transaction_items(id)` | 后端保留 | 购买明细行外键 |
| `purchase_date` | `DATE` | `NOT NULL` | 后端保留 | 购入日期 |
| `purchase_net_cost` | `NUMERIC(10, 2)` | `NOT NULL` | 后端保留 | 购入净成本 |
| `target_daily_cost` | `NUMERIC(8, 2)` | `DEFAULT 2.00` | 后端保留 | 目标日均持有成本 |
| `status` | `VARCHAR(16)` | `NOT NULL DEFAULT 'IN_USE' CHECK IN ('IN_USE', 'SOLD', 'RETIRED')` | 后端保留 | 资产状态 |
| `resale_date` | `DATE` | `DEFAULT NULL` | 后端保留 | 转手日期 |
| `resale_recovery` | `NUMERIC(10, 2)` | `NOT NULL DEFAULT 0.00` | 后端保留 | 二手回血金额 |
| `note` | `TEXT` | — | 后端保留 | 备注 |

---

### 4.9 表 9：`recurring_rules`（周期性固定账单与订阅规则表 —— **核心生效，已移除账户外键**）
| 字段名 | SQLite 类型 | 约束与默认值 | 当前状态 | 业务说明 |
| :--- | :--- | :--- | :---: | :--- |
| `id` | `INTEGER` | `PRIMARY KEY AUTOINCREMENT` | 核心生效 | 规则自增主键 |
| `title` | `VARCHAR(64)` | `NOT NULL` | 核心生效 | 规则标题 |
| `rule_type` | `VARCHAR(24)` | `NOT NULL CHECK IN ('FIXED_EXPENSE', 'FX_SUBSCRIPTION')` | 演进简化 | **规则类型；已彻底移除 `'AUTO_INVEST'`** |
| `cron_cycle` | `VARCHAR(16)` | `NOT NULL CHECK IN ('MONTHLY', 'YEARLY')` | 核心生效 | 周期频次（月度 / 年度） |
| `trigger_day` | `SMALLINT` | `NOT NULL` | 核心生效 | 触发日 |
| `currency` | `VARCHAR(8)` | `NOT NULL DEFAULT 'CNY'` | 核心生效 | 币种（外币执行时自动按 `DEFAULT_FX_RATES` 折算 CNY） |
| `amount` | `NUMERIC(10, 2)` | `NOT NULL` | 核心生效 | 周期金额 |
| `category_id` | `VARCHAR(32)` | `REFERENCES categories(id)` | 后台关联 | 默认分类 ID |
| `budget_pool_id` | `VARCHAR(32)` | `REFERENCES budget_pools(id)` | 核心生效 | **绑定的目标月度预算池 ID** |
| `auto_reserve_budget` | `BOOLEAN` | `NOT NULL DEFAULT 1` | 演进简化 | 预留标记（未与 `reserved_fixed` 自动联动） |
| `is_active` | `BOOLEAN` | `NOT NULL DEFAULT 1` | 核心生效 | 是否启用 |

*(注：原 `account_id` 与 `target_account_id` 列已从本表彻底删除。)*

---

### 4.10 表 10 ~ 12：分布式同步专用表（`sync_meta` / `sync_oplog` / `sync_conflicts` —— **开发新增 & 核心生效**）
1. **`sync_meta`**：`key VARCHAR(64) PRIMARY KEY`, `value TEXT NOT NULL` —— 持久化 `server_epoch_id` 防炸机纪元标识。
2. **`sync_oplog`**：`hlc VARCHAR(64) PRIMARY KEY`, `node_id VARCHAR(64) NOT NULL`, `entity_type VARCHAR(32) NOT NULL`, `entity_id VARCHAR(64) NOT NULL`, `op_type VARCHAR(16) NOT NULL`, `payload_json TEXT NOT NULL`, `created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP` —— HLC 增量同步日志（已不再生成 `'ACCOUNT'` 日志）。
3. **`sync_conflicts`**：`id VARCHAR(128) PRIMARY KEY`, `conflict_type VARCHAR(32) NOT NULL`, `entity_id VARCHAR(64) NOT NULL`, `winner_hlc VARCHAR(64) NOT NULL`, `loser_hlc VARCHAR(64) NOT NULL`, `winner_summary TEXT NOT NULL`, `loser_summary TEXT NOT NULL`, `loser_payload_json TEXT NOT NULL`, `status VARCHAR(16) NOT NULL DEFAULT 'PENDING'`, `created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP` —— 多端并发冲突记录表。

---

### 4.11 唯一生效视图：`v_monthly_budget_status`（月度预算池执行水位与剩余额度实时视图）
- **定义（[schema.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/db/src/schema.ts#L240-L260)）**：联合 `monthly_budgets`、`budget_pools`、`transaction_headers`（过滤 `tx_type = 'EXPENSE' AND is_deleted = 0`）与 `transaction_items`（`item_net` / `item_gross` / `allocated_discount`），实时输出列：
  - `year_month`, `pool_id`, `pool_name`, `pool_type`, `base_allocation`, `rollover_from_prev`, `total_available_budget`, `reserved_fixed`, `spent_gross`, `total_saved_discount`, `spent_net`, `remaining_budget`。
- **视图变更说明**：原 `v_account_dashboard` 视图已随着 `accounts` 表的删除而彻底移除，当前库内仅保留 `v_monthly_budget_status` 单个视图。
