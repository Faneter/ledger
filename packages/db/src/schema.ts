/**
 * 极客大学生个人记账与预算管理系统 - SQLite 数据库建表与种子数据
 * 严格遵循 PRD 第三章与 Stage 4 规格要求
 */

export const SCHEMA_SQL = `
-- ----------------------------------------------------------------------------
-- 1. 预算池定义表 (budget_pools)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS budget_pools (
    id                  VARCHAR(32) PRIMARY KEY,
    name                VARCHAR(64) NOT NULL,
    pool_type           VARCHAR(24) NOT NULL CHECK (pool_type IN (
                            'FIXED',        -- 固定刚需与定投池
                            'DAILY',        -- 高频生活池
                            'FLEX',         -- 月度弹性发展池
                            'EMERGENCY',    -- 纯粹医疗与突发意外维修池
                            'SINKING_FUND', -- 年度专项基金池
                            'CAPITAL_ASSET' -- 大件固定资产购置池
                        )),
    is_monthly_budget   BOOLEAN NOT NULL DEFAULT 1,
    rollover_strategy   VARCHAR(24) NOT NULL DEFAULT 'ACCUMULATE' CHECK (rollover_strategy IN (
                            'ACCUMULATE',   -- 结余/超支自动滚入下月同池
                            'RESET',        -- 月末清零
                            'SWEEP_TO_FUND' -- 月末结余自动划入年度专项基金池
                        )),
    description         TEXT,
    sort_order          SMALLINT NOT NULL DEFAULT 100
);

-- ----------------------------------------------------------------------------
-- 2. 商品/服务基础属性分类表 (categories)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
    id                  VARCHAR(32) PRIMARY KEY,
    parent_id           VARCHAR(32) REFERENCES categories(id),
    name                VARCHAR(64) NOT NULL,
    default_pool_id     VARCHAR(32) NOT NULL REFERENCES budget_pools(id),
    icon_name           VARCHAR(32),
    keywords            TEXT,
    sort_order          SMALLINT NOT NULL DEFAULT 100
);

-- ----------------------------------------------------------------------------
-- 3. 月度预算分配与结余滚存快照表 (monthly_budgets)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS monthly_budgets (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    year_month          CHAR(7) NOT NULL,
    pool_id             VARCHAR(32) NOT NULL REFERENCES budget_pools(id),
    base_allocation     NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    rollover_from_prev  NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    reserved_fixed      NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    swept_to_fund       NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    note                TEXT,
    UNIQUE (year_month, pool_id)
);

-- ----------------------------------------------------------------------------
-- 4. 跨期场景标签与专项项目表 (projects_and_tags)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects_and_tags (
    id                  VARCHAR(32) PRIMARY KEY,
    name                VARCHAR(64) NOT NULL UNIQUE,
    tag_type            VARCHAR(24) NOT NULL CHECK (tag_type IN (
                            'PROJECT',      -- 专项立项
                            'SCENE',        -- 消费场景标签
                            'STOCK_CONSUME' -- 零元消耗打卡标记
                        )),
    target_budget       NUMERIC(10, 2) DEFAULT NULL,
    start_date          DATE DEFAULT NULL,
    end_date            DATE DEFAULT NULL,
    is_active           BOOLEAN NOT NULL DEFAULT 1,
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------------------------
-- 5. 优惠券与立减金虚拟卡包表 (vouchers)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vouchers (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    title               VARCHAR(128) NOT NULL,
    voucher_type        VARCHAR(24) NOT NULL CHECK (voucher_type IN (
                            'PREPAID_COUPON', -- 有偿购入立减金
                            'FREE_COUPON'     -- 免费领取的满减券/立减券
                        )),
    face_value          NUMERIC(10, 2) NOT NULL,
    acquire_cost        NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    min_spend           NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    status              VARCHAR(16) NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN (
                            'AVAILABLE', 'USED', 'EXPIRED', 'REFUNDED'
                        )),
    purchase_tx_id      VARCHAR(36) DEFAULT NULL,
    used_tx_id          VARCHAR(36) DEFAULT NULL,
    expire_date         DATE DEFAULT NULL,
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------------------------
-- 6. 交易流水主表 - 订单头 (transaction_headers)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transaction_headers (
    id                  VARCHAR(36) PRIMARY KEY,
    tx_date             DATE NOT NULL,
    tx_timestamp        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    tx_type             VARCHAR(24) NOT NULL CHECK (tx_type IN (
                            'EXPENSE',          -- 常规/专项支出
                            'INCOME',           -- 收入
                            'VOUCHER_BUY',      -- 购买立减金
                            'VOUCHER_EXPIRE'    -- 购入立减金过期损耗
                        )),
    total_gross         NUMERIC(12, 2) NOT NULL,
    platform_discount   NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    payment_discount    NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    total_net           NUMERIC(12, 2) NOT NULL,
    allocation_mode     VARCHAR(20) NOT NULL DEFAULT 'PROPORTIONAL' CHECK (allocation_mode IN (
                            'SINGLE',
                            'PROPORTIONAL',
                            'PRIMARY_ITEM',
                            'MANUAL'
                        )),
    original_currency   VARCHAR(8) NOT NULL DEFAULT 'CNY',
    original_amount     NUMERIC(12, 2) DEFAULT NULL,
    exchange_rate       NUMERIC(12, 6) DEFAULT 1.000000,
    settlement_status   VARCHAR(20) NOT NULL DEFAULT 'SETTLED' CHECK (settlement_status IN (
                            'PENDING_HOLD',     -- 102% 预授权挂起
                            'SETTLED',          -- 正式清算锁定
                            'REFUNDED'          -- 退货退款
                        )),
    hold_amount_cny     NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    fx_cashback_rate    NUMERIC(5, 4) DEFAULT NULL,
    settled_at          TIMESTAMP DEFAULT NULL,
    raw_input_text      TEXT,
    merchant_or_note    TEXT,
    applied_voucher_id  INTEGER DEFAULT NULL REFERENCES vouchers(id),
    is_deleted          INTEGER NOT NULL DEFAULT 0,
    updated_hlc         VARCHAR(64) DEFAULT NULL,
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------------------------
-- 7. 交易拆分明细子表 - 预算核销行 (transaction_items)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transaction_items (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    header_id           VARCHAR(36) NOT NULL REFERENCES transaction_headers(id) ON DELETE CASCADE,
    item_name           VARCHAR(128) NOT NULL,
    category_id         VARCHAR(32) NOT NULL REFERENCES categories(id),
    budget_pool_id      VARCHAR(32) NOT NULL REFERENCES budget_pools(id),
    project_tag_id      VARCHAR(32) REFERENCES projects_and_tags(id),
    item_gross          NUMERIC(12, 2) NOT NULL,
    allocated_discount  NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    item_net            NUMERIC(12, 2) NOT NULL,
    is_primary_item     BOOLEAN NOT NULL DEFAULT 0,
    raw_formula_expr    VARCHAR(64) DEFAULT NULL
);

-- ----------------------------------------------------------------------------
-- 8. 大件固定资产与寿命摊销追踪表 (fixed_assets)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fixed_assets (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_name          VARCHAR(128) NOT NULL,
    purchase_item_id    INT REFERENCES transaction_items(id),
    purchase_date       DATE NOT NULL,
    purchase_net_cost   NUMERIC(10, 2) NOT NULL,
    target_daily_cost   NUMERIC(8, 2) DEFAULT 2.00,
    status              VARCHAR(16) NOT NULL DEFAULT 'IN_USE' CHECK (status IN (
                            'IN_USE', 'SOLD', 'RETIRED'
                        )),
    resale_date         DATE DEFAULT NULL,
    resale_recovery     NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    note                TEXT
);

-- ----------------------------------------------------------------------------
-- 9. 周期性固定账单与订阅自动化规则表 (recurring_rules)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recurring_rules (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    title               VARCHAR(64) NOT NULL,
    rule_type           VARCHAR(24) NOT NULL CHECK (rule_type IN (
                            'FIXED_EXPENSE',    -- 固定支出
                            'FX_SUBSCRIPTION'   -- 外币订阅
                        )),
    cron_cycle          VARCHAR(16) NOT NULL CHECK (cron_cycle IN ('MONTHLY', 'YEARLY')),
    trigger_day         SMALLINT NOT NULL,
    currency            VARCHAR(8) NOT NULL DEFAULT 'CNY',
    amount              NUMERIC(10, 2) NOT NULL,
    category_id         VARCHAR(32) REFERENCES categories(id),
    budget_pool_id      VARCHAR(32) REFERENCES budget_pools(id),
    auto_reserve_budget BOOLEAN NOT NULL DEFAULT 1,
    is_active           BOOLEAN NOT NULL DEFAULT 1
);

-- ----------------------------------------------------------------------------
-- 10. 分布式同步与冲突处理表
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_meta (
    key                 VARCHAR(64) PRIMARY KEY,
    value               TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_oplog (
    hlc                 VARCHAR(64) PRIMARY KEY,
    node_id             VARCHAR(64) NOT NULL,
    entity_type         VARCHAR(32) NOT NULL,
    entity_id           VARCHAR(64) NOT NULL,
    op_type             VARCHAR(16) NOT NULL,
    payload_json        TEXT NOT NULL,
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sync_conflicts (
    id                  VARCHAR(128) PRIMARY KEY,
    conflict_type       VARCHAR(32) NOT NULL,
    entity_id           VARCHAR(64) NOT NULL,
    winner_hlc          VARCHAR(64) NOT NULL,
    loser_hlc           VARCHAR(64) NOT NULL,
    winner_summary      TEXT NOT NULL,
    loser_summary       TEXT NOT NULL,
    loser_payload_json  TEXT NOT NULL,
    status              VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------------------------
-- 11. 高频查询索引
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_tx_headers_date ON transaction_headers(tx_date);
CREATE INDEX IF NOT EXISTS idx_tx_headers_status ON transaction_headers(settlement_status);
CREATE INDEX IF NOT EXISTS idx_tx_items_pool ON transaction_items(budget_pool_id);
CREATE INDEX IF NOT EXISTS idx_tx_items_category ON transaction_items(category_id);
CREATE INDEX IF NOT EXISTS idx_tx_items_project ON transaction_items(project_tag_id);

-- ----------------------------------------------------------------------------
-- 12. 核心分析视图
-- ----------------------------------------------------------------------------

-- 视图：月度预算池执行水位与剩余额度实时看板
CREATE VIEW IF NOT EXISTS v_monthly_budget_status AS
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
    COALESCE(SUM(ti.allocated_discount), 0.00) AS total_saved_discount,
    COALESCE(SUM(ti.item_net), 0.00) AS spent_net,
    (mb.base_allocation + mb.rollover_from_prev - mb.swept_to_fund - COALESCE(SUM(ti.item_net), 0.00)) AS remaining_budget
FROM monthly_budgets mb
JOIN budget_pools bp ON mb.pool_id = bp.id
LEFT JOIN transaction_headers th 
    ON strftime('%Y-%m', th.tx_date) = mb.year_month 
    AND th.tx_type = 'EXPENSE'
    AND th.is_deleted = 0
LEFT JOIN transaction_items ti 
    ON ti.header_id = th.id 
    AND ti.budget_pool_id = bp.id
    AND (ti.project_tag_id IS NULL OR bp.is_monthly_budget = 0)
GROUP BY mb.year_month, bp.id, bp.name, bp.pool_type, mb.base_allocation, mb.rollover_from_prev, mb.reserved_fixed, mb.swept_to_fund
ORDER BY mb.year_month DESC, bp.sort_order ASC;
`;

export const SEED_SQL = `
-- ----------------------------------------------------------------------------
-- 1. 初始化四大常规月度预算池
-- ----------------------------------------------------------------------------
INSERT OR IGNORE INTO budget_pools (id, name, pool_type, is_monthly_budget, rollover_strategy, sort_order) VALUES
('POOL_FIXED',     '固定刚需与定投池',   'FIXED',         1, 'ACCUMULATE',    10),
('POOL_DAILY',     '高频饮食与洗护池',   'DAILY',         1, 'ACCUMULATE',    20),
('POOL_FLEX',      '月度弹性发展池',     'FLEX',          1, 'ACCUMULATE',    30),
('POOL_EMERGENCY', '医疗与突发应急池',   'EMERGENCY',     1, 'ACCUMULATE',    40);

-- ----------------------------------------------------------------------------
-- 2. 初始化商品属性分类与自动匹配词库
-- ----------------------------------------------------------------------------
INSERT OR IGNORE INTO categories (id, name, default_pool_id, keywords, sort_order) VALUES
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
('CAT_EXAM_CERT',  '考证报名与差旅', 'POOL_FLEX',      'JLPT,N2,报名费,护照,港澳通行证,青旅,考点住宿', 130),
('CAT_MAJOR_ASSET','数码大件购置',   'POOL_FLEX',      'iPhone,手机,机械硬盘,希捷,固态硬盘,显示器', 140);

-- ----------------------------------------------------------------------------
-- 3. 初始化专项项目标签
-- ----------------------------------------------------------------------------
INSERT OR IGNORE INTO projects_and_tags (id, name, tag_type, target_budget) VALUES
('TAG_JLPT_N2',    'JLPT_N2考试专项', 'PROJECT',       800.00),
('TAG_MCU_LAB',    '单片机硬件实验',   'SCENE',         NULL),
('TAG_STOCK_EAT',  '靠存货/刷饭卡度日','STOCK_CONSUME', NULL);

-- ----------------------------------------------------------------------------
-- 4. 默认月度预算 2026-11 (4个常规月度池合计 1500.00 元)
-- ----------------------------------------------------------------------------
INSERT OR IGNORE INTO monthly_budgets (year_month, pool_id, base_allocation, rollover_from_prev, reserved_fixed, swept_to_fund) VALUES
('2026-11', 'POOL_FIXED',     204.00, 0.00, 0.00, 0.00),
('2026-11', 'POOL_DAILY',     650.00, 0.00, 0.00, 0.00),
('2026-11', 'POOL_FLEX',      450.00, 0.00, 0.00, 0.00),
('2026-11', 'POOL_EMERGENCY', 196.00, 0.00, 0.00, 0.00);

-- ----------------------------------------------------------------------------
-- 5. 默认 2 条周期性规则
-- ----------------------------------------------------------------------------
INSERT OR IGNORE INTO recurring_rules (id, title, rule_type, cron_cycle, trigger_day, currency, amount, category_id, budget_pool_id, auto_reserve_budget, is_active) VALUES
(1, '每月固定话费(移动8+电信29+联通49)', 'FIXED_EXPENSE',   'MONTHLY', 1, 'CNY', 86.00, 'CAT_TELECOM', 'POOL_FIXED', 1, 1),
(2, 'Porkbun域名续费',                    'FX_SUBSCRIPTION', 'YEARLY',  1, 'USD', 10.37, 'CAT_DIGITAL_SUB', 'POOL_FLEX', 1, 1);

-- ----------------------------------------------------------------------------
-- 6. 默认 2 件固定资产
-- ----------------------------------------------------------------------------
INSERT OR IGNORE INTO fixed_assets (id, asset_name, purchase_item_id, purchase_date, purchase_net_cost, target_daily_cost, status, resale_recovery, note) VALUES
(1, '二手 iPhone 13 mini', NULL, '2026-09-01', 1150.00, 2.00, 'IN_USE', 0.00, '购于 2026-09-01，目标日均 2 元'),
(2, '希捷3T监控级硬盘+硬盘盒', NULL, '2026-10-01', 409.80, 1.00, 'IN_USE', 0.00, '购于 2026-10-01，目标日均 1 元');

-- ----------------------------------------------------------------------------
-- 7. 默认 2 张可用卡券
-- ----------------------------------------------------------------------------
INSERT OR IGNORE INTO vouchers (id, title, voucher_type, face_value, acquire_cost, min_spend, status) VALUES
(1, '微信支付10元立减金',     'PREPAID_COUPON', 10.00, 5.99, 10.01, 'AVAILABLE'),
(2, '美团外卖5元无门槛优惠券', 'FREE_COUPON',     5.00, 0.00,  5.01, 'AVAILABLE');
`;
