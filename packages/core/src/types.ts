/**
 * 极客大学生个人记账与预算管理系统 - 核心领域模型与类型契约
 * 所有金额字段统一采用 string 表示两位小数精确金额（如 "31.95"），避免 JSON/浮点数序列化精度丢失。
 */

/**
 * 外币预授权与返现全局偏好配置
 */
export interface FxPreferenceConfig {
  defaultHoldRatio: string;
  defaultCashbackRate: string;
}

// ============================================================================
// 1. 预算池与分类相关类型定义
// ============================================================================

/**
 * 预算池类型
 * - FIXED: 固定刚需与定投池
 * - DAILY: 高频生活池（日均动态管控）
 * - FLEX: 月度弹性发展池
 * - EMERGENCY: 纯粹医疗与突发意外维修池
 * - SINKING_FUND: 年度专项基金池（预算外跨期立项）
 * - CAPITAL_ASSET: 固定资产大件购置池
 */
export type PoolType =
  | 'FIXED'
  | 'DAILY'
  | 'FLEX'
  | 'EMERGENCY'
  | 'SINKING_FUND'
  | 'CAPITAL_ASSET';

/**
 * 月末结余滚存策略
 * - ACCUMULATE: 累加滚入下月同池（结余或超支）
 * - RESET: 月末清零
 * - SWEEP_TO_FUND: 月末结余一键划入年度专项基金池
 */
export type RolloverStrategy = 'ACCUMULATE' | 'RESET' | 'SWEEP_TO_FUND';

/**
 * 预算池实体接口 (budget_pools)
 */
export interface BudgetPool {
  id: string;
  name: string;
  pool_type: PoolType;
  is_monthly_budget: boolean;
  rollover_strategy: RolloverStrategy;
  description: string | null;
  sort_order: number;
}

/**
 * 商品/服务属性分类 (categories)
 */
export interface Category {
  id: string;
  parent_id: string | null;
  name: string;
  default_pool_id: string;
  icon_name: string | null;
  keywords: string | null;
  sort_order: number;
}

/**
 * 月度预算分配与快照 (monthly_budgets)
 */
export interface MonthlyBudget {
  id: number;
  year_month: string;
  pool_id: string;
  base_allocation: string;
  rollover_from_prev: string;
  reserved_fixed: string;
  swept_to_fund: string;
  note: string | null;
}

/**
 * 月度预算状态分析看板行 (v_monthly_budget_status)
 */
export interface MonthlyBudgetStatusRow {
  year_month: string;
  pool_id: string;
  pool_name: string;
  pool_type: PoolType;
  base_allocation: string;
  rollover_from_prev: string;
  total_available_budget: string;
  reserved_fixed: string;
  spent_gross: string;
  total_saved_discount: string;
  spent_net: string;
  remaining_budget: string;
}

// ============================================================================
// 3. 跨期场景与专项标签相关类型定义
// ============================================================================

/**
 * 标签类型
 * - PROJECT: 专项立项（跨月追踪、目标总额）
 * - SCENE: 消费场景标签
 * - STOCK_CONSUME: 零元消耗打卡标记（刷存货/饭卡）
 */
export type TagType = 'PROJECT' | 'SCENE' | 'STOCK_CONSUME' | 'OFFSET';

/**
 * 跨期专项立项与场景标签 (projects_and_tags)
 */
export interface ProjectTag {
  id: string;
  name: string;
  tag_type: TagType;
  target_budget: string | null;
  linked_pool_id: string | null;
  is_active: boolean;
  start_date?: string | null;
  end_date?: string | null;
  created_at?: string;
}

// ============================================================================
// 4. 卡包与优惠券相关类型定义
// ============================================================================

/**
 * 优惠券类型
 * - PREPAID_COUPON: 有偿购入立减金（如 5.99 买 10 元立减金）
 * - FREE_COUPON: 免费领取立减券/满减券
 */
export type VoucherType = 'PREPAID_COUPON' | 'FREE_COUPON';

/**
 * 优惠券核销状态
 */
export type VoucherStatus = 'AVAILABLE' | 'USED' | 'EXPIRED' | 'REFUNDED';

/**
 * 优惠券与立减金实体接口 (vouchers)
 */
export interface Voucher {
  id: number;
  title: string;
  voucher_type: VoucherType;
  face_value: string;
  acquire_cost: string;
  min_spend: string;
  status: VoucherStatus;
  purchase_tx_id: string | null;
  used_tx_id: string | null;
  expire_date: string | null;
  created_at?: string;
}

/**
 * 自动生成卡券/立减金默认标题
 */
export function generateVoucherTitle(
  voucherType: VoucherType | string,
  faceValue: string | number,
  minSpend: string | number,
  _acquireCost?: string | number
): string {
  let typeLabel = '优惠券';
  if (voucherType === 'PREPAID_COUPON') {
    typeLabel = '立减金';
  } else if (voucherType === 'FREE_COUPON') {
    typeLabel = '优惠券';
  }

  const minVal = Number(minSpend || 0);
  const faceVal = Number(faceValue || 0);

  if (minVal > 0) {
    return `满${minVal}减${faceVal}${typeLabel}`;
  } else {
    return `${faceVal}元无门槛${typeLabel}`;
  }
}

/**
 * 获取本地时区的今日日期字符串 (YYYY-MM-DD)，避免 UTC 偏移导致凌晨差一天
 */
export function getLocalTodayDateStr(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 获取本地时区的当前年月字符串 (YYYY-MM)
 */
export function getLocalYearMonthStr(now: Date = new Date()): string {
  return getLocalTodayDateStr(now).slice(0, 7);
}

// ============================================================================
// 5. 交易流水与凑单分摊相关类型定义
// ============================================================================

/**
 * 交易类型
 * - EXPENSE: 常规/专项支出
 * - INCOME: 收入（生活费/兼职/奖学金）
 * - VOUCHER_BUY: 购买立减金（资金转入虚拟卡包）
 * - VOUCHER_EXPIRE: 购入立减金过期损耗
 */
export type TransactionType =
  | 'EXPENSE'
  | 'INCOME'
  | 'VOUCHER_BUY'
  | 'VOUCHER_EXPIRE';

/**
 * 凑单满减分摊模式
 * - SINGLE: 单品无拆分
 * - PROPORTIONAL: 按原价等比分摊（最后一项尾差兜底）
 * - PRIMARY_ITEM: 主商品独享全部优惠
 * - MANUAL: 手动指定各子项净额
 */
export type AllocationMode =
  | 'SINGLE'
  | 'PROPORTIONAL'
  | 'PRIMARY_ITEM'
  | 'MANUAL';

/**
 * 万事达外币预授权清算状态机状态
 * - PENDING_HOLD: 102% 预授权挂起中
 * - SETTLED: 正式清算锁定
 * - REFUNDED: 退款
 */
export type SettlementStatus = 'PENDING_HOLD' | 'SETTLED' | 'REFUNDED';

/**
 * 交易订单头实体接口 (transaction_headers)
 */
export interface TransactionHeader {
  id: string;
  tx_date: string;
  tx_timestamp: string;
  tx_type: TransactionType;
  total_gross: string;
  platform_discount: string;
  payment_discount: string;
  total_net: string;
  allocation_mode: AllocationMode;
  original_currency: string;
  original_amount: string | null;
  exchange_rate: string | null;
  settlement_status: SettlementStatus;
  hold_amount_cny: string;
  fx_cashback_rate?: string | null;
  settled_at: string | null;
  raw_input_text: string | null;
  merchant_or_note: string | null;
  applied_voucher_id?: number | null;
  is_deleted?: boolean;
  updated_hlc?: string;
  created_at?: string;
}

/**
 * 交易子明细实体接口 (transaction_items)
 */
export interface TransactionItem {
  id: number;
  header_id: string;
  item_name: string;
  category_id: string;
  budget_pool_id: string;
  project_tag_id: string | null;
  item_gross: string;
  allocated_discount: string;
  item_net: string;
  is_primary_item: boolean;
  raw_formula_expr: string | null;
}

/**
 * 交易聚合实体（用于创建/更新完整记账单据）
 */
export interface TransactionAggregate {
  header: TransactionHeader;
  items: TransactionItem[];
  appliedVoucherId?: number | null;
}

// ============================================================================
// 6. 固定资产与周期性规则相关类型定义
// ============================================================================

/**
 * 固定资产使用状态
 */
export type FixedAssetStatus = 'IN_USE' | 'SOLD' | 'RETIRED';

/**
 * 固定资产实体接口 (fixed_assets)
 */
export interface FixedAsset {
  id: number;
  asset_name: string;
  purchase_item_id: number | null;
  purchase_date: string;
  purchase_net_cost: string;
  target_daily_cost: string | null;
  status: FixedAssetStatus;
  resale_date: string | null;
  resale_recovery: string;
  note: string | null;
}

/**
 * 带有动态日均持有成本与回本进度的资产模型
 */
export interface FixedAssetWithCost extends FixedAsset {
  daysHeld: number;
  currentDailyCost: string;
  progressPercent: number;
}

/**
 * 周期性规则触发类型
 */
export type RecurringRuleType = 'FIXED_EXPENSE' | 'FX_SUBSCRIPTION';

/**
 * 周期频次
 */
export type CronCycle = 'MONTHLY' | 'YEARLY';

/**
 * 周期性账单与自动订阅规则 (recurring_rules)
 */
export interface RecurringRule {
  id: number;
  title: string;
  rule_type: RecurringRuleType;
  cron_cycle: CronCycle;
  trigger_day: number;
  currency: string;
  amount: string;
  category_id: string | null;
  budget_pool_id: string | null;
  auto_reserve_budget: boolean;
  is_active: boolean;
}

// ============================================================================
// 7. 分布式同步与冲突处理契约类型定义
// ============================================================================

/**
 * 支持同步的实体类型
 */
export type SyncEntityType =
  | 'TRANSACTION'
  | 'BUDGET'
  | 'BUDGET_POOL'
  | 'CATEGORY'
  | 'VOUCHER'
  | 'MONTHLY_BUDGET'
  | 'FIXED_ASSET'
  | 'PROJECT_TAG'
  | 'RECURRING_RULE';

/**
 * 同步操作类型
 */
export type SyncOpType = 'UPSERT' | 'DELETE';

/**
 * 操作变更日志条目（基于混合逻辑时钟 HLC）
 */
export interface SyncOpLogEntry<T = unknown> {
  hlc: string;
  node_id: string;
  entity_type: SyncEntityType;
  entity_id: string;
  op_type: SyncOpType;
  payload_json: string;
  created_at: string;
}

/**
 * 冲突类型定义
 * - CONCURRENT_TX_EDIT: 并发编辑同一笔交易流水
 * - VOUCHER_DOUBLE_SPEND: 多端离线状态下重复核销同一张优惠券
 * - CONCURRENT_FX_SETTLE: 并发清算万事达外币预授权冻结流水
 */
export type ConflictType =
  | 'CONCURRENT_TX_EDIT'
  | 'VOUCHER_DOUBLE_SPEND'
  | 'CONCURRENT_FX_SETTLE';

/**
 * 冲突解决状态
 */
export type ConflictStatus = 'PENDING' | 'RESOLVED';

/**
 * 分布式冲突记录实体
 */
export interface SyncConflict {
  id: string;
  conflict_type: ConflictType;
  entity_id: string;
  winner_hlc: string;
  loser_hlc: string;
  winner_summary: string;
  loser_summary: string;
  loser_payload_json: string;
  status: ConflictStatus;
  created_at: string;
}

/**
 * 全量数据同步快照包
 */
export interface FullSyncBundle {
  nodeId: string;
  exportedAt: string;
  oplogs: SyncOpLogEntry[];
  vouchers: Voucher[];
  monthlyBudgets: MonthlyBudget[];
  budgetPools?: BudgetPool[];
  categories?: Category[];
  projectTags?: ProjectTag[];
  recurringRules?: RecurringRule[];
  fixedAssets?: FixedAsset[];
  transactions?: TransactionAggregate[];
}

// ============================================================================
// 8. 辅助计算业务模型类型
// ============================================================================

/**
 * 凑单分摊计算输入行
 */
export interface SplitItemInput {
  name: string;
  gross: string;
  category_id: string;
  budget_pool_id?: string;
  project_tag_id?: string | null;
  is_primary?: boolean;
}

/**
 * 凑单分摊计算结果行
 */
export interface SplitItemResult extends SplitItemInput {
  allocated_discount: string;
  net: string;
}

/**
 * 万事网联预授权挂起计算结果
 */
export interface MastercardFxHoldResult {
  status: 'PENDING_HOLD';
  hold_amount_cny: string;
  total_gross: string;
  payment_discount: string;
  total_net: string;
  exchange_rate: string;
}

/**
 * 万事网联已清算计算结果
 */
export interface MastercardFxSettledResult {
  status: 'SETTLED';
  hold_amount_cny: string;
  released_to_available: string;
  total_gross: string;
  payment_discount: string;
  total_net: string;
  exchange_rate: string;
}

export type MastercardFxResult =
  | MastercardFxHoldResult
  | MastercardFxSettledResult;
