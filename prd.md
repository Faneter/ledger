# 极客大学生专属：个人记账与预算管理系统需求规格说明书（PRD）与 SQL 架构

---

## 一、 文档概述与产品定位

### 1.1 背景与业务目标
本系统专为具备**高频网购凑单、跨币种（外服游戏/海外云服务）消费、信用卡/立减金高频薅羊毛、电子开发硬件投入及考证大额支出**特征的大学生/极客群体设计。系统旨在替代传统手工 Excel 预算表，彻底解决以下四大核心账务痛点：
1. **分类与场景解耦**：解决“物品自然属性（如数码配件、床单）”与“消费发生目的（如 VR 娱乐、梅雨季换新、JLPT 考证）”在单维分类下的归类冲突。
2. **预算粒度动态平衡**：解决月初无法精确预测十余个细分类目花销、导致大量正常开支被迫塞入“应急备用金”的问题。
3. **复杂优惠与凑单精准核算**：支持跨品类合并凑单满减的自动等比分摊（含尾差兜底）、预购立减金核销及信用卡还款券收益归集。
4. **多层级账户与外币预授权闭环**：完美适配“花呗/信用卡 + 主力银联卡 + 双万事网联借记卡（102% 预授权冻结与 1% 返现）+ 校园饭卡 + 支付宝指数基金定投”的四层账户体系。

### 1.2 核心财务不变量（System Invariants）
* **本位币锚定原则**：系统唯一记账本位币与预算扣减货币为人民币（`CNY`）。所有外币交易在入账与扣减预算时，必须锁定为历史交易时点的折算人民币净额（`net_amount`），严禁随日后汇率波动篡改历史账单。
* **收支与转账隔离原则**：信用卡/花呗在**消费发生时**扣减当月预算并增加账户负债；使用借记卡**偿还信用卡/花呗、充值饭卡、划拨指数基金定投**时，均定性为「内部转账（`TRANSFER`）」，仅改变资产/负债分布，绝不二次扣减常规消费预算（定投单独占用月初储蓄划拨额）。
* **订单头与明细行守恒定律**：对于任意一笔交易主表记录（`transaction_headers`），其下属所有子商品明细行（`transaction_items`）的原价之和、分摊优惠之和、实付净额之和，必须严格等于主表对应的总额字段：
  $$\sum_{i=1}^{N} \text{item\_gross}_i = \text{total\_gross}, \quad \sum_{i=1}^{N} \text{allocated\_discount}_i = \text{total\_discount}, \quad \sum_{i=1}^{N} \text{item\_net}_i = \text{total\_net}$$

---

## 二、 核心功能模块需求规格（Functional Specifications）

### 模块 1：四层账户矩阵与卡包管理（Account & Voucher Matrix）

#### 1.1 账户分级与呈现规则
系统将用户的资金账户划分为四个职能层级，并在记账下拉列表中按优先级动态展示：
1. **日常信用支付层（`CREDIT`）**：支付宝花呗、主力信用卡（1 张）。默认置顶选中；余额以负数展示代表当前待还账单负债。
2. **核心资金结算层（`DEBIT_MAIN` / `PREPAID`）**：主力银联借记卡（1 张）、微信零钱、校园饭卡。用于承接生活费转入、信用账户还款、饭卡充值及定投扣款。
3. **外币预授权专层（`DEBIT_FX`）**：万事网联借记卡 A、万事网联借记卡 B。平时折叠于二级菜单，当识别到记账输入含外币符号（`$` / `USD` / `JPY`）时自动置顶唤醒。支持维护**「账面余额（`book_balance`）」**与**「可用余额（`available_balance` = 账面余额 - 102% 预授权冻结额）」**双指标。
4. **投资与睡眠归档层（`INVESTMENT` / `DORMANT`）**：
   * **支付宝指数基金账户**：仅维护`累计投入本金（Cost Basis）`与`最新市值（Market Value）`。每月定投自动累加本金；用户月末手动更新一次市值，系统自动计算浮动盈亏：
     $$\text{浮动盈亏} = \text{Market Value} - \text{Cost Basis}$$
   * **低频睡眠借记卡（数张）**：开启 `is_folded = TRUE`，在日常记账选卡器中彻底隐藏，仅在「净资产总览」页面参与总额汇总。

#### 1.2 优惠券与立减金卡包（Voucher Wallet）
* **有偿购券入库**：如花费 `5.99 元` 购买 `10.00 元微信立减金`。此时记一笔 `5.99 元` 的购券预付流水（资金进入虚拟卡包），生成一张面值 `10.00 元`、购入成本 `5.99 元`、净优惠潜力 `4.01 元` 的待核销卡券。
* **消费核销抵扣**：后续在食堂或超市消费满额勾选该券时，系统自动将该笔消费的实付额扣减 `10.00 元`，同时将预付卡包中的 `5.99 元` 购券成本结转计入该笔消费的实际支出成本，并将净省金额 `4.01 元` 计入月度「薅羊毛省钱榜」。

---

### 模块 2：松紧结合的二级预算池与多维标签体系（Budget & Tagging Engine）

#### 2.1 四大月度预算池（Budget Pools）
抛弃月初对十余个细分类目进行死板预测的做法，改为**“按预算池控总额、按细分类目记流水”**：
1. **固定刚需与定投池（`POOL_FIXED`）**：每月 1 日自动锁定划扣，包含：固定话费（86 元）、指数基金定投（60 元）、游戏大小月卡固定预留（如 68/30 元）、固定理发（20 元）。
2. **高频生活池（`POOL_DAILY`）**：包含日常饮食（三餐、水果、零食饮料囤货）与基础洗护消耗（公共洗衣机 2~3 元/次、纸巾、洗衣液）。核心监控指标为**动态日均可用额度**：
   $$\text{今日剩余日均可用额度} = \frac{\text{高频池月度总额} - \text{本月累计已用净额}}{\text{本月剩余天数（含今日）}}$$
3. **月度弹性发展池（`POOL_FLEX`）**：合并原有的服饰、日用百货、打印耗材、市内交通、电子电路开发（MCU/传感器/耗材）、非固定游戏与数字服务（如域名续费、软件买断）。共享约 `350~450 元/月` 的总弹性水位，小类之间自动互补，彻底消除将正常学习/数字开销塞入“应急备用金”的现象。
4. **纯粹医疗与突发应急池（`POOL_EMERGENCY`）**：严格限定为生病买药门诊（如维生素、失眠门诊、皮肤冷冻治疗）与突发意外损坏维修（如自行车爆胎、iPad 故障、梅雨季床品发霉换新）。

#### 2.2 预算外的双层蓄水池（Sinking Fund & Capital Asset）
独立于月度常规生活费（如 1,500 元/月）之外，设立两个跨期资金池：
1. **年度专项基金池（`POOL_SINKING_FUND`）**：采用「立项制」，用于管理可预见的阶段性大额支出。例如创建项目标签 `#JLPT_N2考试`，将跨越多月的报名费（550 元）、考点青旅住宿（113 元）、题库软件（32 元）及往返路费统一挂载于该项目下，从专项基金池核销，不污染当月生活费进度条。
2. **固定资产与大件数码库（`POOL_ASSET`）**：用于管理二手 iPhone 13 mini（1,150 元）、希捷 3T 机械硬盘及硬盘盒（409.8 元）等大件购置。支持开启**持有日均成本追踪（Cost Per Day）**及二手回血冲抵计算：
   $$\text{当前持有日均成本} = \frac{\text{购入净价} - \text{二手售出回血金额}}{\max(\text{当前日期} - \text{购入日期}, 1)}$$

#### 2.3 月末结余滚存策略（Rollover Strategy）
* **累加滚存（`ACCUMULATE`）**：适用于弹性池与医疗池，上月结余（或超支负数）自动滚入下月对应池子的初始可用额度。
* **清零并归集至专项基金（`SWEEP_TO_FUND`）**：适用于高频饮食池。若当月饮食大幅结余（如 10 月结余 181.16 元），月末结算时可一键将结余划入「年度专项基金池」，用于对冲考证或购买数码大件的开销。

---

### 模块 3：跨品类凑单满减分摊引擎（Split & Discount Allocation Engine）

当用户在电商平台将不同预算类目的商品合并下单以触发平台券或信用卡满减时，系统提供以下三种分摊策略：

#### 3.1 策略 A：按商品原价等比自动分摊 + 尾差兜底（`PROPORTIONAL`，系统默认）
设父订单包含 $N$ 个子商品，第 $i$ 个子商品的原价（或扣除单品独享券后的小计）为 $P_i$，订单总原价为 $G = \sum_{i=1}^{N} P_i$，合并支付总优惠（含平台跨店满减与信用卡满减）为 $D_{\text{total}}$，实付总净额为 $N_{\text{total}} = G - D_{\text{total}}$。

* 对于前 $N-1$ 个子商品（$i = 1, 2, \dots, N-1$）：
  $$D_i = \text{round}\left(D_{\text{total}} \times \frac{P_i}{G}, 2\right), \quad \text{Net}_i = P_i - D_i$$
* 对于第 $N$ 个子商品（自动吸收四舍五入产生的 `0.01` 元尾差）：
  $$D_N = D_{\text{total}} - \sum_{i=1}^{N-1} D_i, \quad \text{Net}_N = P_N - D_N$$

#### 3.2 策略 B：指定主商品独享优惠（`PRIMARY_ITEM`）
* 当用户为买某件核心商品（如 98 元开发板）而顺手凑单一件小商品（如 3 元零食）以触发满 100 减 10 元优惠时，勾选开发板为「主商品」，系统将凑单零食按原价 `3.00 元` 记入饮食，将 `10.00 元` 优惠全额抵扣在开发板上（净记 `88.00 元`）。

#### 3.3 策略 C：手动指定分摊（`MANUAL`）
* 允许用户手动输入各子项的实付金额，系统实时校验 $\sum \text{Net}_i = N_{\text{total}}$ 后放行保存。

---

### 模块 4：万事网联外币借记卡状态机（Mastercard CN Debit FX State Machine）

针对万事网联借记卡“交易时按 102% 预授权冻结人民币 $\rightarrow$ T+1/T+2 清算解冻差额 $\rightarrow$ 1% 消费返现”的业务特性，系统设计三态流转机制：

```
[交易发生: 输入外币原额与102%冻结额] 
       │
       ▼
┌──────────────────────────────────────────────────────────┐
│ 状态 1: PENDING_HOLD (预授权挂起态)                      │
│ • 账户层: frozen_amount += 冻结额 (可用余额实时减少102%) │
│ • 预算层: 按 (冻结额 / 1.02) * (1 - 1%) 预估净额暂扣预算 │
│ • UI表现: 首页置顶显示「待清算确认」橙色角标             │
└──────────────────────────────────────────────────────────┘
       │
       │ (1~2天后收到银行清算入账通知，用户输入正式扣款额 C_settled)
       ▼
┌──────────────────────────────────────────────────────────┐
│ 状态 2: SETTLED (已清算锁定态)                           │
│ • 账户层: frozen_amount -= 原冻结额 (释放102%冻结)       │
│           book_balance  -= C_settled (扣除真实清算本币)  │
│ • 返现层: 自动计算 1% 返现 R = round(C_settled * 0.01, 2)│
│           (若返现实时到账，book_balance += R)            │
│ • 预算层: 最终锁定净支出 net_amount = C_settled - R      │
│ • 汇率层: 自动反推并永久冻结真实结算汇率 C_settled / FX  │
└──────────────────────────────────────────────────────────┘
```

---

### 模块 5：极速公式与自然语言解析器（Quick-Parse Input DSL）

为延续用户在 Excel 中一行输入公式的高效习惯，记账输入框支持如下领域特定语法（DSL）：

| 典型记账场景 | 极速输入语法示例 | 解析器自动生成的结构化结果 |
| :--- | :--- | :--- |
| **单分类多笔合并含立减** | `咸蛋黄拌面 16.8-0.15 + 饭卡充值 20-1.08*3 #饮食` | 自动拆解为 2 条子明细：原价合计 `36.80`，优惠合计 `3.39`，实付净额 `33.41`，全部归入「饮食」分类。 |
| **跨品类凑单信用卡满减** | `牛奶 28 #饮食 + 晾衣架 12 #日用 + 排针 15 #电子 = 50 @招行信用卡` | 识别原价合计 `55.00`，实付 `50.00`，自动反推信用卡优惠 `5.00`，按比例分摊后生成 3 条子明细：`25.45` / `10.91` / `13.64`。 |
| **万事达外币预授权消费** | `Porkbun域名 $4.35 冻结31.95 #数字服务 @万事达A` | 识别币种 `USD`、原额 `4.35`、状态 `PENDING_HOLD`、冻结本币 `31.95`，反推预估清算额 `31.32`、预估 1% 返现 `0.31`、暂扣预算 `31.01`。 |
| **信用卡/花呗用券还款** | `还款 @花呗 500 - 还款券 5 从 @主力银联卡` | 生成内部转账：银联卡 `-495.00`，花呗待还负债冲销 `+500.00`，差额 `5.00` 计入「信用卡还款券收益」。 |

---

## 三、 全套数据库建表脚本（SQL Schema - PostgreSQL / SQLite 兼容版）

以下脚本采用标准关系型数据库语法设计（原生适配 PostgreSQL，若在本地客户端使用 SQLite 仅需将 `SERIAL` 替换为 `INTEGER PRIMARY KEY AUTOINCREMENT`），包含完整的主外键约束、索引、视图及初始化种子数据。

```sql
-- ============================================================================
-- 极客大学生个人记账与预算系统 - 核心数据库建表脚本 (DDL & Seed Data)
-- 适用引擎: PostgreSQL 14+ / SQLite 3.35+
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. 账户与资产矩阵表 (accounts)
-- 覆盖：花呗、信用卡、主力银联借记卡、双万事达外币借记卡、校园饭卡、指数基金、折叠卡
-- ----------------------------------------------------------------------------
CREATE TABLE accounts (
    id                  VARCHAR(32) PRIMARY KEY,
    name                VARCHAR(64) NOT NULL,
    account_role        VARCHAR(24) NOT NULL CHECK (account_role IN (
                            'CREDIT',       -- 信用账户（花呗/信用卡）
                            'DEBIT_MAIN',   -- 主力银联借记卡/微信零钱
                            'DEBIT_FX',     -- 万事网联外币借记卡（支持102%预授权冻结）
                            'PREPAID',      -- 预付囤货账户（校园饭卡）
                            'INVESTMENT',   -- 投资账户（支付宝指数基金）
                            'DORMANT'       -- 不常用睡眠借记卡（默认折叠）
                        )),
    currency            VARCHAR(8) NOT NULL DEFAULT 'CNY',
    
    -- 核心余额指标（单位：元）
    book_balance        NUMERIC(12, 2) NOT NULL DEFAULT 0.00, -- 账面余额（信用账户为负数代表负债；基金账户代表累计投入本金）
    frozen_amount       NUMERIC(12, 2) NOT NULL DEFAULT 0.00, -- 预授权冻结金额（专用于万事网联102%冻结）
    market_value        NUMERIC(12, 2) DEFAULT NULL,          -- 仅INVESTMENT账户使用：月底手动更新的最新基金市值
    credit_limit        NUMERIC(12, 2) DEFAULT NULL,          -- 仅CREDIT账户使用：授信总额度
    
    -- 外币卡与信用账单自动化配置参数
    fx_hold_ratio       NUMERIC(5, 3) NOT NULL DEFAULT 1.000, -- 预授权冻结比例（万事达卡设为 1.020）
    fx_cashback_rate    NUMERIC(5, 4) NOT NULL DEFAULT 0.0000,-- 消费返现比例（万事达卡设为 0.0100 即 1%）
    fx_monthly_cap      NUMERIC(10, 2) DEFAULT NULL,          -- 单卡单月返现封顶金额（人民币）
    billing_day         SMALLINT DEFAULT NULL CHECK (billing_day BETWEEN 1 AND 31),
    repayment_day       SMALLINT DEFAULT NULL CHECK (repayment_day BETWEEN 1 AND 31),
    
    -- UI 交互控制
    is_default_pay      BOOLEAN NOT NULL DEFAULT FALSE,       -- 是否为默认日常支付方式
    is_folded           BOOLEAN NOT NULL DEFAULT FALSE,       -- 是否在日常记账选卡器中折叠隐藏
     include_in_networth BOOLEAN NOT NULL DEFAULT TRUE,        -- 是否计入个人总净资产
    sort_order          SMALLINT NOT NULL DEFAULT 100,
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------------------------
-- 2. 预算池定义表 (budget_pools)
-- 解决“月初无法预测细项”：粗粒度控池子，细粒度记分类
-- ----------------------------------------------------------------------------
CREATE TABLE budget_pools (
    id                  VARCHAR(32) PRIMARY KEY,
    name                VARCHAR(64) NOT NULL,
    pool_type           VARCHAR(24) NOT NULL CHECK (pool_type IN (
                            'FIXED',        -- 固定刚需与定投池（话费/月卡/理发/基金定投）
                            'DAILY',        -- 高频生活池（饮食/日常洗护，按日均管控）
                            'FLEX',         -- 月度弹性发展池（服饰/日用/打印/交通/电子开发/软件订阅）
                            'EMERGENCY',    -- 纯粹医疗与意外维修池
                            'SINKING_FUND', -- 年度专项基金池（预算外立项：如JLPT考证）
                            'CAPITAL_ASSET' -- 大件固定资产购置池（如买手机/机械硬盘）
                        )),
    is_monthly_budget   BOOLEAN NOT NULL DEFAULT TRUE,        -- TRUE=纳入月度1500元常规预算；FALSE=预算外专项/资产池
    rollover_strategy   VARCHAR(24) NOT NULL DEFAULT 'ACCUMULATE' CHECK (rollover_strategy IN (
                            'ACCUMULATE',   -- 结余/超支自动滚入下月同池
                            'RESET',        -- 月末清零
                            'SWEEP_TO_FUND' -- 月末结余自动划入年度专项基金池
                        )),
    description         TEXT,
    sort_order          SMALLINT NOT NULL DEFAULT 100
);

-- ----------------------------------------------------------------------------
-- 3. 商品/服务基础属性分类表 (categories)
-- 只管“钱花在什么物品属性上”，与“消费场景/项目标签”彻底正交解耦
-- ----------------------------------------------------------------------------
CREATE TABLE categories (
    id                  VARCHAR(32) PRIMARY KEY,
    parent_id           VARCHAR(32) REFERENCES categories(id),
    name                VARCHAR(64) NOT NULL,
    default_pool_id     VARCHAR(32) NOT NULL REFERENCES budget_pools(id),
    icon_name           VARCHAR(32),
    keywords            TEXT,                                 -- 极速输入框自动匹配词库，逗号分隔，如 '牛奶,华莱士,塔斯汀,饭卡,芬达'
    sort_order          SMALLINT NOT NULL DEFAULT 100
);

-- ----------------------------------------------------------------------------
-- 4. 月度预算分配与结余滚存快照表 (monthly_budgets)
-- 对应原 Excel 表第 2~4 行及第 34 行的跨月结转逻辑
-- ----------------------------------------------------------------------------
CREATE TABLE monthly_budgets (
    id                  SERIAL PRIMARY KEY,
    year_month          CHAR(7) NOT NULL,                     -- 格式 '2026-11'
    pool_id             VARCHAR(32) NOT NULL REFERENCES budget_pools(id),
    base_allocation     NUMERIC(10, 2) NOT NULL DEFAULT 0.00, -- 本月新分配基础预算（如饮食 620.00）
    rollover_from_prev  NUMERIC(10, 2) NOT NULL DEFAULT 0.00, -- 上月滚入结余（可为负数，如日用品超支 -51.40）
    reserved_fixed      NUMERIC(10, 2) NOT NULL DEFAULT 0.00, -- 池内固定预留冻结额（如游戏月卡固定预留 79.00）
    swept_to_fund       NUMERIC(10, 2) NOT NULL DEFAULT 0.00, -- 月末结算时转入专项基金池的金额
    note                TEXT,
    UNIQUE (year_month, pool_id)
);

-- ----------------------------------------------------------------------------
-- 5. 跨期场景标签与专项项目表 (projects_and_tags)
-- 用于串联如 #JLPT_N2考试（报名+青旅+题库）、#单片机开发、#囤货 等跨分类跨月场景
-- ----------------------------------------------------------------------------
CREATE TABLE projects_and_tags (
    id                  VARCHAR(32) PRIMARY KEY,
    name                VARCHAR(64) NOT NULL UNIQUE,          -- 如 'JLPT_N2考试', 'MSPM0开发', '宿舍换季', '靠存货度日'
    tag_type            VARCHAR(24) NOT NULL CHECK (tag_type IN (
                            'PROJECT',      -- 专项立项（可绑定目标总预算，跨月追踪）
                            'SCENE',        -- 消费场景标签
                            'STOCK_CONSUME' -- 零元消耗打卡标记（如：吃存货/刷先前充值的饭卡）
                        )),
    target_budget       NUMERIC(10, 2) DEFAULT NULL,          -- 专项总预算上限（如考 N2 预算 800.00 元）
    linked_pool_id      VARCHAR(32) REFERENCES budget_pools(id),
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------------------------
-- 6. 优惠券与立减金虚拟卡包表 (vouchers)
-- 管理有偿购买的立减金（如 5.99 买 10 元微信立减金）、满减神券、还款券
-- ----------------------------------------------------------------------------
CREATE TABLE vouchers (
    id                  SERIAL PRIMARY KEY,
    title               VARCHAR(128) NOT NULL,                -- 如 '微信支付10元立减金', '招行满10.01-10饭卡券'
    voucher_type        VARCHAR(24) NOT NULL CHECK (voucher_type IN (
                            'PREPAID_COUPON', -- 有偿购入立减金（存在购券成本）
                            'FREE_COUPON',    -- 免费领取的满减券/立减券
                            'REPAY_COUPON'    -- 信用卡/花呗还款立减券
                        )),
    face_value          NUMERIC(10, 2) NOT NULL,              -- 抵扣面额（如 10.00）
    acquire_cost        NUMERIC(10, 2) NOT NULL DEFAULT 0.00, -- 购券实付成本（如 5.99；免费券为 0.00）
    min_spend           NUMERIC(10, 2) NOT NULL DEFAULT 0.00, -- 使用门槛（如 10.01）
    status              VARCHAR(16) NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN (
                            'AVAILABLE', 'USED', 'EXPIRED', 'REFUNDED'
                        )),
    purchase_tx_id      VARCHAR(36) DEFAULT NULL,             -- 购入该券时的关联支付流水ID
    used_tx_id          VARCHAR(36) DEFAULT NULL,             -- 核销该券时的关联消费流水ID
    expire_date         DATE DEFAULT NULL,
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------------------------
-- 7. 交易流水主表 - 订单头 (transaction_headers)
-- 负责与银行卡/花呗账单对账、处理外币预授权冻结与清算、管理合并支付总金额
-- ----------------------------------------------------------------------------
CREATE TABLE transaction_headers (
    id                  VARCHAR(36) PRIMARY KEY,              -- UUID 或格式如 'TX_20261112_001'
    tx_date             DATE NOT NULL,                        -- 交易归属日期（用于按天统计日均饮食）
    tx_timestamp        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    tx_type             VARCHAR(24) NOT NULL CHECK (tx_type IN (
                            'EXPENSE',          -- 常规/专项支出
                            'INCOME',           -- 收入（生活费拨入/奖学金/兼职）
                            'TRANSFER',         -- 内部转账（还信用卡/充饭卡/基金定投划转）
                            'VOUCHER_BUY',      -- 购买立减金（资金转入卡包成本池）
                            'CASHBACK_OFFSET'   -- 事后独立到账的信用卡返现冲抵
                        )),
    
    -- 账户关联
    account_id          VARCHAR(32) NOT NULL REFERENCES accounts(id),
    target_account_id   VARCHAR(32) REFERENCES accounts(id),  -- 仅 TRANSFER 类型使用（如转入花呗/指数基金/饭卡）
    
    -- 本位币（CNY）核心金额三元组：total_gross - (platform_discount + payment_discount) = total_net
    total_gross         NUMERIC(12, 2) NOT NULL,              -- 订单商品原价总额（本币）
    platform_discount   NUMERIC(12, 2) NOT NULL DEFAULT 0.00, -- 电商平台级优惠（跨店满减/店铺券/红包）
    payment_discount    NUMERIC(12, 2) NOT NULL DEFAULT 0.00, -- 支付通道级优惠（信用卡满减/立减金净省额/1%外币返现/还款券）
    total_net           NUMERIC(12, 2) NOT NULL,              -- 银行卡/花呗最终实际入账净额（本币）
    
    -- 跨品类凑单优惠分摊模式
    allocation_mode     VARCHAR(20) NOT NULL DEFAULT 'PROPORTIONAL' CHECK (allocation_mode IN (
                            'SINGLE',           -- 单品无拆分
                            'PROPORTIONAL',     -- 按原价权重等比分摊（尾差兜底）
                            'PRIMARY_ITEM',     -- 主商品独享全部优惠
                            'MANUAL'            -- 手动指定各子项净额
                        )),
    
    -- 外币交易与万事网联 102% 预授权清算专用字段
    original_currency   VARCHAR(8) NOT NULL DEFAULT 'CNY',
    original_amount     NUMERIC(12, 2) DEFAULT NULL,          -- 外币消费原额（如 4.35 USD 或 1500 JPY）
    exchange_rate       NUMERIC(12, 6) DEFAULT 1.000000,      -- 最终锁定的结算汇率（total_gross / original_amount）
    settlement_status   VARCHAR(20) NOT NULL DEFAULT 'SETTLED' CHECK (settlement_status IN (
                            'PENDING_HOLD',     -- 万事网联 102% 预授权冻结挂起中
                            'SETTLED',          -- 已正式清算入账锁定
                            'REFUNDED'          -- 已全额或部分退货退款
                        )),
    hold_amount_cny     NUMERIC(12, 2) NOT NULL DEFAULT 0.00, -- 当前占用的预授权冻结人民币金额（清算后置 0.00）
    settled_at          TIMESTAMP DEFAULT NULL,               -- 正式清算确认时间
    
    raw_input_text      TEXT,                                 -- 保存用户在极速输入框敲入的原始算式文本，便于回溯编辑
    merchant_or_note    TEXT,
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------------------------
-- 8. 交易拆分明细子表 - 预算核销行 (transaction_items)
-- 负责将一笔合并凑单交易精准拆解到不同分类与预算池中
-- ----------------------------------------------------------------------------
CREATE TABLE transaction_items (
    id                  SERIAL PRIMARY KEY,
    header_id           VARCHAR(36) NOT NULL REFERENCES transaction_headers(id) ON DELETE CASCADE,
    item_name           VARCHAR(128) NOT NULL,                -- 具体商品名称（如 '芬达6瓶', 'MSPM0开发板', 'JLPT报名费'）
    category_id         VARCHAR(32) NOT NULL REFERENCES categories(id),
    budget_pool_id      VARCHAR(32) NOT NULL REFERENCES budget_pools(id),
    project_tag_id      VARCHAR(32) REFERENCES projects_and_tags(id), -- 关联如 #JLPT_N2考试
    
    -- 子项本位币（CNY）分摊后三元组：item_gross - allocated_discount = item_net
    item_gross          NUMERIC(12, 2) NOT NULL,              -- 子商品原价
    allocated_discount  NUMERIC(12, 2) NOT NULL DEFAULT 0.00, -- 分摊到的优惠金额
    item_net            NUMERIC(12, 2) NOT NULL,              -- 最终扣减对应预算池的净支出金额
    
    is_primary_item     BOOLEAN NOT NULL DEFAULT FALSE,       -- 在 PRIMARY_ITEM 分摊模式下是否为主商品
    raw_formula_expr    VARCHAR(64) DEFAULT NULL              -- 保留原始输入算式片段，如 '20-1.08*3'
);

-- ----------------------------------------------------------------------------
-- 9. 大件固定资产与寿命摊销追踪表 (fixed_assets)
-- 对应二手 iPhone 13 mini、希捷 3T 硬盘等预算外资本化支出
-- ----------------------------------------------------------------------------
CREATE TABLE fixed_assets (
    id                  SERIAL PRIMARY KEY,
    asset_name          VARCHAR(128) NOT NULL,                -- 如 '二手 iPhone 13 mini', '希捷3T监控级硬盘+硬盘盒'
    purchase_item_id    INT REFERENCES transaction_items(id),
    purchase_date       DATE NOT NULL,
    purchase_net_cost   NUMERIC(10, 2) NOT NULL,              -- 购入实付净价（如 1150.00）
    target_daily_cost   NUMERIC(8, 2) DEFAULT 2.00,           -- 期望回本目标日均成本（如 2.00 元/天）
    status              VARCHAR(16) NOT NULL DEFAULT 'IN_USE' CHECK (status IN (
                            'IN_USE', 'SOLD', 'RETIRED'
                        )),
    resale_date         DATE DEFAULT NULL,
    resale_recovery     NUMERIC(10, 2) NOT NULL DEFAULT 0.00, -- 二手卖出回血金额
    note                TEXT
);

-- ----------------------------------------------------------------------------
-- 10. 周期性固定账单、订阅与定投自动化规则表 (recurring_rules)
-- 管理每月1日话费、指数基金定投、游戏大小月卡、Porkbun域名年费提醒
-- ----------------------------------------------------------------------------
CREATE TABLE recurring_rules (
    id                  SERIAL PRIMARY KEY,
    title               VARCHAR(64) NOT NULL,                 -- 如 '每月固定话费(移动8+电信29+联通49)', '支付宝指数基金定投', 'Porkbun域名续费'
    rule_type           VARCHAR(24) NOT NULL CHECK (rule_type IN (
                            'FIXED_EXPENSE',    -- 固定支出（话费/理发）
                            'AUTO_INVEST',      -- 基金定投划转（银联卡 -> 指数基金）
                            'FX_SUBSCRIPTION'   -- 外币周期订阅（日服月卡/海外域名）
                        )),
    cron_cycle          VARCHAR(16) NOT NULL CHECK (cron_cycle IN ('MONTHLY', 'YEARLY')),
    trigger_day         SMALLINT NOT NULL,                    -- 每月几号触发（如 1 号）
    currency            VARCHAR(8) NOT NULL DEFAULT 'CNY',
    amount              NUMERIC(10, 2) NOT NULL,              -- 原币种金额（如 86.00 CNY 或 10.37 USD）
    account_id          VARCHAR(32) NOT NULL REFERENCES accounts(id),
    target_account_id   VARCHAR(32) REFERENCES accounts(id),  -- 定投目标账户
    category_id         VARCHAR(32) REFERENCES categories(id),
    budget_pool_id      VARCHAR(32) REFERENCES budget_pools(id),
    auto_reserve_budget BOOLEAN NOT NULL DEFAULT TRUE,        -- 月初是否自动在预算池中冻结该笔额度
    is_active           BOOLEAN NOT NULL DEFAULT TRUE
);

-- ----------------------------------------------------------------------------
-- 11. 高频查询索引与核心分析视图 (Indexes & Analytical Views)
-- ----------------------------------------------------------------------------
CREATE INDEX idx_tx_headers_date ON transaction_headers(tx_date);
CREATE INDEX idx_tx_headers_account ON transaction_headers(account_id);
CREATE INDEX idx_tx_headers_status ON transaction_headers(settlement_status);
CREATE INDEX idx_tx_items_pool ON transaction_items(budget_pool_id);
CREATE INDEX idx_tx_items_category ON transaction_items(category_id);
CREATE INDEX idx_tx_items_project ON transaction_items(project_tag_id);

-- 视图 1：账户实时双轨余额看板（自动计算手机银行可用余额与基金浮动盈亏）
CREATE VIEW v_account_dashboard AS
SELECT 
    id,
    name,
    account_role,
    currency,
    book_balance,
    frozen_amount,
    (book_balance - frozen_amount) AS available_balance, -- 与手机银行App实时核对的可用余额
    market_value,
    CASE 
        WHEN account_role = 'INVESTMENT' AND market_value IS NOT NULL 
        THEN (market_value - book_balance)
        ELSE 0.00 
    END AS unrealized_pnl,                               -- 指数基金浮动盈亏
    is_folded
FROM accounts
ORDER BY sort_order;

-- 视图 2：月度预算池执行水位与剩余额度实时看板
CREATE VIEW v_monthly_budget_status AS
SELECT 
    mb.year_month,
    bp.id AS pool_id,
    bp.name AS pool_name,
    bp.pool_type,
    mb.base_allocation,
    mb.rollover_from_prev,
    (mb.base_allocation + mb.rollover_from_prev) AS total_available_budget,
    mb.reserved_fixed,
    COALESCE(SUM(ti.item_gross), 0.00) AS spent_gross,
    COALESCE(SUM(ti.allocated_discount), 0.00) AS total_saved_discount, -- 本池薅羊毛累计省钱额
    COALESCE(SUM(ti.item_net), 0.00) AS spent_net,                      -- 实际消耗预算净额
    (mb.base_allocation + mb.rollover_from_prev - COALESCE(SUM(ti.item_net), 0.00)) AS remaining_budget
FROM monthly_budgets mb
JOIN budget_pools bp ON mb.pool_id = bp.id
LEFT JOIN transaction_headers th 
    ON TO_CHAR(th.tx_date, 'YYYY-MM') = mb.year_month 
    AND th.tx_type = 'EXPENSE'
LEFT JOIN transaction_items ti 
    ON ti.header_id = th.id 
    AND ti.budget_pool_id = bp.id
GROUP BY mb.year_month, bp.id, bp.name, bp.pool_type, mb.base_allocation, mb.rollover_from_prev, mb.reserved_fixed
ORDER BY mb.year_month DESC, bp.sort_order ASC;

-- ============================================================================
-- 12. 初始种子数据 (Seed Data) —— 完全贴合用户真实账户与 9~11 月账本结构
-- ============================================================================

-- 12.1 初始化四层账户体系
INSERT INTO accounts (id, name, account_role, book_balance, frozen_amount, fx_hold_ratio, fx_cashback_rate, is_default_pay, is_folded, sort_order) VALUES
('ACC_HUABEI',     '支付宝花呗',         'CREDIT',     0.00, 0.00, 1.000, 0.0000, TRUE,  FALSE, 10),
('ACC_CC_MAIN',    '主力信用卡',         'CREDIT',     0.00, 0.00, 1.000, 0.0000, FALSE, FALSE, 20),
('ACC_UNION_MAIN', '主力银联借记卡',     'DEBIT_MAIN', 0.00, 0.00, 1.000, 0.0000, FALSE, FALSE, 30),
('ACC_CAMPUS_CARD','校园饭卡(预充值)',   'PREPAID',    0.00, 0.00, 1.000, 0.0000, FALSE, FALSE, 40),
('ACC_MC_DEBIT_A', '万事网联借记卡 A',   'DEBIT_FX',   0.00, 0.00, 1.020, 0.0100, FALSE, FALSE, 50),
('ACC_MC_DEBIT_B', '万事网联借记卡 B',   'DEBIT_FX',   0.00, 0.00, 1.020, 0.0100, FALSE, FALSE, 60),
('ACC_ALIPAY_ETF', '支付宝指数基金定投', 'INVESTMENT', 0.00, 0.00, 1.000, 0.0000, FALSE, FALSE, 70),
('ACC_DORMANT_01', '备用低频借记卡(折叠)','DORMANT',    0.00, 0.00, 1.000, 0.0000, FALSE, TRUE,  99);

-- 12.2 初始化六大预算池（4个常规月度池 + 2个跨期专项/资产池）
INSERT INTO budget_pools (id, name, pool_type, is_monthly_budget, rollover_strategy, sort_order) VALUES
('POOL_FIXED',     '固定刚需与定投池',   'FIXED',         TRUE,  'RESET',         10),
('POOL_DAILY',     '高频饮食与洗护池',   'DAILY',         TRUE,  'SWEEP_TO_FUND', 20),
('POOL_FLEX',      '月度弹性发展池',     'FLEX',          TRUE,  'ACCUMULATE',    30),
('POOL_EMERGENCY', '医疗与突发应急池',   'EMERGENCY',     TRUE,  'ACCUMULATE',    40),
('POOL_FUND',      '年度专项考证基金池', 'SINKING_FUND',  FALSE, 'ACCUMULATE',    50),
('POOL_ASSET',     '数码大件固定资产库', 'CAPITAL_ASSET', FALSE, 'ACCUMULATE',    60);

-- 12.3 初始化商品属性分类与自动匹配词库
INSERT INTO categories (id, name, default_pool_id, keywords, sort_order) VALUES
('CAT_FOOD',       '餐饮零食与水饮', 'POOL_DAILY',     '饭卡,食堂,华莱士,塔斯汀,牛奶,芬达,可乐,面,面包,水果,甘果子,鱼干', 10),
('CAT_CLEAN',      '日常洗护与消耗', 'POOL_DAILY',     '洗衣服,洗衣液,纸巾,抽纸,牙线,牙膏,洗发水', 20),
('CAT_TELECOM',    '通信话费与理发', 'POOL_FIXED',     '话费,移动,电信,联通,理发,剪头', 30),
('CAT_GAME_FIXED', '游戏固定大小月卡','POOL_FIXED',    '小月卡,大月卡,空月祝福,珍珠纪行', 40),
('CAT_CLOTH',      '服饰鞋帽与床品', 'POOL_FLEX',      '短袖,裤子,内裤,袜子,床单,被套,鞋子', 50),
('CAT_DAILY_GOODS','宿舍日用百货',   'POOL_FLEX',      '衣架,挂钩,泡面碗,指甲剪,卷尺,理线器,书架,电池,打气筒', 60),
('CAT_EE_DEV',     '电子电路与开发', 'POOL_FLEX',      'MSP430,MSPM0,开发板,J-Link,示波器,探头,排针,电容,电阻,焊接', 70),
('CAT_DIGITAL_SUB','软件订阅与外设', 'POOL_FLEX',      '域名,Porkbun,阿里云,MOJITEST,鼠标垫,数据线,磁吸镜片,Pico', 80),
('CAT_STUDY_PRINT','打印与学习资料', 'POOL_FLEX',      '打印,复印,教材,题库,文具', 90),
('CAT_TRAFFIC',    '日常市内交通',   'POOL_FLEX',      '公交,地铁,单车,打车', 100),
('CAT_MEDICAL',    '医疗买药与保健', 'POOL_EMERGENCY', '维生素,溃疡,医院,门诊,冷冻,碘伏,棉签,药', 110),
('CAT_REPAIR',     '突发损坏与维修', 'POOL_EMERGENCY', '修车,内外胎,卡槽,维修,发霉替换', 120),
('CAT_EXAM_CERT',  '考证报名与差旅', 'POOL_FUND',      'JLPT,N2,报名费,护照,港澳通行证,青旅,考点住宿', 130),
('CAT_MAJOR_ASSET','数码大件购置',   'POOL_ASSET',     'iPhone,手机,机械硬盘,希捷,固态硬盘,显示器', 140);

-- 12.4 初始化专项项目标签
INSERT INTO projects_and_tags (id, name, tag_type, target_budget, linked_pool_id) VALUES
('TAG_JLPT_N2',    'JLPT_N2考试专项', 'PROJECT',       800.00, 'POOL_FUND'),
('TAG_MCU_LAB',    '单片机硬件实验',   'SCENE',         NULL,   'POOL_FLEX'),
('TAG_STOCK_EAT',  '靠存货/刷饭卡度日','STOCK_CONSUME', NULL,   'POOL_DAILY');

COMMIT;
```

---

## 四、 核心算法参考实现（Python 伪代码可直接移植）

在后端或本地业务层中，处理**「跨品类凑单满减分摊」**与**「万事网联 102% 预授权清算」**的两个核心纯函数实现如下：

```python
from decimal import Decimal, ROUND_HALF_UP
from typing import List, Dict

def round_cny(val: Decimal) -> Decimal:
    """标准人民币四舍五入保留两位小数"""
    return val.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

def allocate_split_discounts(
    items: List[Dict], 
    total_net_paid: Decimal, 
    mode: str = "PROPORTIONAL"
) -> List[Dict]:
    """
    跨品类凑单满减自动分摊算法（含尾差修正兜底）
    :param items: [{"name": "牛奶", "gross": Decimal("28.00"), "category_id": "CAT_FOOD", "is_primary": False}, ...]
    :param total_net_paid: 银行卡/花呗实际支付总额，如 Decimal("50.00")
    :param mode: 'PROPORTIONAL' (等比分摊) | 'PRIMARY_ITEM' (主商品独享)
    """
    total_gross = sum(item["gross"] for item in items)
    total_discount = total_gross - total_net_paid
    
    if total_discount <= Decimal("0.00") or len(items) == 1:
        for item in items:
            item["allocated_discount"] = total_discount if len(items) == 1 else Decimal("0.00")
            item["net"] = item["gross"] - item["allocated_discount"]
        return items

    if mode == "PRIMARY_ITEM":
        primary_idx = next((i for i, x in enumerate(items) if x.get("is_primary")), 0)
        for i, item in enumerate(items):
            item["allocated_discount"] = total_discount if i == primary_idx else Decimal("0.00")
            item["net"] = item["gross"] - item["allocated_discount"]
        return items

    # 默认：PROPORTIONAL 按原价比例分摊 + 最后一项尾差兜底
    accumulated_discount = Decimal("0.00")
    for i in range(len(items) - 1):
        ratio = items[i]["gross"] / total_gross
        disc = round_cny(total_discount * ratio)
        items[i]["allocated_discount"] = disc
        items[i]["net"] = items[i]["gross"] - disc
        accumulated_discount += disc

    # 最后一项自动吸收 0.01 元四舍五入尾差，确保 sum(net) == total_net_paid 恒成立
    last_item = items[-1]
    last_item["allocated_discount"] = total_discount - accumulated_discount
    last_item["net"] = last_item["gross"] - last_item["allocated_discount"]
    return items


def process_mastercard_fx_lifecycle(
    foreign_amount: Decimal,
    hold_amount_cny: Decimal,
    settled_amount_cny: Decimal = None,
    hold_ratio: Decimal = Decimal("1.02"),
    cashback_rate: Decimal = Decimal("0.01")
) -> Dict:
    """
    万事网联借记卡：102% 预授权冻结 -> 正式清算解冻 + 1% 返现状态机计算
    """
    if settled_amount_cny is None:
        # 阶段 1：消费当下（PENDING_HOLD 挂起态）
        estimated_base = round_cny(hold_amount_cny / hold_ratio)
        estimated_cashback = round_cny(estimated_base * cashback_rate)
        return {
            "status": "PENDING_HOLD",
            "hold_amount_cny": hold_amount_cny,
            "total_gross": estimated_base,
            "payment_discount": estimated_cashback,
            "total_net": estimated_base - estimated_cashback,
            "exchange_rate": round(estimated_base / foreign_amount, 6)
        }
    else:
        # 阶段 2：T+1/T+2 银行清算通知到达（SETTLED 锁定态）
        actual_cashback = round_cny(settled_amount_cny * cashback_rate)
        released_hold = hold_amount_cny - settled_amount_cny
        return {
            "status": "SETTLED",
            "hold_amount_cny": Decimal("0.00"),
            "released_to_available": released_hold,
            "total_gross": settled_amount_cny,
            "payment_discount": actual_cashback,
            "total_net": settled_amount_cny - actual_cashback,
            "exchange_rate": round(settled_amount_cny / foreign_amount, 6)
        }
```