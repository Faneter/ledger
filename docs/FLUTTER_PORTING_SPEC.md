# Flutter 移动端业务逻辑与算法移植规范（FLUTTER_PORTING_SPEC）

> **文档基线与范围声明**：
> 本文档完全基于已完成**前后端全栈去账户化清理**后的现行代码库生成，扫描范围涵盖：
> - 核心领域与纯算法包：[money.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/core/src/money.ts)、[types.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/core/src/types.ts)、[allocation.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/core/src/allocation.ts)、[dsl-parser.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/core/src/dsl-parser.ts)、[mastercard-fx.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/core/src/mastercard-fx.ts)、[hlc-sync.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/core/src/hlc-sync.ts)
> - 数据库 Schema 与仓储实现：[schema.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/db/src/schema.ts)、[ledger-repository.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/db/src/ledger-repository.ts)
> - 离线优先本地引擎与 REST API：[local-replica.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/apps/client/src/sync/local-replica.ts)、[app.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/apps/server/src/app.ts)
> - 纯业务交互输入映射参考：[QuickInputBar.tsx](file:///c:/Users/Faneter/Documents/Projects/ledger/apps/client/src/components/QuickInputBar.tsx)、[TransactionsView.tsx](file:///c:/Users/Faneter/Documents/Projects/ledger/apps/client/src/components/TransactionsView.tsx)、[BudgetPoolsDashboard.tsx](file:///c:/Users/Faneter/Documents/Projects/ledger/apps/client/src/components/BudgetPoolsDashboard.tsx)
>
> **架构公理**：当前系统为**彻底去账户化（Account-Free）**的预算池与专项预算驱动模型，SQLite 与本地副本中均已不存在 `accounts` 表、`v_account_dashboard` 视图、`account_id` / `target_account_id` 外键，以及 `TRANSFER` / `REPAY_COUPON` / `AUTO_INVEST` / `POOL_FUND` / `POOL_ASSET` / `/api/budgets/sweep-to-fund` 逻辑。Flutter 端 UI 可完全重新设计，但**所有写操作状态转移、守恒校验、纯函数计算公式与小数舍入行为必须与本规范保持 100% 一致**。

---

## 一、【状态机与资金流转契约】

### 0. 全局写操作不变量（Global Write Invariants）
1. **统一本位币与字符串定点存储**：所有 CNY 金额在内存与持久化层统一以 2 位小数字符串（`"0.00"`）存储；汇率以 6 位小数字符串（`"1.000000"`）存储；单笔外币返现率以 4 位小数字符串（`"0.0100"` / `"0.0000"`）存储。
2. **订单头行守恒定律（Conservation Law）**：
   对于任意 `tx_type == 'EXPENSE'` 且 `items.length > 0` 的流水，写入前必须强制验证：
   - $\text{sumCny}(\text{items.item\_gross}) \equiv \text{header.total\_gross}$（精确到 `0.01`）
   - $\text{sumCny}(\text{items.item\_net}) \equiv \text{header.total\_net}$（精确到 `0.01`）
   - 若不相等则**立即抛出异常并中止写入**（`Conservation law violated`）。
3. **月度预算池与专项预算互斥隔离定律**：
   - 在 `v_monthly_budget_status` 视图及 `getMonthlyBudgetStatus` 中，仅统计满足 `tx_type == 'EXPENSE' AND is_deleted == 0` 且 **`item.project_tag_id IS NULL`**（或非月度池 `bp.is_monthly_budget == 0`）的明细行。
   - 凡绑定了非空 `project_tag_id` 的消费明细行，仅计入对应专项预算（`ProjectTag`）已用额度，**自动豁免月度常规预算池扣减**（即使其 `budget_pool_id` 字段存有默认池或关联池 ID）。
4. **同步变更日志原子追加（HLC OpLog）**：
   每次业务表状态写操作完成后，必须推进本地 `HybridLogicalClock.now()`，生成对应 `entity_type` 的 `UPSERT` 或 `DELETE` 操作日志写入 `sync_oplog`（及客户端待推送队列 `pendingSyncOps`）。

---

### 写操作 1：常规消费与收入录入（`recordManualTransaction` / 单品 `recordFromDsl`）

> 适用场景：单品日常人民币支出、单笔算式内减免支出（如 `咸蛋黄拌面 16.8-0.15 #饮食`）、常规收入录入（`INCOME`）。

1. **输入参数（Input Parameters）**
   - **手工表单路径（`recordManualTransaction`）**：
     `{ tx_type: 'EXPENSE' | 'INCOME', tx_date?: string, amount: string, discount?: string, category_id?: string, budget_pool_id?: string, project_tag_id?: string | null, merchant_or_note: string, currency?: string ('CNY') }`
   - **极速算式路径（`recordFromDsl`）**：
     `{ rawText: string, txDate?: string, appliedVoucherId?: number | null }`

2. **前置校验（Pre-conditions & Validations）**
   - `tx_date` 为空时默认取本地时区当日日期 `getLocalTodayDateStr()`（注意：服务端 `LedgerRepository` 兜底为 `new Date().toISOString().slice(0, 10)`，Flutter 离线本地引擎应统一采用设备本地时区 `YYYY-MM-DD`，防止凌晨跨 UTC 偏差一天）。
   - `amount`（手工）必须为有效正数；`rawText`（DSL）去除空白后非空且可解析出至少 1 条有效价格算式。
   - 预算归属解析（仅 `EXPENSE`）：
     - 手工路径：`catId = category_id ?? categories[0]?.id ?? 'CAT_FOOD'`；`poolId = budget_pool_id ?? cat?.default_pool_id ?? 'POOL_DAILY'`。
     - DSL 路径：经由 `#标签` 解析 -> 尾部全局标签继承 -> 专项绑定分类/池 -> 商品名关键词最长匹配 -> 兜底 `CAT_FOOD` / `POOL_DAILY`。
   - 守恒校验：当 `tx_type === 'EXPENSE'` 且 `items.length > 0` 时，校验 `equalsCny(sumCny(items.item_gross), header.total_gross)` 且 `equalsCny(sumCny(items.item_net), header.total_net)`。

3. **账户表字段变动公式（Account Table Mutation Formula）**
   - **`N/A`**（V2 已全栈去账户化，彻底删除 `accounts` 表与外键，不产生任何资金账户余额或借贷负债变动）。

4. **预算池变动公式（Budget Pool & Project Tag Impact Formula）**
   - 当 `tx_type === 'INCOME'` 时：**所有月度预算池与专项预算变动均为 `0.00`**（收入流水无 `items`，且聚合统计过滤 `tx_type == 'EXPENSE'`）。
   - 当 `tx_type === 'EXPENSE'` 且 `project_tag_id == null` 时，目标月度池 `(strftime('%Y-%m', tx_date), budget_pool_id)` 变动：
     $$\Delta\text{spent\_gross} = +\text{item\_gross}$$
     $$\Delta\text{total\_saved\_discount} = +\text{allocated\_discount}$$
     $$\Delta\text{spent\_net} = +\text{item\_net}$$
     $$\Delta\text{remaining\_budget} = -\text{item\_net}$$
   - 当 `tx_type === 'EXPENSE'` 且 `project_tag_id != null` 时：
     - 目标月度预算池变动：**`0.00`**（豁免月度池扣减）。
     - 目标专项预算 `ProjectTag(project_tag_id)` 累计已用额变动：
       $$\Delta\text{tag\_spent\_net} = +\text{item\_net}, \quad \Delta\text{tag\_remaining} = -\text{item\_net}$$

5. **交易主子表与同步日志写入状态（Transaction Header/Items & OpLog Persistence State）**
   - **`transaction_headers` 新增 1 行**：
     - 手工 `EXPENSE`：`tx_type = 'EXPENSE'`, `total_gross = formatCny(amount)`, `platform_discount = '0.00'`, `payment_discount = formatCny(discount ?? '0.00')`, `total_net = formatCny(Decimal.max(0, total_gross - payment_discount))`, `allocation_mode = 'SINGLE'`, `original_currency = 'CNY'`, `original_amount = null`, `exchange_rate = '1.000000'`, `settlement_status = 'SETTLED'`, `hold_amount_cny = '0.00'`, `fx_cashback_rate = null`, `applied_voucher_id = null`, `is_deleted = 0`, `updated_hlc = hlc`。
     - 手工 `INCOME`：`tx_type = 'INCOME'`, `total_gross = formatCny(amount)`, `platform_discount = '0.00'`, `payment_discount = '0.00'`, `total_net = total_gross`, `allocation_mode = 'SINGLE'`, `settlement_status = 'SETTLED'`, `items = []`。
     - 单品 DSL `EXPENSE`（算式含 `-`，如 `16.8-0.15`）：`total_gross = evaluated.gross`, `platform_discount = evaluated.discount`, `payment_discount = '0.00'`, `total_net = evaluated.net`, `allocation_mode = 'SINGLE'`, `settled_at = nowIso`（本地引擎）/`null`（仓储层）。
   - **`transaction_items`**：
     - `INCOME` 写入 `0` 条；
     - `EXPENSE` 写入 `1` 条：`item_gross = header.total_gross`, `allocated_discount = header.payment_discount`（或 DSL 算式 `evaluated.discount`）, `item_net = header.total_net`, `is_primary_item = 1 (true)`, `raw_formula_expr = formula | null`。
   - **`sync_oplog`**：追加 1 条 `entity_type = 'TRANSACTION'`, `op_type = 'UPSERT'`, `entity_id = txId`, `payload_json = JSON(TransactionAggregate)`。

---

### 写操作 2：跨类目凑单满减消费（多子项 `recordFromDsl` / `recordTransaction`）

> 适用场景：同一笔订单包含多个商品、跨越不同预算池/专项，支持「尾部实付覆盖满减分摊（按原价比例或主商品独占）」与「多子项各自算式独立减免」。

1. **输入参数（Input Parameters）**
   - `rawText`（形如 `*单片机 35 #硬件 + 抽纸 15 #日用 = 40` 或 `拌面 16.8-0.15 #饮食 + 可乐 3 #饮食`）
   - `txDate?: string`
   - `appliedVoucherId?: number | null`（若同时用券，会在此基础上再叠入写操作 3B 的成本结转重分摊）

2. **前置校验（Pre-conditions & Validations）**
   - 经 `split(/\s*\+\s*(?=[\p{L}\p{Script=Han}])/u)` 切分后子项数 $N \ge 2$，且每个子项均能分离出名称与合法算式或金额。
   - 若指定 `allocation_mode == 'MANUAL'`，须满足 $\text{sumCny}(\text{manualNets}) \equiv \text{roundCny}(\text{totalNetPaid})$。
   - 所有子项必须具备非空 `category_id` 与 `budget_pool_id`（外键有效）。
   - 执行订单头行守恒校验：$\sum_{i=1}^{N} \text{item\_gross}_i \equiv \text{total\_gross}$ 且 $\sum_{i=1}^{N} \text{item\_net}_i \equiv \text{total\_net}$。

3. **账户表字段变动公式（Account Table Mutation Formula）**
   - **`N/A`**（V2 已彻底移除 `accounts` 表，无任何账户变动）。

4. **预算池变动公式（Budget Pool & Project Tag Impact Formula）**
   - 遍历全部 $N$ 个子项 $i \in [1, N]$（支持同一笔交易内各子项归属不同池或专项）：
     - 若子项 $i$ 的 `project_tag_id == null`，则对其目标月度池 `(YYYY-MM, items[i].budget_pool_id)` 分别累加：
       $$\Delta\text{spent\_gross}(\text{pool}_i) \mathrel{+}= \text{item\_gross}_i, \quad \Delta\text{total\_saved\_discount}(\text{pool}_i) \mathrel{+}= \text{allocated\_discount}_i$$
       $$\Delta\text{spent\_net}(\text{pool}_i) \mathrel{+}= \text{item\_net}_i, \quad \Delta\text{remaining\_budget}(\text{pool}_i) \mathrel{-}= \text{item\_net}_i$$
     - 若子项 $i$ 的 `project_tag_id != null`，则月度池变动为 `0.00`，专项 `ProjectTag(items[i].project_tag_id)` 累计支出增加：
       $$\Delta\text{tag\_spent\_net}(\text{tag}_i) \mathrel{+}= \text{item\_net}_i$$

5. **交易主子表与同步日志写入状态（Transaction Header/Items & OpLog Persistence State）**
   - **情形 A（存在尾部 `= totalNet` 实付覆盖，如 `= 40`）**：
     - `header.total_gross = formatCny(sum(items.gross))`
     - `header.total_net = formatCny(mergedNetOverride)`
     - `header.payment_discount = formatCny(total_gross - total_net)`
     - `header.platform_discount = '0.00'`
     - `header.allocation_mode = any(item.is_primary) ? 'PRIMARY_ITEM' : 'PROPORTIONAL'`
     - 调用 `allocateSplitDiscounts`（详见第二部分算法 3）为每个子项写入 `item_gross`, `allocated_discount`, `item_net`。
   - **情形 B（无尾部 `= totalNet` 覆盖，多品各自带算式减免）**：
     - `header.total_gross = formatCny(sum(items.gross))`
     - `header.platform_discount = formatCny(sum(items.discount))`
     - `header.payment_discount = '0.00'`
     - `header.total_net = formatCny(total_gross - platform_discount)`
     - `header.allocation_mode = 'MANUAL'`
     - 各子项直接保留各自 `evaluateMathFormula` 的 `gross`, `discount`, `net`。
   - **`transaction_headers` 其他公共字段**：`merchant_or_note = items.map(name).join(' + ')`, `tx_type = 'EXPENSE'`, `settlement_status = 'SETTLED'`, `is_deleted = 0`。
   - **`transaction_items`**：批量插入 $N$ 行，按出现顺序绑定 `header_id = txId`、`is_primary_item`（1 或 0）与 `raw_formula_expr`。
   - **`sync_oplog`**：追加 1 条 `entity_type = 'TRANSACTION'`, `op_type = 'UPSERT'` 日志。

---

### 写操作 3：卡券入库（有偿购买/领券）与消费用券核销（`buyVoucher` / `upsertVoucher` + 核销流）

#### 阶段 3A：有偿购券入库或免费领券（`buyVoucher` / `upsertVoucher`）
1. **输入参数（Input Parameters）**
   - `{ id?: number, title?: string, voucher_type: 'PREPAID_COUPON' | 'FREE_COUPON', face_value: string, acquire_cost: string, min_spend: string, expire_date?: string | null, txDate?: string }`
   - 路由分支：当 `!id && Number(acquire_cost) > 0`（或显式调用 `buyVoucher`）走有偿购券流程；当 `!id && Number(acquire_cost) == 0` 时仅插入 `vouchers` 表，不产生交易流水。
2. **前置校验（Pre-conditions & Validations）**
   - 若 `title` 为空，自动调用纯函数 `generateVoucherTitle(voucher_type, face_value, min_spend, acquire_cost)` 生成标题。
   - 仅允许 `voucher_type` 为 `'PREPAID_COUPON'` 或 `'FREE_COUPON'`。
3. **账户表字段变动公式（Account Table Mutation Formula）**
   - **`N/A`**（V2 无 `accounts` 表；虚拟卡包 `vouchers` 新增 1 条 `status = 'AVAILABLE'` 卡券实体）。
4. **预算池变动公式（Budget Pool & Project Tag Impact Formula）**
   - **所有月度预算池与专项预算变动均为 `0.00`**。
   - **金融合规原因**：`buyVoucher` 生成的交易流水 `tx_type = 'VOUCHER_BUY'` 且 **`transaction_items = []`**；按购券成本结转公理，购券当下 $C_{\text{cost}}$ 不计入预算消耗，直至阶段 3B 实际消费核销时才结转计入对应消费预算池。
5. **交易主子表与同步日志写入状态（Transaction Header/Items & OpLog Persistence State）**
   - **`transaction_headers`**（仅 `acquire_cost > 0` / `buyVoucher`）：
     - `tx_type = 'VOUCHER_BUY'`, `total_gross = formatCny(acquire_cost)`, `platform_discount = '0.00'`, `payment_discount = '0.00'`, `total_net = formatCny(acquire_cost)`, `allocation_mode = 'SINGLE'`, `settlement_status = 'SETTLED'`, `hold_amount_cny = '0.00'`, `raw_input_text = '购买卡券: ' + finalTitle`（注：仓储层半角冒号 `购买卡券: `，本地引擎全角冒号 `购买卡券：`）。
   - **`transaction_items`**：`[]`（0 条明细行）。
   - **`vouchers`**：插入新卡券，`status = 'AVAILABLE'`, `face_value = formatCny(face_value)`, `acquire_cost = formatCny(acquire_cost)`, `min_spend = formatCny(min_spend)`, `purchase_tx_id = tx.header.id`（免费领券则为 `null`）, `used_tx_id = null`。
   - **`sync_oplog`**：若发生购券，写入 `VOUCHER`（`UPSERT`）与 `TRANSACTION`（`UPSERT`）两条日志。

#### 阶段 3B：消费用券核销与购券成本结转（`recordFromDsl` / `recordManualTransaction` 带 `applied_voucher_id`）
1. **输入参数（Input Parameters）**
   - 常规/凑单消费参数 + `appliedVoucherId: number`（或 `applied_voucher_id: number`）。
2. **前置校验（Pre-conditions & Validations）**
   - 卡券必须存在，否则抛错 `优惠券 "${id}" 不存在`。
   - **可用状态校验**：`voucher.status === 'AVAILABLE'`，否则抛错 `优惠券「${v.title}」已被使用或已失效`。
   - **交易类型校验**：`tx_type !== 'INCOME'`，否则抛错 `收入交易不可使用优惠券`。
   - **最低满减门槛校验**：
     - 人民币交易校验 `toDecimal(totalGross)`；手工外币交易先按 `roundCny(foreignAmount * DEFAULT_FX_RATES[currency])` 折算人民币原价后再比较。
     - 必须满足 $\text{totalGrossDec} \ge \text{toDecimal}(\text{voucher.min\_spend})$，否则抛错 `未达到优惠券「${v.title}」的最低使用门槛（需满 ¥${v.min_spend}，当前金额 ¥${formatCny(totalGrossDec)}）`。
3. **账户表字段变动公式（Account Table Mutation Formula）**
   - **`N/A`**（V2 无 `accounts` 表）。
   - **虚拟卡包 `vouchers` 状态变更**：
     - `vouchers.status`: `'AVAILABLE'` $\rightarrow$ `'USED'`
     - `vouchers.used_tx_id`: `null` $\rightarrow$ `txId`
4. **预算池变动公式（Budget Pool & Project Tag Impact Formula）**
   - 先计算现场实付现金与购券成本结转（调用 `computeOrderAllocation`）：
     - DSL 路径：`cashPaid = Decimal.max(0, toDecimal(parsed.total_net) - toDecimal(voucher.face_value))`
     - 手工表单路径：`cashPaid = Decimal.max(0, toDecimal(amount) - toDecimal(discount ?? 0) - toDecimal(voucher.face_value))`
     - 购券成本结转：`voucherCost = roundCny(voucher.acquire_cost)`
     - 净省薅羊毛额：`voucherSavings = roundCny(toDecimal(voucher.face_value) - voucherCost)`
     - **预算口径有效净支出**：
       $$\text{effectiveBudgetNet} = \text{roundCny}(\text{cashPaid} + \text{voucherCost})$$
     - **预算口径订单总折扣**：
       $$\text{totalDiscount} = \text{roundCny}(\text{totalGross} - \text{effectiveBudgetNet})$$
   - 再调用 `allocateSplitDiscounts(items, effectiveBudgetNet, mode)` 将 `effectiveBudgetNet` 分摊到各子项 `item_net`。
   - **示例核对**（原价 `15.00`，10 元面值/成本 `5.99` 立减金）：`cashPaid = 5.00`，`effectiveBudgetNet = 5.00 + 5.99 = 10.99`，`totalDiscount = 15.00 - 10.99 = 4.01`，预算池实际扣减 **`10.99`**（节省 `4.01`）。
   - **注（手工外币+用券边界）**：查看代码执行顺序（[local-replica.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/apps/client/src/sync/local-replica.ts#L985-L1088)、[ledger-repository.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/db/src/ledger-repository.ts#L1937-L2034)），若同时传外币与优惠券，后续 `if (isFx)` 分支会用 `processMastercardFxLifecycle` 覆盖 `totalGross / paymentDiscount / totalNet` 与 `items[0]`，因此实际业务中优惠券仅适用于 CNY 交易。
5. **交易主子表与同步日志写入状态（Transaction Header/Items & OpLog Persistence State）**
   - **`transaction_headers`**：
     - `total_gross = alloc.total_gross`
     - `platform_discount = '0.00'`（用券重算时统一归并至 `payment_discount`）
     - `payment_discount = alloc.total_discount`
     - `total_net = alloc.total_net`（即 `effectiveBudgetNet`）
     - `applied_voucher_id = voucher.id`
   - **`transaction_items`**：写入 `alloc.items` 对应 `item_gross`, `allocated_discount`, `item_net`（满足 $\sum \text{item\_net} \equiv \text{effectiveBudgetNet}$）。
   - **`vouchers`**：更新 `status = 'USED', used_tx_id = txId`。
   - **`sync_oplog`**：写入 `VOUCHER`（`UPSERT`，含新状态 `'USED'` 与 `used_tx_id`）及 `TRANSACTION`（`UPSERT`）两条日志。

---

### 写操作 4：外币 102% 预授权冻结与银行清算入账（`PENDING_HOLD` $\rightarrow$ `SETTLED`）

#### 阶段 4A：外币消费预授权冻结挂起（`recordFromDsl` / `recordManualTransaction` 外币路径）
1. **输入参数（Input Parameters）**
   - 手工路径：`{ tx_type: 'EXPENSE', currency: 'USD'|'JPY'|'EUR'|'GBP'|'HKD', amount: string (外币原额), hold_amount_cny?: string, fx_hold_ratio?: string, fx_cashback_rate?: string, category_id?, budget_pool_id?, project_tag_id?, merchant_or_note, tx_date? }`
   - DSL 路径：`rawText` 含 `$`、`USD|JPY|EUR|GBP|HKD` 或 `冻结`（例：`$4.35 冻结31.95 #数字服务`），可选上下文 `fxConfig: { defaultHoldRatio: string, defaultCashbackRate: string }`。
2. **前置校验（Pre-conditions & Validations）**
   - `foreignAmount > 0`（防止除零）。
   - 比例与返现率解析顺序（**防 0% 返现被覆盖关键约束**）：
     - `holdRatio = nonEmpty(params.fx_hold_ratio) ?? fxConfig?.defaultHoldRatio ?? '1.020'`
     - `cashbackRate = nonEmpty(params.fx_cashback_rate) ?? fxConfig?.defaultCashbackRate ?? '0.0100'`，且**显式格式化存储**为 4 位小数（如用户填 `0%` 则入参 `'0.0000'` $\rightarrow$ 严禁因 truthy 判空误回退为 `'0.0100'`）。
   - 若用户未传或传 `'0'` 作为 `hold_amount_cny`，按参考汇率计算冻结人民币：
     $$\text{holdAmountCny} = \text{formatCny}\big(\text{roundCny}(\text{foreignAmount} \times \text{DEFAULT\_FX\_RATES}[\text{currency}] \times \text{holdRatio})\big)$$
     （未知币种默认参考汇率 `'7.200000'`）。
3. **账户表字段变动公式（Account Table Mutation Formula）**
   - **`N/A`**（V2 无 `accounts` 表；外币预授权差额不再冻结在账户表中，直接记录在 `transaction_headers.hold_amount_cny`）。
4. **预算池变动公式（Budget Pool & Project Tag Impact Formula）**
   - 调用 `processMastercardFxLifecycle` 阶段一公式计算预估基准与返现：
     $$\text{estimatedBase} = \text{roundCny}\left(\frac{\text{holdAmountCny}}{\text{holdRatio}}\right)$$
     $$\text{estimatedCashback} = \text{roundCny}(\text{estimatedBase} \times \text{cashbackRate})$$
     $$\text{totalNet} = \text{roundCny}(\text{estimatedBase} - \text{estimatedCashback})$$
     $$\text{exchangeRate} = \text{formatRate}\left(\frac{\text{estimatedBase}}{\text{foreignAmount}}\right)$$
   - 按预算归属（`project_tag_id == null` 扣月度池，否则计入专项）**立即按预估净额 `totalNet` 预扣对应预算**：
     $$\Delta\text{spent\_gross} = +\text{estimatedBase}, \quad \Delta\text{total\_saved\_discount} = +\text{estimatedCashback}, \quad \Delta\text{spent\_net} = +\text{totalNet}$$
5. **交易主子表与同步日志写入状态（Transaction Header/Items & OpLog Persistence State）**
   - **`transaction_headers`**：
     - `tx_type = 'EXPENSE'`
     - `settlement_status = 'PENDING_HOLD'`
     - `original_currency = currency`
     - `original_amount`: `JPY` 在 DSL 中为 `roundCny(rawAmt).toFixed(0)`，其余及手工表单为 `formatCny(amount)`
     - `hold_amount_cny = formatCny(holdAmountCny)`
     - `fx_cashback_rate = Number(cashbackRate).toFixed(4)`（仓储/本地手工录入显式固化 4 位小数；DSL 中保存 `fxCashbackRate`）
     - `exchange_rate = fxResult.exchange_rate`（注：仓储层 `recordManualTransaction` 在插入前传 `null` 并默认转 `'1.000000'`，本地引擎 `LocalLedgerEngine` 写入 `fxResult.exchange_rate`，建议 Flutter 统一写入计算出的 `fxResult.exchange_rate`）
     - `total_gross = fxResult.total_gross`, `platform_discount = '0.00'`, `payment_discount = fxResult.payment_discount`, `total_net = fxResult.total_net`
     - `allocation_mode = 'SINGLE'`, `settled_at = null`
   - **`transaction_items`**：1 条明细，字段值与头表一致（`item_gross = total_gross`, `allocated_discount = payment_discount`, `item_net = total_net`, `is_primary_item = 1`）。
   - **`sync_oplog`**：追加 1 条 `entity_type = 'TRANSACTION'`, `op_type = 'UPSERT'` 日志。

#### 阶段 4B：银行正式清算确认（`settleMastercardTransaction` / `settleMastercardPending`）
1. **输入参数（Input Parameters）**
   - `{ txId: string, settledAmountCny: string, settledAt?: string, cashbackRate?: string }`
2. **前置校验（Pre-conditions & Validations）**
   - 单据必须存在，且 `header.settlement_status === 'PENDING_HOLD'`，否则抛错拒绝重复清算。
   - **返现比例优先级解析**：
     1. 若显式传入非空 `cashbackRate`（含 `'0'` / `'0.0000'`）$\rightarrow$ 使用入参；
     2. 否则若单据已记录非空 `header.fx_cashback_rate`（含 `'0.0000'`）$\rightarrow$ 使用单据存储值；
     3. 最后兜底全局默认 `fxConfig?.defaultCashbackRate ?? '0.0100'`；
     4. 均格式化为 `Number(val).toFixed(4)`。
3. **账户表字段变动公式（Account Table Mutation Formula）**
   - **`N/A`**（V2 无 `accounts` 表；函数内部返回 `released_to_available = roundCny(holdAmountCny - settledAmountCny)` 仅作统计参考值，不写任何账户余额）。
4. **预算池变动公式（Budget Pool & Project Tag Impact Formula）**
   - 调用 `processMastercardFxLifecycle` 阶段二公式计算真实清算值：
     $$\text{settledBase} = \text{roundCny}(\text{settledAmountCny})$$
     $$\text{actualCashback} = \text{roundCny}(\text{settledBase} \times \text{resolvedCashbackRate})$$
     $$\text{newTotalNet} = \text{roundCny}(\text{settledBase} - \text{actualCashback})$$
     $$\text{exchangeRate} = \text{formatRate}\left(\frac{\text{settledBase}}{\text{original\_amount}}\right)$$
   - **多退少补差额效应**（由视图/聚合自动反映）：
     $$\Delta\text{spent\_gross} = \text{settledBase} - \text{prev\_gross}$$
     $$\Delta\text{total\_saved\_discount} = \text{actualCashback} - \text{prev\_payment\_discount}$$
     $$\Delta\text{spent\_net} = \text{newTotalNet} - \text{prev\_net}, \quad \Delta\text{remaining\_budget} = -(\text{newTotalNet} - \text{prev\_net})$$
5. **交易主子表与同步日志写入状态（Transaction Header/Items & OpLog Persistence State）**
   - **`transaction_headers` 原地更新**：
     - `settlement_status = 'SETTLED'`
     - `hold_amount_cny = '0.00'`（解除预授权冻结）
     - `fx_cashback_rate = resolvedCashbackRate`
     - `total_gross = formatCny(settledBase)`
     - `payment_discount = formatCny(actualCashback)`
     - `total_net = formatCny(newTotalNet)`
     - `exchange_rate = exchangeRate`
     - `settled_at = settledAt ?? nowIso`
     - `updated_hlc = hlc`
   - **`transaction_items` 原地更新**：
     - 若 `items.length <= 1`：第 0 项同步覆盖为 `item_gross = total_gross`, `allocated_discount = payment_discount`, `item_net = total_net`。（注：仓储层循环更新所有子项；本地引擎直接更新 `items[0]`）。
     - 若 `items.length > 1`（仓储层实现）：按原 `allocation_mode` 调用 `allocateSplitDiscounts(splitInputs, total_net, allocation_mode)` 重新分摊。
   - **`sync_oplog`**：追加 1 条 `entity_type = 'TRANSACTION'`, `op_type = 'UPSERT'`（携带更新后完整 `TransactionAggregate`）。

---

### 写操作 5：编辑修改账单重算与多子项归属调整（`updateTransaction`）

> 适用场景：修改单据日期/备注/原价/优惠额、修改单品归属池或专项、**独立调整算式拆单（多子项）中每个子项各自的 `budget_pool_id` / `project_tag_id`**。

1. **输入参数（Input Parameters）**
   - `txId: string`
   - `patch`:
     ```ts
     {
       tx_date?: string;
       total_gross?: string;
       payment_discount?: string;
       total_net?: string;
       merchant_or_note?: string;
       category_id?: string;
       budget_pool_id?: string;
       project_tag_id?: string | null;
       item_updates?: Array<{
         index?: number;
         id?: number;
         item_name?: string;
         category_id?: string;
         budget_pool_id?: string;
         project_tag_id?: string | null;
       }>;
     }
     ```
2. **前置校验（Pre-conditions & Validations）**
   - `txId` 对应的未删除单据必须存在，否则抛错 `Transaction "${txId}" not found`。
   - 调用方表单前置需保证 `total_gross > 0`；头表未直接传 `total_net` 且改了 `total_gross` 或 `payment_discount` 时，自动重算 `total_net = formatCny(Decimal.max(0, toDecimal(total_gross) - toDecimal(payment_discount)))`。
   - **日期跨月变更效应**：若 `tx_date` 从 `2026-10-31` 改为 `2026-11-01`，所有明细支出统计自动按 `strftime('%Y-%m', tx_date)` 从旧月度移出并计入新月度。
3. **账户表字段变动公式（Account Table Mutation Formula）**
   - **`N/A`**（V2 无 `accounts` 表）。
4. **预算池变动公式（Budget Pool & Project Tag Impact Formula）**
   - **子项归属变更（支持单子项与拆单多子项逐行修改）**：
     - 旧子项归属（旧月度池或旧专项）释放 `-prev_item_net`；新子项归属（新月度池或新专项）累加 `+new_item_net`。
   - **金额变动重算（`amountsChanged = !equalsCny(prevGross, newGross) || !equalsCny(prevNet, newNet)`）**：
     - **单子项（`items.length === 1`）**：`item_gross = h.total_gross`, `allocated_discount = h.payment_discount`, `item_net = h.total_net`。
     - **多子项（`items.length > 1`）**：
       1. 若原价变化且 `oldGrossDec > 0`，先按原价权重等比缩放各子项原价：
          $$\text{scaledGross}_i = \text{roundCny}\left(\frac{\text{prev\_item\_gross}_i}{\text{oldGross}} \times \text{newGross}\right)$$
          **原价缩放尾差由第 `0` 项吸收**：
          $$\text{diff}_{\text{gross}} = \text{newGross} - \sum_{i=0}^{N-1} \text{scaledGross}_i, \quad \text{scaledGross}_0 = \text{roundCny}(\text{scaledGross}_0 + \text{diff}_{\text{gross}})$$
       2. 设重分摊模式：`mode = (header.allocation_mode === 'MANUAL') ? 'PROPORTIONAL' : header.allocation_mode`。
       3. 调用 `allocateSplitDiscounts(splitInputs, header.total_net, mode)` 计算新 `item_gross`, `allocated_discount`, `item_net`（折扣尾差由最后一项吸收），**保证修改总额/优惠后多子项拆单依然严格守恒**。
5. **交易主子表与同步日志写入状态（Transaction Header/Items & OpLog Persistence State）**
   - **`transaction_headers` 原地更新**：`tx_date`, `total_gross`, `payment_discount`, `total_net`, `merchant_or_note`, `updated_hlc = hlc`。（注：既有 `allocation_mode` 与 `applied_voucher_id` 保持不变；如果原记录使用过 `platform_discount`，UI 层将其与 `payment_discount` 中的非零项带入编辑框提交到 `payment_discount`）。
   - **`transaction_items` 原地更新**：
     - 单子项：同步更新 `item_name`（优先 `itemPatch.item_name`，其次 `patch.merchant_or_note`）、`category_id`、`budget_pool_id`、`project_tag_id` 及金额三列。
     - 多子项：按 `u.index === idx || (u.id != null && u.id !== 0 && u.id === item.id)` 匹配 `patch.item_updates` 更新对应子项名称与归属；仅当未命中 `itemPatch` 且 `item.is_primary_item === true` 时应用顶层 `patch` 的归属字段；若 `amountsChanged`，覆盖所有子项金额三列。
   - **`sync_oplog`**：追加 1 条 `entity_type = 'TRANSACTION'`, `op_type = 'UPSERT'` 日志。

---

### 写操作 6：删除账单与卡券双向级联回滚（`deleteTransaction` & `deleteVoucher`）

> 适用场景：软删除消费流水自动退还已核销立减金并释放预算；删除购券流水级联删券；在卡包中删券级联软删购券流水。

1. **输入参数（Input Parameters）**
   - `deleteTransaction(txId: string)`
   - `deleteVoucher(voucherId: number)`

2. **前置校验（Pre-conditions & Validations）**
   - `deleteTransaction`：交易必须存在，否则抛错 `Transaction "${txId}" not found`；采用软删除（`is_deleted = 1`），保留审计痕迹与同步墓碑。
   - `deleteVoucher`：直接按 ID 查找，不存在则静默幂等返回。
   - **补充主数据删除保护**：
     - `deleteBudgetPool(poolId)`：若被 `categories.default_pool_id` 或未删除流水子项 `transaction_items.budget_pool_id` 引用，**拒绝删除**并抛错 `预算池正在被分类或交易使用，无法直接删除！请先重新分配相关分类或交易。`
     - `deleteCategory(categoryId)`：若被未删除流水子项引用，**拒绝删除**并抛错 `分类已被交易流水引用，无法直接删除！`
     - `deleteProjectTag(tagId)`：若被未删除流水子项引用，**拒绝删除**并抛错 `专项标签/心愿已被交易流水引用，无法直接删除！`

3. **账户表字段变动公式（Account Table Mutation Formula）**
   - **`N/A`**（V2 无 `accounts` 表）。
   - **双向卡券状态级联表变动**：
     - **情况 6A（`deleteTransaction` 删消费单，且 `applied_voucher_id != null`）**：
       将关联卡券重置为可用：
       `vouchers.status`: `'USED'` $\rightarrow$ `'AVAILABLE'`；`vouchers.used_tx_id`: `txId` $\rightarrow$ `null`。
     - **情况 6B（`deleteTransaction` 删购券单，即存在 `vouchers.purchase_tx_id == txId`）**：
       1. 查找所有引用这些购入卡券的消费单，将其 `transaction_headers.applied_voucher_id` 清空为 `null`；
       2. 从 `vouchers` 表物理删除这些卡券。
     - **情况 6C（在卡包调用 `deleteVoucher(id)`）**：
       1. 若 `voucher.purchase_tx_id != null`，将其关联的 `VOUCHER_BUY` 流水软删除（`is_deleted = 1`）；
       2. （仓储层同时清空消费单中引用该券的 `applied_voucher_id = null`）；
       3. 从 `vouchers` 表物理删除该卡券。

4. **预算池变动公式（Budget Pool & Project Tag Impact Formula）**
   - 对被软删除的 `EXPENSE` 流水中的所有子项 $i$：
     - 若 `items[i].project_tag_id == null`，其对应月度池 `(YYYY-MM, items[i].budget_pool_id)` 立即释放额度：
       $$\Delta\text{spent\_gross} = -\text{item\_gross}_i, \quad \Delta\text{total\_saved\_discount} = -\text{allocated\_discount}_i$$
       $$\Delta\text{spent\_net} = -\text{item\_net}_i, \quad \Delta\text{remaining\_budget} = +\text{item\_net}_i$$
     - 若 `items[i].project_tag_id != null`，对应专项已用总额回滚：
       $$\Delta\text{tag\_spent\_net} = -\text{item\_net}_i$$
   - 对被软删除的 `VOUCHER_BUY` 流水：预算池变动 **`0.00`**。

5. **交易主子表与同步日志写入状态（Transaction Header/Items & OpLog Persistence State）**
   - **`transaction_headers`**：将目标行设 `is_deleted = 1 (true)`、`updated_hlc = hlc`（注意：`transaction_items` 物理行保留，查询时由头表 `is_deleted = 0` 过滤屏蔽，便于同步重放与防误删恢复）。
   - **`sync_oplog`**：
     - `deleteTransaction`：为软删交易写入 `TRANSACTION / UPSERT`（带 `is_deleted: true`；在同步重放端按 `DELETE` 等效处理）；若回滚了核销卡券，本地引擎写入 `VOUCHER / UPSERT`（注：Flutter 端建议两端均显式补写该 `VOUCHER / UPSERT` 日志以保证跨端即时释放卡券）；若级联删除了购入卡券，为每张券写入 `VOUCHER / DELETE`。
     - `deleteVoucher`：为关联 `purchase_tx_id` 写入 `TRANSACTION` 日志（仓储层写 `DELETE`，本地引擎写 `UPSERT(is_deleted: true)`）及 `VOUCHER / DELETE`。

---

### 写操作 7：周期性规则执行与跨月结余滚存（`executeRecurringRule` & `executeMonthRollover`）

#### 操作 7A：手动触发周期性规则入账（`executeRecurringRule`）
1. **输入参数（Input Parameters）**
   - `{ id: number, txDate?: string }`
2. **前置校验（Pre-conditions & Validations）**
   - 规则 `recurring_rules[id]` 必须存在，否则抛错 `Recurring rule "${id}" not found`。
   - 规则映射默认归属：
     - `rule_type == 'FX_SUBSCRIPTION'`：`category_id = rule.category_id ?? 'CAT_DIGITAL_SUB'`, `budget_pool_id = rule.budget_pool_id ?? 'POOL_FLEX'`
     - `rule_type == 'FIXED_EXPENSE'`：`category_id = rule.category_id ?? 'CAT_TELECOM'`, `budget_pool_id = rule.budget_pool_id ?? 'POOL_FIXED'`
3. **账户表字段变动公式（Account Table Mutation Formula）**
   - **`N/A`**（V2 已移除 `accounts` 与 `AUTO_INVEST`）。
4. **预算池变动公式（Budget Pool & Project Tag Impact Formula）**
   - 全权委托调用 **写操作 1 / 写操作 4A（`recordManualTransaction`）**：
     - 若 `rule.currency == 'CNY'`：立即按 `formatCny(rule.amount)` 扣减目标月度预算池。
     - 若 `rule.currency != 'CNY'`：自动按 `DEFAULT_FX_RATES[currency]` 与全局 `102%` 冻结比例 / `1%` 返现计算预估净额，进入 `PENDING_HOLD` 状态预扣对应月度预算池。
5. **交易主子表与同步日志写入状态（Transaction Header/Items & OpLog Persistence State）**
   - 生成 1 条 `tx_type = 'EXPENSE'`, `merchant_or_note = rule.title`, `allocation_mode = 'SINGLE'` 的交易主子表记录及 `TRANSACTION / UPSERT` 日志（详见写操作 1 与写操作 4A）。

#### 操作 7B：跨月结余滚存执行（`executeMonthRollover`）
1. **输入参数（Input Parameters）**
   - `{ fromYearMonth: string ('YYYY-MM'), toYearMonth: string ('YYYY-MM') }`
2. **前置校验（Pre-conditions & Validations）**
   - 读取 `fromYearMonth` 在 `v_monthly_budget_status` 下的各预算池实时 `remaining_budget` 与 `base_allocation`。
3. **账户表字段变动公式（Account Table Mutation Formula）**
   - **`N/A`**。
4. **预算池变动公式（Budget Pool & Project Tag Impact Formula）**
   - 遍历 `budget_pools` 中每个池，依据 `pool.rollover_strategy` 计算次月 `rollover_from_prev`：
     - **`'ACCUMULATE'`（当前 4 个默认池统一默认策略）**：
       $$\text{next.rollover\_from\_prev} = \text{formatCny}(\text{fromRow?.remaining\_budget} ?? 0)$$
       （支持正结余累加到下月，也支持负超支从下月自动抵扣）。
     - **`'RESET'`（月末清零）**：
       $$\text{next.rollover\_from\_prev} = \text{'0.00'}$$
     - **`'SWEEP_TO_FUND'`（历史保留枚举）**：因 `POOL_FUND` 与划转机制已移除，该枚举在 `executeMonthRollover` 中既不置 `'0.00'` 也不滚入，实际上走默认 initial `'0.00'`，UI 亦不再提供此选项。
   - 目标月份新可用预算：$T_{\text{next}} = \text{next.base\_allocation} + \text{next.rollover\_from\_prev}$。
5. **交易主子表与同步日志写入状态（Transaction Header/Items & OpLog Persistence State）**
   - **不产生任何 `transaction_headers` / `transaction_items` 流水**。
   - **操作 `monthly_budgets` 表**：
     - 若 `(toYearMonth, pool.id)` 已存在：执行 `UPDATE monthly_budgets SET rollover_from_prev = ?`。
     - 若不存在：执行 `INSERT INTO monthly_budgets (year_month, pool_id, base_allocation, rollover_from_prev)`（其中新月 `base_allocation` 沿用 `fromRow?.base_allocation ?? '0.00'`）。
   - **Flutter 端增量同步补充**：当客户端执行跨月滚存后，应对变更的 `monthly_budgets` 行补发 `MONTHLY_BUDGET / UPSERT`（`entity_id = "${toYearMonth}:${pool.id}"`）日志以参与多端同步。

---

### 写操作 8：已废弃历史写操作与兼容清洗契约（Deprecated Writes & Migration Guards）

> 针对原 PRD 中的**「信用卡含券还款（`REPAY_COUPON` / `TRANSFER`）」、「基金定投划拨（`AUTO_INVEST`）」、「生活池划入年度基金（`SWEEP_TO_FUND`）」**三类写操作：

1. **当前写状态结论（已彻底清理移除）**
   - **输入参数 / 触发入口**：前后端**均无任何激活入口**（已从 `@ledger/core` 枚举、`@ledger/db` 表约束与方法、`@ledger/server` REST 路由、`@ledger/client` UI 与本地引擎彻底删除）。
   - **账户表字段变动公式**：`N/A`（`accounts` 表及 `account_id` / `target_account_id` 列已全量移除）。
   - **预算池变动公式**：`N/A`（`POOL_FUND`、`POOL_ASSET` 与 `POST /api/budgets/sweep-to-fund` 已移除）。
   - **交易主子表写入状态**：不再写入 `'TRANSFER'`、`rule_type = 'AUTO_INVEST'` 或 `voucher_type = 'REPAY_COUPON'` 记录。

2. **Flutter 端必须保留的历史备份导入与同步兼容清洗规则（Legacy Compatibility Guards）**
   当 Flutter 导入 Web 旧版导出的 JSON 备份（`FullSyncBundle`）或拉取早期云端 `sync_oplog` 时，必须执行与 [ledger-repository.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/db/src/ledger-repository.ts) 及 [local-replica.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/apps/client/src/sync/local-replica.ts) 完全一致的静态清洗逻辑：
   1. **账户清理**：若 JSON 含 `accounts` 数组，直接忽略/删除；若 `sync_oplog` 含 `entity_type == 'ACCOUNT'`，直接跳过不重放。
   2. **交易类型清理**：本地/迁移过滤掉历史 `tx_type == 'TRANSFER'` 的转账流水（在 SQLite 迁移时直接排除）。
   3. **卡券枚举降级映射**：遇到 `voucher_type == 'REPAY_COUPON'` 的历史卡券时，原地规范化为 **`'FREE_COUPON'`**。
   4. **定投规则过滤**：遇到 `rule_type == 'AUTO_INVEST'` 的历史周期规则时，直接过滤丢弃，不插入数据库。
   5. **废置池重映射与剔除**：若存在未被引用的 `'POOL_FUND'` 或 `'POOL_ASSET'`，从 `budget_pools` 与 `monthly_budgets` 中删除；同时将引用它们的 `categories.default_pool_id` 统一重映射为 `'POOL_FLEX'`，将 `projects_and_tags.linked_pool_id` 置为 `'POOL_FLEX'`（服务端迁移/恢复）或 `null`（本地副本清洗）。

---

## 二、【纯函数算法规范】

### 1. 全局高精度十进制配置与舍入公理（`packages/core/src/money.ts`）

- **全局配置**：`precision = 28` 有效数字位，舍入模式统一为 **`ROUND_HALF_UP`**（远离零的半数进位：如 `2.345 -> 2.35`, `2.355 -> 2.36`, `-2.345 -> -2.35`）。
- **Dart 移植特别警示**：Dart 标准库 `double.toStringAsFixed` 存在二进制浮点误差且受 `toDouble()` 精度限制；Flutter 端**必须**引入 `decimal`（如 `package:decimal/decimal.dart`），并自己封装与 `decimal.js` 完全一致的 `HALF_UP` 定点舍入函数（不能使用默认银行家舍入 `halfToEven`）。

| 纯函数名 | 输入参数与类型 | 输出结果与类型 | 精确算法与舍入规范 |
| :--- | :--- | :--- | :--- |
| `toDecimal(val)` | `string \| number \| Decimal` | `Decimal` | 解析为高精度十进制数 |
| `roundCny(val)` | `MoneyInput` | `Decimal` | 保留 **2** 位小数，`RoundingMode.HALF_UP` |
| `formatCny(val)` | `MoneyInput` | `String`（如 `"31.01"`） | 保留 **2** 位小数格式化补零，`RoundingMode.HALF_UP` |
| `roundRate(val)` | `MoneyInput` | `Decimal` | 保留 **6** 位小数，`RoundingMode.HALF_UP` |
| `formatRate(val)` | `MoneyInput` | `String`（如 `"7.200000"`） | 保留 **6** 位小数格式化补零，`RoundingMode.HALF_UP` |
| `sumCny(values)` | `List<MoneyInput>` | `Decimal` | 先逐项 `plus` 累加全精度 `Decimal`，总和最后一次性 `roundCny` |
| `equalsCny(a, b)` | `MoneyInput, MoneyInput` | `bool` | 比较 `roundCny(a) == roundCny(b)` |

---

### 2. 安全算术求值器与单品优惠算式拆分（`evaluateMathFormula`）

- **源码位置**：[dsl-parser.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/core/src/dsl-parser.ts#L262-L508)
- **严禁使用 `eval` / 动态表达式执行**。
- **输入数据结构**：`expr: String`（例：`"16.8-0.15"`, `"20-1.08*3"`, `"(15+5)*0.8"`, `"28"`）
- **输出数据结构**：
  ```dart
  class MathEvalResult {
    final String gross;    // 原价，2位小数字符串
    final String discount; // 算式自含优惠，2位小数字符串
    final String net;      // 净额，2位小数字符串
  }
  ```
- **核心算法步骤**：
  1. **词法分析（`tokenizeMathExpr`）**：跳过空白 `\s`；识别单字符 Token `+` (`PLUS`), `-` (`MINUS`), `*` (`STAR`), `/` (`SLASH`), `(` (`LPAREN`), `)` (`RPAREN`)；识别连续 `/[\d.]/` 为 `NUMBER(Decimal(numStr))`；遇到其他非法字符立即抛错。
  2. **递归下降语法求值（`RecursiveDescentMathParser`）**：
     - 优先级：`Expression -> Additive (+/-) -> Multiplicative (*//) -> Primary (+unary / -unary / NUMBER / '(' Expression ')')`。
     - 除法遇右操作数 `isZero()` 抛 `'Division by zero'`。
     - 先全表达式求值得到高精度 `netVal`。
  3. **顶层加减号切分规则（括号深度 `depth == 0`）**：
     - 从左到右扫描 `tokens` 维护括号嵌套深度 `depth`。
     - 仅当 `depth == 0` 且遇到 `PLUS` 或 `MINUS` 时切分为独立的 `TopLevelTerm(sign: '+'|'-', tokens)`；若在 `depth == 0` 处存在 `MINUS`，标记 `hasTopLevelMinus = true`。
     - **分支 A（`hasTopLevelMinus == false`，如纯数字 `"28"`、纯乘法 `"3.5*2"`、仅加法或被外层括号整体包裹 `"(20-2)*0.8"`）**：
       - `gross = formatCny(netVal)`
       - `discount = "0.00"`
       - `net = formatCny(netVal)`
     - **分支 B（`hasTopLevelMinus == true`，如 `"20-1.08*3"`）**：
       - 对每个 `TopLevelTerm` 单独递归下降求值 `termVal`：
       - 若 `term.sign == '+'`：`positiveSum += termVal`
       - 若 `term.sign == '-'`：`negativeSum += termVal`
       - 输出：`gross = formatCny(positiveSum)`, `discount = formatCny(negativeSum)`, `net = formatCny(netVal)`。

---

### 3. 极速记账 DSL 编译器与正则全集（`parseQuickInputDsl`）

- **源码位置**：[dsl-parser.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/core/src/dsl-parser.ts#L514-L1119)
- **输入数据结构**：
  ```dart
  class DslParserContext {
    final List<Category> categories;      // 默认 14 个预设分类 DEFAULT_CATEGORIES
    final List<ProjectTag> projectTags;   // 默认 3 个预设标签 DEFAULT_PROJECT_TAGS
    final List<BudgetPool>? budgetPools;
    final String? txDate;
    final FxPreferenceConfig? fxConfig;   // 默认 { defaultHoldRatio: '1.02', defaultCashbackRate: '0.01' }
  }
  ```
- **输出数据结构**：
  ```dart
  class ParsedDslItemResult {
    final String itemName;
    final String categoryId;
    final String budgetPoolId;
    final String? projectTagId;
    final String itemGross;
    final String allocatedDiscount;
    final String itemNet;
    final bool isPrimaryItem;
    final String? rawFormulaExpr;
  }

  class ParsedDslResult {
    final String txType;             // 固定为 'EXPENSE'
    final String totalGross;
    final String platformDiscount;
    final String paymentDiscount;
    final String totalNet;
    final String allocationMode;     // 'SINGLE' | 'PROPORTIONAL' | 'PRIMARY_ITEM' | 'MANUAL'
    final String originalCurrency;   // 'CNY' | 'USD' | 'JPY' | 'EUR' | 'GBP' | 'HKD'
    final String? originalAmount;
    final String exchangeRate;       // 6 位小数
    final String settlementStatus;   // 'SETTLED' | 'PENDING_HOLD'
    final String holdAmountCny;      // 2 位小数
    final String? fxCashbackRate;    // 仅 FX 路径产出
    final bool isFxDetected;
    final List<ParsedDslItemResult> items;
    final String rawInputText;
    final String merchantOrNote;
  }
  ```
- **按执行顺序排列的完整正则表达式与逻辑流**：
  1. **提取尾部实付覆盖**：
     - 正则：`=\s*([\d\.]+)`
     - 命中后 `mergedNetOverride = formatCny(match.group(1))`，并从 `working` 替换为空格 `' '`。
  2. **容错剥离遗留 `@xxx` 账户标记**：
     - 正则：`@[^\s+#=]+`（全局匹配）$\rightarrow$ 替换为空格并 `.trim()`。
  3. **外币特征唤醒检测**：
     - 条件：`working.contains('$') || RegExp(r'\bUSD\b', caseSensitive: false).hasMatch(working) || RegExp(r'\bJPY\b', caseSensitive: false).hasMatch(working) || working.contains('冻结')` $\rightarrow$ 置 `isFxDetected = true`。
  4. **提取外币预授权冻结本币金额**：
     - 正则：`冻结\s*([\d\.]+)`
     - 命中后 `holdAmountCny = formatCny(match.group(1))`，`settlementStatus = 'PENDING_HOLD'`，`isFxDetected = true`，从 `working` 移除。
  5. **提取美元符号或外币代码金额**：
     - 优先匹配美元正则：`\$([\d\.]+)` $\rightarrow$ `originalCurrency = 'USD'`，`originalAmount = formatCny(match.group(1))`。
     - 否则匹配标准币种正则：`(USD|JPY|EUR|GBP|HKD)\s*([\d\.]+)|([\d\.]+)\s*(USD|JPY|EUR|GBP|HKD)`（忽略大小写）$\rightarrow$ 若为 `'JPY'`，原额按 `roundCny(rawAmt).toFixed(0)` 取整，否则 `formatCny(rawAmt)`。
     - 若 `isFxDetected && originalAmount != null && holdAmountCny == '0.00'`：用参考汇率自动估算冻结额：
       `holdAmountCny = formatCny(roundCny(toDecimal(originalAmount) * fxRate * fxHoldRatio))`，并置 `settlementStatus = 'PENDING_HOLD'`。
  6. **多子项 `+` 分隔切割（严格区分算式内加号与子项分隔加号）**：
     - **核心正则（Unicode 属性转义）**：
       ```regex
       \s*\+\s*(?=[\p{L}\p{Script=Han}])
       ```
       *(Dart 启用 `unicode: true` 标志)*
       **行为**：仅当 `+` 号后紧邻任意字母 `\p{L}` 或中文字符 `\p{Script=Han}` 时才拆分为不同商品子项；若 `+` 后为数字或括号（如 `矿泉水 2+3`），则保留在当前子项公式内部。
  7. **单子项逐项提取与求值**：
     - **主商品标志**：以 `*` 或 `!` 开头 $\rightarrow$ `isPrimary = true` 并截去首字符。
     - **标签提取**：全局匹配 `#([^\s#=]+)`，从 `working itemStr` 中替换移除。
     - **外币单品特判**：若 `isFxDetected && originalAmount != null && rawSubItemStrings.length == 1`，剩余文本即 `item_name`（为空时兜底 `'外币消费'`），无需解析尾部人民币公式，直接交由步骤 9 的 `processMastercardFxLifecycle` 计算金额。
     - **商品名与四则算式分离主正则**：
       ```regex
       ^(.*?)\s*([\d\.\+\-\*\/\(\)]+(?:\s*[\+\-\*\/]\s*[\d\.\+\-\*\/\(\)]+)*)$
       ```
       - 组 1 为 `name`（空时兜底 `'商品支出'`），组 2 为 `formula`；若未命中，降级尝试结尾数字兜底正则 `(.*?)\s*([\d\.]+)$`，仍失败则抛错。
       - 对 `formula` 调用 `evaluateMathFormula(formula)`。
  8. **标签路由优先级与自动归类算法**：
     - `#标签` 解析优先级（`resolveTagOrCategory`，依次精确匹配别名表 / ID / Name / 双向子串包含）：
       1. `projectTags`（内置别名表 `PROJECT_TAG_ALIASES` 全小写查找 -> `id` -> `name` -> 双向子串 `.contains()`）；
       2. `budgetPools`（`id` -> `name` -> 双向子串 `.contains()`）；
       3. `categories`（内置别名表 `CATEGORY_ALIASES` -> `id` -> `name` -> 双向子串 `.contains()` -> 逗号分隔 `keywords` 精确或被包含匹配）。
     - **全局后备继承**：最后一个子项提取出的 `categoryId / poolId / projectTagId` 记录为 `global*`，前面所有缺失对应归属的子项自动继承该全局标签。
     - **专项关联与关键词最长匹配**：
       - 若仍缺 `categoryId` 但有 `projectTagId`：若为 `'TAG_JLPT_N2'` 自动补 `'CAT_EXAM_CERT'`，池沿用 `pt.linked_pool_id`。
       - 若仍缺 `categoryId`：**遍历所有分类 `keywords`（逗号分隔），选取 `itemName.toLowerCase().contains(kw.toLowerCase())` 中 `kw.length` 最大（最长关键词优先）的分类**。
       - 最终兜底：`categoryId = 'CAT_FOOD'`，`budget_pool_id = 'POOL_DAILY'`；若只有分类未定池，取 `cat.default_pool_id ?? 'POOL_DAILY'`。
  9. **汇总输出分流**：
     - **分支 1（外币预授权）**：调用 `processMastercardFxLifecycle`，输出 `settlement_status = 'PENDING_HOLD'`, `fx_cashback_rate = fxCashbackRate`, `is_fx_detected = true`, `allocation_mode = 'SINGLE'`。
     - **分支 2（存在 `mergedNetOverride`）**：调用 `allocateSplitDiscounts(items, mergedNetOverride, hasPrimary ? 'PRIMARY_ITEM' : 'PROPORTIONAL')`，优惠记入 `payment_discount`，`platform_discount = '0.00'`，`merchant_or_note = items.map(name).join(' + ')`。
     - **分支 3（无覆盖常规单/多品）**：合计各子项算式，优惠记入 `platform_discount`，`payment_discount = '0.00'`，`allocation_mode = (items.length == 1) ? 'SINGLE' : 'MANUAL'`。

---

### 4. 跨品类凑单满减分摊与 0.01 元尾差兜底算法（`allocateSplitDiscounts` & `computeOrderAllocation`）

- **源码位置**：[allocation.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/core/src/allocation.ts#L19-L286)
- **输入与输出数据结构**：
  - 输入：`items: List<SplitItemInput>`, `totalNetPaid: MoneyInput`, `mode: AllocationMode`, `manualNets?: List<MoneyInput>`
  - 输出：`List<SplitItemResult>`（每行含 2 位小数字符串 `gross`, `allocated_discount`, `net`）。
  - 复合计算器 `computeOrderAllocation(items, cashActuallyPaid, mode, voucher?, manualNets?)` 先计算：
    - `voucherCost = voucher != null ? roundCny(voucher.acquire_cost) : 0`
    - `voucherSavings = voucher != null ? roundCny(voucher.face_value - voucherCost) : 0`
    - `effectiveBudgetNetDec = roundCny(roundCny(cashActuallyPaid) + voucherCost)`
    - 再以 `effectiveBudgetNetDec` 作为目标净额调用 `allocateSplitDiscounts`。

- **`allocateSplitDiscounts` 五大互斥分支与舍入细节**：
  1. 空列表 `items.isEmpty` $\rightarrow$ 返回 `[]`。
  2. 计算 `netPaidDec = roundCny(totalNetPaid)`；`totalGrossDec = sum(toDecimal(item.gross))`（**注意：此处全精度累加 `totalGross` 后再减**）；`totalDiscountDec = roundCny(totalGrossDec - netPaidDec)`。
  3. **分支 1：`mode == 'MANUAL'`**：
     - 校验 `manualNets.length == items.length` 且 `sumCny(manualNets) == netPaidDec`（不等立即抛错）。
     - 每项：`gross = roundCny(item.gross)`，`net = roundCny(manualNets[i])`，`discount = gross - net`（`formatCny` 输出）。
  4. **分支 2：`items.length == 1 || mode == 'SINGLE'`**：
     - 第 `0` 项承担全部 `totalDiscountDec`：`net[0] = roundCny(gross[0] - totalDiscountDec)`，`allocated_discount[0] = totalDiscountDec`；其余项 `discount = 0.00`, `net = gross`。
  5. **分支 3：`totalDiscountDec <= 0`（无优惠或溢价）**：
     - 若为 `0`：全员 `allocated_discount = '0.00'`, `net = gross`。
     - 若为负数（溢价）：**最后一项 `i == items.length - 1` 吸收全部负折扣差额**，其余项折扣为 `0.00`。
  6. **分支 4：`mode == 'PRIMARY_ITEM'`（主商品独占）**：
     - 寻找首个 `item.is_primary == true` 的索引（未找到默认索引 `0`）。
     - 该目标主商品独享 `100%` 的 `totalDiscountDec`（`net = roundCny(gross - totalDiscountDec)`），其余凑单品均 `allocated_discount = '0.00', net = gross`。
  7. **分支 5：`mode == 'PROPORTIONAL'`（默认按原价比例分摊 + 最后一项尾差兜底）**：
     - 对 $i = 0 \dots N-2$（前 $N-1$ 项）：
       - `gross_i = roundCny(item_i.gross)`
       - 若 `totalGrossDec.isZero()` 则 `disc_i = 0`，否则：
         $$\text{ratio}_i = \frac{\text{gross}_i}{\text{totalGrossDec}}, \quad \text{disc}_i = \text{roundCny}(\text{totalDiscountDec} \times \text{ratio}_i)$$
       - 累计已分摊优惠：`accumulatedDiscount += disc_i`
     - **对第 $N-1$ 项（最后一项，减法尾差兜底）**：
       $$\text{disc}_{N-1} = \text{roundCny}(\text{totalDiscountDec} - \text{accumulatedDiscount})$$
     - 对所有项计算：`net_i = roundCny(gross_i - disc_i)`。
     - **重要守恒保证**：哪怕出现 3 项平分 1.00 元优惠（`0.33 + 0.33 + 0.34`），前两项 `roundCny` 后最后一项严格吸收 `±0.01` 尾差。

- **补充：编辑账单总量缩放尾差兜底（`updateTransaction` 内置）**：
  - 当编辑已有拆单单据并修改总额 `newGross != oldGross` 时：
    - 每项先计算 `scaledGrosses[i] = roundCny(item_gross[i] / oldGross * newGross)`
    - **原价缩放差额由第 `0` 项吸收**：`diff = newGross - sum(scaledGrosses)` $\rightarrow$ `scaledGrosses[0] = roundCny(scaledGrosses[0] + diff)`
    - 随后再将缩放后的子项送入 `allocateSplitDiscounts(..., newNet, mode == 'MANUAL' ? 'PROPORTIONAL' : mode)`。

---

### 5. 外币预授权与返现清算纯函数（`processMastercardFxLifecycle`）

- **源码位置**：[mastercard-fx.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/core/src/mastercard-fx.ts#L15-L101)
- **内置参考汇率常量 `DEFAULT_FX_RATES`**：
  ```json
  { "CNY": "1.000000", "USD": "7.200000", "EUR": "7.800000", "JPY": "0.048000", "GBP": "9.100000", "HKD": "0.920000" }
  ```
- **输入结构 `ProcessMastercardFxParams`**：
  `{ foreignAmount, holdAmountCny, settledAmountCny?, holdRatio = '1.02', cashbackRate = '0.01', monthlyRemainingCapCny? }`
- **计算公式与舍入顺序**：
  - **当 `settledAmountCny == null`（阶段一 `PENDING_HOLD`）**：
    1. `estimatedBase = roundCny(holdAmountDec / holdRatioDec)`
    2. `rawCashback = roundCny(estimatedBase * cashbackRateDec)`
    3. 若传 `monthlyRemainingCapCny != null`：`estimatedCashback = roundCny(min(rawCashback, max(cap, 0)))`（当前业务调用均不传此封顶，直接取 `rawCashback`）
    4. `totalNet = roundCny(estimatedBase - estimatedCashback)`
    5. `exchangeRate = formatRate(estimatedBase / foreignAmountDec)`（先 2 位舍入基准额，再用基准额除以外币原额后 6 位 `ROUND_HALF_UP`）
  - **当 `settledAmountCny != null`（阶段二 `SETTLED`）**：
    1. `settledBase = roundCny(settledAmountCny)`
    2. `rawCashback = roundCny(settledBase * cashbackRateDec)`
    3. `totalNet = roundCny(settledBase - actualCashback)`
    4. `releasedHold = roundCny(holdAmountDec - settledBase)`
    5. `exchangeRate = formatRate(settledBase / foreignAmountDec)`
    6. 返回 `hold_amount_cny = '0.00'`。

---

### 6. 饮食高频池剩余日均与月度预算聚合算法（`getMonthlyBudgetStatus` & `getDailyBudgetSummary`）

- **源码位置**：[ledger-repository.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/db/src/ledger-repository.ts#L352-L429)、[local-replica.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/apps/client/src/sync/local-replica.ts#L1954-L2064)、[BudgetPoolsDashboard.tsx](file:///c:/Users/Faneter/Documents/Projects/ledger/apps/client/src/components/BudgetPoolsDashboard.tsx#L123-L138)
- **月度预算水位聚合（`MonthlyBudgetStatusRow`）**：
  - 遍历当前月全部 `budgetPools`，按 `(yearMonth, pool.id)` 查找 `monthly_budgets` 记录（不存在时全字段默认 `'0.00'`）。
  - 筛选满足 `!tx.header.is_deleted && tx.header.tx_type == 'EXPENSE' && tx.header.tx_date.startsWith(yearMonth)` 的流水，提取其中满足 **`item.project_tag_id == null`（或 `!pool.is_monthly_budget`）且 `item.budget_pool_id == pool.id`** 的子明细累加（不经中间舍入直接累加高精度 `Decimal`，最后输出时 `formatCny`）：
    - `total_available_budget = formatCny(base_allocation + rollover_from_prev)`
    - `spent_gross = formatCny(sum(item_gross))`
    - `total_saved_discount = formatCny(sum(allocated_discount))`
    - `spent_net = formatCny(sum(item_net))`
    - `remaining_budget = formatCny(base_allocation + rollover_from_prev - swept_to_fund - spent_net)`
- **饮食高频池与通用池动态日均可用额计算（`DailyBudgetSummary`）**：
  - **当月实际天数**：`daysInMonth = DateTime(year, month + 1, 0).day`（即公历闰年/大小月真实天数，无法解析时回退 `30`）。
  - **含今日剩余天数**：
    `currentDay = int.tryParse(currentDate.substring(8, 10)) ?? 1`
    `remainingDays = max(1, daysInMonth - currentDay + 1)`
    *(注：后端 `LedgerRepository.getMonthlyBudgetStatus` 仅当 `currentDateStr.startsWith(yearMonth)` 时按 `curDay` 算剩余天数，非当月查询按整月天数 `daysInMonth` 计算；前端 `LocalLedgerEngine.getDailyBudgetSummary` 对 `remainingBudget` 先取 `Decimal.max(0, remaining)` 钳制非负后再除以 `remainingDays` 并执行 `formatCny`，后端不钳制负值)*。
  - **Flutter 移植推荐口径（与前端卡片展现 100% 对齐）**：
    ```dart
    final remainingDec = Decimal.max(Decimal.zero, parseDecimal(dailyRow.remainingBudget));
    final dailyAvailableAmount = formatCny((remainingDec / Decimal.fromInt(remainingDays)).toDecimal(scaleOnInfinitePrecision: 16));
    ```
  - **全月累计薅羊毛省钱总额**：对当月各预算池行累加 `sum(toDecimal(s.total_saved_discount))` 并 `formatCny`。

---

### 7. 跨月结余滚存、专项归档与资产日均折旧纯函数

1. **跨月结余滚存决策函数（`executeMonthRollover` in [ledger-repository.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/db/src/ledger-repository.ts#L974-L1016)）**：
   - 输入：`fromYearMonth`, `toYearMonth`, `fromStatus: List<MonthlyBudgetStatusRow>`, `pools: List<BudgetPool>`
   - 对每个 `pool`：
     - `ACCUMULATE` $\rightarrow$ `rollover = formatCny(toDecimal(fromRow?.remaining_budget ?? 0))`（负值代表上月超支，照常带负号滚入下月抵扣可用额度）
     - `RESET` $\rightarrow$ `rollover = "0.00"`
2. **专项预算自动归档判定（`isTagEffectiveActive` in [BudgetPoolsDashboard.tsx](file:///c:/Users/Faneter/Documents/Projects/ledger/apps/client/src/components/BudgetPoolsDashboard.tsx#L158-L162)）**：
   - 输入：`tag: ProjectTag`, `effectiveToday: String ('YYYY-MM-DD')`
   - 规则：
     - 若 `tag.is_active == false` $\rightarrow$ 返回 `false`（已归档）；
     - 若 `tag.end_date != null && tag.end_date!.isNotEmpty && effectiveToday.compareTo(tag.end_date!) > 0` $\rightarrow$ 返回 `false`（到期自动归档）；
     - 其余返回 `true`（进行中）。
   - 专项累计支出：`sum(item.item_net where !tx.header.is_deleted && item.project_tag_id == tag.id)`。
3. **大件固定资产日均持有成本（`getFixedAssetsWithCost` in [local-replica.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/apps/client/src/sync/local-replica.ts#L2066-L2103)）**：
   - 截止日期：`endDate = (asset.status == 'SOLD' && asset.resale_date != null) ? asset.resale_date : currentDate`
   - 持有天数：`daysHeld = max(1, floor((endDateMs - purchaseDateMs) / 86400000))`
   - 净投入成本：`netCost = toDecimal(asset.purchase_net_cost) - toDecimal(asset.resale_recovery ?? 0)`
   - 当前日均成本：`currentDailyCost = formatCny(netCost / daysHeld)`（`ROUND_HALF_UP`）
   - 达标回本进度：`targetDays = netCost / target_daily_cost`；若 `target_daily_cost > 0` 且 `targetDays > 0`，则 `progressPercent = min(100, max(0, round((daysHeld / targetDays) * 100)))`，否则 `0`。
4. **卡券自动命名纯函数（`generateVoucherTitle` in [types.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/core/src/types.ts#L164-L185)）**：
   - `typeLabel = (voucherType == 'PREPAID_COUPON') ? '立减金' : '优惠券'`
   - 解析数值 `minVal = double.tryParse(minSpend) ?? 0`，`faceVal = double.tryParse(faceValue) ?? 0`（注意 JS 中 `Number("10.00")` 会转为 `10`、`Number("5.50")` 为 `5.5`）
   - 若 `minVal > 0`：返回 ``满${minVal}减${faceVal}${typeLabel}``；否则返回 ``${faceVal}元无门槛${typeLabel}``。

---

### 8. 分布式 HLC 时钟与 OpLog 因果合并/冲突检测（`hlc-sync.ts`）

- **源码位置**：[hlc-sync.ts](file:///c:/Users/Faneter/Documents/Projects/ledger/packages/core/src/hlc-sync.ts#L18-L328)
- **HLC 格式字符串规范**：
  ```text
  ${timestampMs.toString().padStart(15, '0')}-${(counter & 0xffff).toString(16).padStart(4, '0')}-${nodeId}
  ```
  - 示例：`001794743153883-0001-flutter-mobile-01`
  - **注意**：15 位十进制毫秒时间戳 + 4 位十六进制（小写补零）计数器 + `nodeId`，保证字典序与因果全序完全等价。
- **`HybridLogicalClock` 状态转移**：
  - **`now(physicalTimeMs)`**：若 `pt > lastPhysicalTimeMs`，则 `lastPhysicalTimeMs = pt; counter = 0`；否则 `counter += 1`；返回格式化串。
  - **`receive(remoteHlc, physicalTimeMs)`**：解析 `remote`，令 `maxTime = max(lastPhysicalTimeMs, remote.timestampMs, pt)`：
    - 三者中 `lastPhysicalTimeMs == remote.timestampMs == maxTime`：`counter = max(counter, remote.counter) + 1`
    - 仅 `lastPhysicalTimeMs == maxTime`：`counter += 1`
    - 仅 `remote.timestampMs == maxTime`：`counter = remote.counter + 1`
    - `pt` 最大：`counter = 0`
    - 更新 `lastPhysicalTimeMs = maxTime` 并返回格式化串。
  - **`compare(a, b)`**：解析三元组 `(timestampMs, counter, nodeId)`，依次比较：毫秒时间数值 -> 计数器整数值 -> `nodeId` 字符串字典序。
- **`mergeOpLogEntries(existingOps, incomingOps)` 合并与三类冲突检测**：
  1. **幂等去重与全序重排**：以 `op.hlc` 为键去重合并，按 `HybridLogicalClock.compare(a.hlc, b.hlc)` 升序排序输出 `mergedOps`。
  2. **LWW 胜出实体计算**：顺序遍历 `mergedOps`，以 `"${op.entity_type}:${op.entity_id}"` 为键覆盖写入 `winningEntities`（后到的最大 HLC 胜出）。
  3. **冲突检测 1（`CONCURRENT_TX_EDIT` & `CONCURRENT_FX_SETTLE`）**：
     - 对每笔 `entity_type == 'TRANSACTION'`，分别取 `existingOps` 与 `incomingOps` 中该 ID 的最大 HLC 操作 `existOp` 与 `incomingOp`。
     - 若二者均存在，且 `existOp.node_id != incomingOp.node_id && existOp.hlc != incomingOp.hlc`：
       - 检查胜出方 payload 中是否声明 `base_hlc == loserOp.hlc`（如是则为因果演进，**不报冲突**）。
       - 比较双方 `settlement_status` 是否不同：不同则判定为 `'CONCURRENT_FX_SETTLE'`，否则为 `'CONCURRENT_TX_EDIT'`。
       - 生成冲突记录 ID：`conflict_${conflictType}_${entityId}_${loserOp.hlc}`。
  4. **冲突检测 2（`VOUCHER_DOUBLE_SPEND`）**：
     - 扫描 `winningEntities` 中全部 `entity_type == 'TRANSACTION' && op_type == 'UPSERT'` 且非空 `appliedVoucherId` 的活跃单据（跳过 `is_deleted` 判断以防并发双花漏检，具体按不同 `txId` 分组收集）。
     - 若同一张卡券被 $> 1$ 个不同 `txId` 核销：按 HLC 升序排列，**最早 HLC 判定为首销获胜方（`winner`）**，从第 2 个起每笔均生成一条 `VOUCHER_DOUBLE_SPEND` 冲突（ID：`conflict_voucher_${vKey}_${loser.txId}`）。
  5. **实体拓扑重放顺序（执行外键/依赖安全落库）**：
     `BUDGET_POOL (1)` $\rightarrow$ `CATEGORY (2)` $\rightarrow$ `PROJECT_TAG (3)` $\rightarrow$ `VOUCHER (5)` $\rightarrow$ `MONTHLY_BUDGET / BUDGET (6)` $\rightarrow$ `RECURRING_RULE (7)` $\rightarrow$ `FIXED_ASSET (8)` $\rightarrow$ `TRANSACTION (9)`。
  6. **炸机检测公理（Server Epoch Mismatch）**：
     增量同步时若本地已存 `serverEpochId` 且与服务端返回的 `serverEpochId` 不一致且 `serverOps.isEmpty`，**严禁清空本地状态**，触发 `serverResetDetected = true`，提示用户通过 `POST /api/sync/reseed` 重播恢复云端。
