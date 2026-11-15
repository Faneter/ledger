import {
  Decimal,
  toDecimal,
  roundCny,
  formatCny,
  formatRate,
  sumCny,
  equalsCny,
  Account,
  AccountDashboardRow,
  AccountRole,
  BudgetPool,
  Category,
  MonthlyBudget,
  MonthlyBudgetStatusRow,
  ProjectTag,
  Voucher,
  VoucherType,
  TransactionHeader,
  TransactionItem,
  TransactionAggregate,
  FixedAsset,
  FixedAssetWithCost,
  RecurringRule,
  SyncOpLogEntry,
  SyncEntityType,
  SyncConflict,
  HybridLogicalClock,
  mergeOpLogEntries,
  parseQuickInputDsl,
  computeOrderAllocation,
  processMastercardFxLifecycle,
  DEFAULT_FX_RATES,
  SplitItemInput,
  DEFAULT_CATEGORIES,
  DEFAULT_ACCOUNTS,
  DEFAULT_PROJECT_TAGS,
  generateVoucherTitle,
  FxPreferenceConfig,
} from '@ledger/core';

export { generateVoucherTitle };

export const LOCAL_STORAGE_KEY = 'geek_ledger_local_replica_v2';

export interface FullSyncBundle {
  nodeId: string;
  exportedAt: string;
  accounts: Account[];
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

export interface LocalReplicaState {
  version: number;
  nodeId: string;
  isOfflineMode: boolean;
  serverEpochId: string | null;
  accounts: Account[];
  budgetPools: BudgetPool[];
  categories: Category[];
  monthlyBudgets: MonthlyBudget[];
  projectTags: ProjectTag[];
  vouchers: Voucher[];
  fixedAssets: FixedAsset[];
  recurringRules: RecurringRule[];
  transactions: TransactionAggregate[];
  oplogs: SyncOpLogEntry[];
  pendingSyncOps: SyncOpLogEntry[];
  conflicts: SyncConflict[];
  lastSyncAt: string | null;
  fxConfig?: FxPreferenceConfig;
}

export interface DailyBudgetSummary {
  poolName: string;
  totalAvailable: string;
  spentNet: string;
  remainingBudget: string;
  remainingDays: number;
  dailyAvailableAmount: string;
  formula: string;
  totalSavedWool: string;
}

// ----------------------------------------------------------------------------
// 种子配置常量（严格对齐 PRD 12.1 ~ 12.4 及 Stage 1 ~ Stage 5）
// ----------------------------------------------------------------------------

export const SEED_ACCOUNTS: Account[] = [
  {
    id: 'ACC_HUABEI',
    name: '支付宝花呗',
    account_role: 'CREDIT',
    currency: 'CNY',
    initial_balance: '-120.00',
    book_balance: '-120.00',
    frozen_amount: '0.00',
    market_value: null,
    credit_limit: '1500.00',
    fx_hold_ratio: '1.000',
    fx_cashback_rate: '0.0000',
    fx_monthly_cap: null,
    billing_day: 1,
    repayment_day: 10,
    is_default_pay: true,
    is_folded: false,
    include_in_networth: true,
    sort_order: 10,
  },
  {
    id: 'ACC_CC_MAIN',
    name: '主力信用卡',
    account_role: 'CREDIT',
    currency: 'CNY',
    initial_balance: '0.00',
    book_balance: '0.00',
    frozen_amount: '0.00',
    market_value: null,
    credit_limit: '5000.00',
    fx_hold_ratio: '1.000',
    fx_cashback_rate: '0.0000',
    fx_monthly_cap: null,
    billing_day: 5,
    repayment_day: 25,
    is_default_pay: false,
    is_folded: false,
    include_in_networth: true,
    sort_order: 20,
  },
  {
    id: 'ACC_UNION_MAIN',
    name: '主力银联借记卡',
    account_role: 'DEBIT_MAIN',
    currency: 'CNY',
    initial_balance: '3000.00',
    book_balance: '3000.00',
    frozen_amount: '0.00',
    market_value: null,
    credit_limit: null,
    fx_hold_ratio: '1.000',
    fx_cashback_rate: '0.0000',
    fx_monthly_cap: null,
    billing_day: null,
    repayment_day: null,
    is_default_pay: false,
    is_folded: false,
    include_in_networth: true,
    sort_order: 30,
  },
  {
    id: 'ACC_CAMPUS_CARD',
    name: '校园饭卡(预充值)',
    account_role: 'PREPAID',
    currency: 'CNY',
    initial_balance: '50.00',
    book_balance: '50.00',
    frozen_amount: '0.00',
    market_value: null,
    credit_limit: null,
    fx_hold_ratio: '1.000',
    fx_cashback_rate: '0.0000',
    fx_monthly_cap: null,
    billing_day: null,
    repayment_day: null,
    is_default_pay: false,
    is_folded: false,
    include_in_networth: true,
    sort_order: 40,
  },
  {
    id: 'ACC_MC_DEBIT_A',
    name: '万事网联借记卡 A',
    account_role: 'DEBIT_FX',
    currency: 'CNY',
    initial_balance: '500.00',
    book_balance: '500.00',
    frozen_amount: '0.00',
    market_value: null,
    credit_limit: null,
    fx_hold_ratio: '1.020',
    fx_cashback_rate: '0.0100',
    fx_monthly_cap: '100.00',
    billing_day: null,
    repayment_day: null,
    is_default_pay: false,
    is_folded: false,
    include_in_networth: true,
    sort_order: 50,
  },
  {
    id: 'ACC_MC_DEBIT_B',
    name: '万事网联借记卡 B',
    account_role: 'DEBIT_FX',
    currency: 'CNY',
    initial_balance: '0.00',
    book_balance: '0.00',
    frozen_amount: '0.00',
    market_value: null,
    credit_limit: null,
    fx_hold_ratio: '1.020',
    fx_cashback_rate: '0.0100',
    fx_monthly_cap: '100.00',
    billing_day: null,
    repayment_day: null,
    is_default_pay: false,
    is_folded: false,
    include_in_networth: true,
    sort_order: 60,
  },
  {
    id: 'ACC_ALIPAY_ETF',
    name: '支付宝指数基金定投',
    account_role: 'INVESTMENT',
    currency: 'CNY',
    initial_balance: '600.00',
    book_balance: '600.00',
    frozen_amount: '0.00',
    market_value: '600.00',
    credit_limit: null,
    fx_hold_ratio: '1.000',
    fx_cashback_rate: '0.0000',
    fx_monthly_cap: null,
    billing_day: null,
    repayment_day: null,
    is_default_pay: false,
    is_folded: false,
    include_in_networth: true,
    sort_order: 70,
  },
  {
    id: 'ACC_DORMANT_01',
    name: '备用低频借记卡(折叠)',
    account_role: 'DORMANT',
    currency: 'CNY',
    initial_balance: '0.00',
    book_balance: '0.00',
    frozen_amount: '0.00',
    market_value: null,
    credit_limit: null,
    fx_hold_ratio: '1.000',
    fx_cashback_rate: '0.0000',
    fx_monthly_cap: null,
    billing_day: null,
    repayment_day: null,
    is_default_pay: false,
    is_folded: true,
    include_in_networth: true,
    sort_order: 99,
  },
];

export const SEED_BUDGET_POOLS: BudgetPool[] = [
  {
    id: 'POOL_FIXED',
    name: '固定刚需与定投池',
    pool_type: 'FIXED',
    is_monthly_budget: true,
    rollover_strategy: 'ACCUMULATE',
    description: '房租、话费、游戏月卡、定期定投',
    sort_order: 10,
  },
  {
    id: 'POOL_DAILY',
    name: '高频饮食与洗护池',
    pool_type: 'DAILY',
    is_monthly_budget: true,
    rollover_strategy: 'ACCUMULATE',
    description: '三餐、零食、水饮、日常洗护等高频动态管控池',
    sort_order: 20,
  },
  {
    id: 'POOL_FLEX',
    name: '月度弹性发展池',
    pool_type: 'FLEX',
    is_monthly_budget: true,
    rollover_strategy: 'ACCUMULATE',
    description: '服饰、日用百货、单片机电路、软件外设、交通资料',
    sort_order: 30,
  },
  {
    id: 'POOL_EMERGENCY',
    name: '医疗与突发应急池',
    pool_type: 'EMERGENCY',
    is_monthly_budget: true,
    rollover_strategy: 'ACCUMULATE',
    description: '纯粹看病买药、突发设备抢修',
    sort_order: 40,
  },
  {
    id: 'POOL_FUND',
    name: '年度专项考证基金池',
    pool_type: 'SINKING_FUND',
    is_monthly_budget: false,
    rollover_strategy: 'ACCUMULATE',
    description: 'JLPT_N2考证、长途差旅跨期专项基金',
    sort_order: 50,
  },
  {
    id: 'POOL_ASSET',
    name: '数码大件固定资产库',
    pool_type: 'CAPITAL_ASSET',
    is_monthly_budget: false,
    rollover_strategy: 'ACCUMULATE',
    description: '手机、机械硬盘等大额固定资产购置',
    sort_order: 60,
  },
];

export const SEED_MONTHLY_BUDGETS: MonthlyBudget[] = [
  {
    id: 1,
    year_month: '2026-11',
    pool_id: 'POOL_FIXED',
    base_allocation: '204.00',
    rollover_from_prev: '0.00',
    reserved_fixed: '0.00',
    swept_to_fund: '0.00',
    note: null,
  },
  {
    id: 2,
    year_month: '2026-11',
    pool_id: 'POOL_DAILY',
    base_allocation: '650.00',
    rollover_from_prev: '0.00',
    reserved_fixed: '0.00',
    swept_to_fund: '0.00',
    note: null,
  },
  {
    id: 3,
    year_month: '2026-11',
    pool_id: 'POOL_FLEX',
    base_allocation: '450.00',
    rollover_from_prev: '0.00',
    reserved_fixed: '0.00',
    swept_to_fund: '0.00',
    note: null,
  },
  {
    id: 4,
    year_month: '2026-11',
    pool_id: 'POOL_EMERGENCY',
    base_allocation: '196.00',
    rollover_from_prev: '0.00',
    reserved_fixed: '0.00',
    swept_to_fund: '0.00',
    note: null,
  },
  {
    id: 5,
    year_month: '2026-11',
    pool_id: 'POOL_FUND',
    base_allocation: '800.00',
    rollover_from_prev: '0.00',
    reserved_fixed: '0.00',
    swept_to_fund: '0.00',
    note: null,
  },
  {
    id: 6,
    year_month: '2026-11',
    pool_id: 'POOL_ASSET',
    base_allocation: '2000.00',
    rollover_from_prev: '0.00',
    reserved_fixed: '0.00',
    swept_to_fund: '0.00',
    note: null,
  },
];

// ----------------------------------------------------------------------------
// 纯净初始账本种子配置常量（Stage 8 纯净初始化规范）
// ----------------------------------------------------------------------------

export const CLEAN_SEED_ACCOUNTS: Account[] = [
  {
    id: 'ACC_HUABEI',
    name: '支付宝花呗',
    account_role: 'CREDIT',
    currency: 'CNY',
    initial_balance: '0.00',
    book_balance: '0.00',
    frozen_amount: '0.00',
    market_value: null,
    credit_limit: '1500.00',
    fx_hold_ratio: '1.000',
    fx_cashback_rate: '0.0000',
    fx_monthly_cap: null,
    billing_day: 1,
    repayment_day: 10,
    is_default_pay: true,
    is_folded: false,
    include_in_networth: true,
    sort_order: 10,
  },
  {
    id: 'ACC_CC_MAIN',
    name: '主力信用卡',
    account_role: 'CREDIT',
    currency: 'CNY',
    initial_balance: '0.00',
    book_balance: '0.00',
    frozen_amount: '0.00',
    market_value: null,
    credit_limit: '5000.00',
    fx_hold_ratio: '1.000',
    fx_cashback_rate: '0.0000',
    fx_monthly_cap: null,
    billing_day: 5,
    repayment_day: 25,
    is_default_pay: false,
    is_folded: false,
    include_in_networth: true,
    sort_order: 20,
  },
  {
    id: 'ACC_UNION_MAIN',
    name: '主力银联借记卡',
    account_role: 'DEBIT_MAIN',
    currency: 'CNY',
    initial_balance: '0.00',
    book_balance: '0.00',
    frozen_amount: '0.00',
    market_value: null,
    credit_limit: null,
    fx_hold_ratio: '1.000',
    fx_cashback_rate: '0.0000',
    fx_monthly_cap: null,
    billing_day: null,
    repayment_day: null,
    is_default_pay: false,
    is_folded: false,
    include_in_networth: true,
    sort_order: 30,
  },
  {
    id: 'ACC_CAMPUS_CARD',
    name: '校园饭卡(预充值)',
    account_role: 'PREPAID',
    currency: 'CNY',
    initial_balance: '0.00',
    book_balance: '0.00',
    frozen_amount: '0.00',
    market_value: null,
    credit_limit: null,
    fx_hold_ratio: '1.000',
    fx_cashback_rate: '0.0000',
    fx_monthly_cap: null,
    billing_day: null,
    repayment_day: null,
    is_default_pay: false,
    is_folded: false,
    include_in_networth: true,
    sort_order: 40,
  },
  {
    id: 'ACC_MC_DEBIT_A',
    name: '万事网联借记卡 A',
    account_role: 'DEBIT_FX',
    currency: 'CNY',
    initial_balance: '0.00',
    book_balance: '0.00',
    frozen_amount: '0.00',
    market_value: null,
    credit_limit: null,
    fx_hold_ratio: '1.020',
    fx_cashback_rate: '0.0100',
    fx_monthly_cap: '100.00',
    billing_day: null,
    repayment_day: null,
    is_default_pay: false,
    is_folded: false,
    include_in_networth: true,
    sort_order: 50,
  },
  {
    id: 'ACC_MC_DEBIT_B',
    name: '万事网联借记卡 B',
    account_role: 'DEBIT_FX',
    currency: 'CNY',
    initial_balance: '0.00',
    book_balance: '0.00',
    frozen_amount: '0.00',
    market_value: null,
    credit_limit: null,
    fx_hold_ratio: '1.020',
    fx_cashback_rate: '0.0100',
    fx_monthly_cap: '100.00',
    billing_day: null,
    repayment_day: null,
    is_default_pay: false,
    is_folded: false,
    include_in_networth: true,
    sort_order: 60,
  },
  {
    id: 'ACC_ALIPAY_ETF',
    name: '支付宝指数基金定投',
    account_role: 'INVESTMENT',
    currency: 'CNY',
    initial_balance: '0.00',
    book_balance: '0.00',
    frozen_amount: '0.00',
    market_value: '0.00',
    credit_limit: null,
    fx_hold_ratio: '1.000',
    fx_cashback_rate: '0.0000',
    fx_monthly_cap: null,
    billing_day: null,
    repayment_day: null,
    is_default_pay: false,
    is_folded: false,
    include_in_networth: true,
    sort_order: 70,
  },
  {
    id: 'ACC_DORMANT_01',
    name: '备用低频借记卡(折叠)',
    account_role: 'DORMANT',
    currency: 'CNY',
    initial_balance: '0.00',
    book_balance: '0.00',
    frozen_amount: '0.00',
    market_value: null,
    credit_limit: null,
    fx_hold_ratio: '1.000',
    fx_cashback_rate: '0.0000',
    fx_monthly_cap: null,
    billing_day: null,
    repayment_day: null,
    is_default_pay: false,
    is_folded: true,
    include_in_networth: true,
    sort_order: 99,
  },
];

export const CLEAN_SEED_BUDGET_POOLS: BudgetPool[] = [
  {
    id: 'POOL_FIXED',
    name: '固定刚需与定投池',
    pool_type: 'FIXED',
    is_monthly_budget: true,
    rollover_strategy: 'ACCUMULATE',
    description: '房租、话费、游戏月卡、定期定投',
    sort_order: 10,
  },
  {
    id: 'POOL_DAILY',
    name: '高频饮食与洗护池',
    pool_type: 'DAILY',
    is_monthly_budget: true,
    rollover_strategy: 'ACCUMULATE',
    description: '三餐、零食、水饮、日常洗护等高频动态管控池',
    sort_order: 20,
  },
  {
    id: 'POOL_FLEX',
    name: '月度弹性发展池',
    pool_type: 'FLEX',
    is_monthly_budget: true,
    rollover_strategy: 'ACCUMULATE',
    description: '服饰、日用百货、单片机电路、软件外设、交通资料',
    sort_order: 30,
  },
  {
    id: 'POOL_EMERGENCY',
    name: '医疗与突发应急池',
    pool_type: 'EMERGENCY',
    is_monthly_budget: true,
    rollover_strategy: 'ACCUMULATE',
    description: '纯粹看病买药、突发设备抢修',
    sort_order: 40,
  },
];

export const CLEAN_SEED_MONTHLY_BUDGETS: MonthlyBudget[] = [
  {
    id: 1,
    year_month: '2026-11',
    pool_id: 'POOL_FIXED',
    base_allocation: '0.00',
    rollover_from_prev: '0.00',
    reserved_fixed: '0.00',
    swept_to_fund: '0.00',
    note: null,
  },
  {
    id: 2,
    year_month: '2026-11',
    pool_id: 'POOL_DAILY',
    base_allocation: '0.00',
    rollover_from_prev: '0.00',
    reserved_fixed: '0.00',
    swept_to_fund: '0.00',
    note: null,
  },
  {
    id: 3,
    year_month: '2026-11',
    pool_id: 'POOL_FLEX',
    base_allocation: '0.00',
    rollover_from_prev: '0.00',
    reserved_fixed: '0.00',
    swept_to_fund: '0.00',
    note: null,
  },
  {
    id: 4,
    year_month: '2026-11',
    pool_id: 'POOL_EMERGENCY',
    base_allocation: '0.00',
    rollover_from_prev: '0.00',
    reserved_fixed: '0.00',
    swept_to_fund: '0.00',
    note: null,
  },
];

export const SEED_VOUCHERS: Voucher[] = [
  {
    id: 1,
    title: '微信支付10元立减金',
    voucher_type: 'PREPAID_COUPON',
    face_value: '10.00',
    acquire_cost: '5.99',
    min_spend: '10.01',
    status: 'AVAILABLE',
    purchase_tx_id: null,
    used_tx_id: null,
    expire_date: '2026-12-31',
  },
  {
    id: 2,
    title: '花呗还款5元立减券',
    voucher_type: 'REPAY_COUPON',
    face_value: '5.00',
    acquire_cost: '0.00',
    min_spend: '100.00',
    status: 'AVAILABLE',
    purchase_tx_id: null,
    used_tx_id: null,
    expire_date: '2026-12-31',
  },
];

export const SEED_FIXED_ASSETS: FixedAsset[] = [
  {
    id: 1,
    asset_name: '二手 iPhone 13 mini',
    purchase_item_id: null,
    purchase_date: '2026-09-01',
    purchase_net_cost: '1150.00',
    target_daily_cost: '2.00',
    status: 'IN_USE',
    resale_date: null,
    resale_recovery: '0.00',
    note: '购于 2026-09-01，目标日均 2 元',
  },
  {
    id: 2,
    asset_name: '希捷3T监控级硬盘+硬盘盒',
    purchase_item_id: null,
    purchase_date: '2026-10-01',
    purchase_net_cost: '409.80',
    target_daily_cost: '1.00',
    status: 'IN_USE',
    resale_date: null,
    resale_recovery: '0.00',
    note: '购于 2026-10-01，目标日均 1 元',
  },
];

export const SEED_RECURRING_RULES: RecurringRule[] = [
  {
    id: 1,
    title: '每月固定话费(移动8+电信29+联通49)',
    rule_type: 'FIXED_EXPENSE',
    cron_cycle: 'MONTHLY',
    trigger_day: 1,
    currency: 'CNY',
    amount: '86.00',
    account_id: 'ACC_UNION_MAIN',
    target_account_id: null,
    category_id: 'CAT_TELECOM',
    budget_pool_id: 'POOL_FIXED',
    auto_reserve_budget: true,
    is_active: true,
  },
  {
    id: 2,
    title: '支付宝指数基金定投',
    rule_type: 'AUTO_INVEST',
    cron_cycle: 'MONTHLY',
    trigger_day: 1,
    currency: 'CNY',
    amount: '60.00',
    account_id: 'ACC_UNION_MAIN',
    target_account_id: 'ACC_ALIPAY_ETF',
    category_id: null,
    budget_pool_id: 'POOL_FIXED',
    auto_reserve_budget: true,
    is_active: true,
  },
  {
    id: 3,
    title: 'Porkbun域名续费',
    rule_type: 'FX_SUBSCRIPTION',
    cron_cycle: 'YEARLY',
    trigger_day: 1,
    currency: 'USD',
    amount: '10.37',
    account_id: 'ACC_MC_DEBIT_A',
    target_account_id: null,
    category_id: 'CAT_DIGITAL_SUB',
    budget_pool_id: 'POOL_FLEX',
    auto_reserve_budget: true,
    is_active: true,
  },
];

// 内存模拟 Storage（用于 Node/Vitest 环境中无 window.localStorage 的场景）
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

const memoryStorage = new MemoryStorage();

function getStorage(): { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void } {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  return memoryStorage;
}

/**
 * 纯前端/跨端本地优先账本副本引擎 (LocalLedgerEngine)
 */
export class LocalLedgerEngine {
  public state: LocalReplicaState;
  public stateVersion = 0;
  public hlc: HybridLogicalClock;
  public serverResetDetected = false;
  private listeners = new Set<() => void>();

  constructor(nodeId = 'client-web-local', initialSeedOverride?: Partial<LocalReplicaState>) {
    const loaded = this.loadFromStorage();
    if (loaded) {
      this.state = loaded;
    } else {
      this.state = this.buildCleanInitialState(nodeId, initialSeedOverride);
      this.saveToStorage();
    }

    // 初始化混合逻辑时钟
    let maxHlc: string | undefined;
    for (const op of this.state.oplogs) {
      if (!maxHlc || HybridLogicalClock.compare(op.hlc, maxHlc) > 0) {
        maxHlc = op.hlc;
      }
    }
    this.hlc = new HybridLogicalClock(this.state.nodeId, maxHlc);
    this.recalculateAllBalances();
  }

  // --------------------------------------------------------------------------
  // 观察者订阅模式
  // --------------------------------------------------------------------------
  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        console.error('[LocalLedgerEngine] Listener error:', err);
      }
    }
  }

  // --------------------------------------------------------------------------
  // 持久化存储与状态重置
  // --------------------------------------------------------------------------
  private cleanupDeprecatedPoolsFromState(target: Partial<LocalReplicaState>): boolean {
    const DEPRECATED_POOL_IDS = new Set(['POOL_FUND', 'POOL_ASSET']);
    const referencedPools = new Set<string>();

    if (Array.isArray(target.transactions)) {
      for (const tx of target.transactions) {
        if (tx?.header?.is_deleted) continue;
        if (Array.isArray(tx?.items)) {
          for (const it of tx.items) {
            if (it?.budget_pool_id) referencedPools.add(it.budget_pool_id);
          }
        }
      }
    }
    if (Array.isArray(target.recurringRules)) {
      for (const r of target.recurringRules) {
        if (r?.budget_pool_id) referencedPools.add(r.budget_pool_id);
      }
    }

    const poolsToRemove = new Set(
      Array.from(DEPRECATED_POOL_IDS).filter((id) => !referencedPools.has(id))
    );

    let cleaned = false;
    if (poolsToRemove.size > 0) {
      if (Array.isArray(target.budgetPools)) {
        const nextPools = target.budgetPools.filter((p: BudgetPool) => !poolsToRemove.has(p.id));
        if (nextPools.length !== target.budgetPools.length) {
          target.budgetPools = nextPools;
          cleaned = true;
        }
      }
      if (Array.isArray(target.monthlyBudgets)) {
        const nextBudgets = target.monthlyBudgets.filter(
          (b: MonthlyBudget) => !poolsToRemove.has(b.pool_id)
        );
        if (nextBudgets.length !== target.monthlyBudgets.length) {
          target.monthlyBudgets = nextBudgets;
          cleaned = true;
        }
      }
      if (Array.isArray(target.projectTags)) {
        for (const tag of target.projectTags) {
          if (tag.linked_pool_id && poolsToRemove.has(tag.linked_pool_id)) {
            tag.linked_pool_id = null;
            cleaned = true;
          }
        }
      }
      if (Array.isArray(target.categories)) {
        for (const cat of target.categories) {
          if (cat.default_pool_id && poolsToRemove.has(cat.default_pool_id)) {
            cat.default_pool_id = 'POOL_FLEX';
            cleaned = true;
          }
        }
      }
    }
    return cleaned;
  }

  private loadFromStorage(): LocalReplicaState | null {
    try {
      const raw = getStorage().getItem(LOCAL_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && (parsed.version === 2 || parsed.version === 1)) {
        parsed.version = 2;
        if (!parsed.fxConfig) {
          parsed.fxConfig = { defaultHoldRatio: '1.020', defaultCashbackRate: '0.0100' };
        }

        const cleaned = this.cleanupDeprecatedPoolsFromState(parsed);
        if (cleaned) {
          getStorage().setItem(LOCAL_STORAGE_KEY, JSON.stringify(parsed));
        }
        return parsed;
      }
    } catch (e) {
      console.warn('[LocalLedgerEngine] Failed to load from storage:', e);
    }
    return null;
  }

  public saveToStorage(): void {
    this.stateVersion += 1;
    try {
      getStorage().setItem(LOCAL_STORAGE_KEY, JSON.stringify(this.state));
    } catch (e) {
      console.warn('[LocalLedgerEngine] Failed to save to storage:', e);
    }
    this.notify();
  }

  /**
   * 重置为纯净账本状态（Stage 8 核心规范：0 余额账户、无默认优惠券、无默认固定资产、无交易流水）
   */
  public resetToCleanState(): void {
    this.state = this.buildCleanInitialState(this.state.nodeId);
    let maxHlc: string | undefined;
    for (const op of this.state.oplogs) {
      if (!maxHlc || HybridLogicalClock.compare(op.hlc, maxHlc) > 0) {
        maxHlc = op.hlc;
      }
    }
    this.hlc = new HybridLogicalClock(this.state.nodeId, maxHlc);
    this.recalculateAllBalances();
    this.saveToStorage();
  }

  /**
   * 加载演示数据（包含花呗负债、主力银联卡、万事达外币卡、立减金与 iPhone 固定资产）
   */
  public loadDemoData(): void {
    this.state = this.buildDemoInitialSeed(this.state.nodeId);
    let maxHlc: string | undefined;
    for (const op of this.state.oplogs) {
      if (!maxHlc || HybridLogicalClock.compare(op.hlc, maxHlc) > 0) {
        maxHlc = op.hlc;
      }
    }
    this.hlc = new HybridLogicalClock(this.state.nodeId, maxHlc);
    this.recalculateAllBalances();
    this.saveToStorage();
  }

  /**
   * 别名保持向后兼容：所有旧单元测试调用 resetToSeed() 时继续加载演示数据
   */
  public resetToSeed(): void {
    this.loadDemoData();
  }

  public buildCleanInitialState(
    nodeId: string,
    override?: Partial<LocalReplicaState>
  ): LocalReplicaState {
    return {
      version: 2,
      nodeId,
      isOfflineMode: false,
      serverEpochId: null,
      accounts: JSON.parse(JSON.stringify(CLEAN_SEED_ACCOUNTS)),
      budgetPools: JSON.parse(JSON.stringify(CLEAN_SEED_BUDGET_POOLS)),
      categories: JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)),
      monthlyBudgets: JSON.parse(JSON.stringify(CLEAN_SEED_MONTHLY_BUDGETS)),
      projectTags: [],
      vouchers: [],
      fixedAssets: [],
      recurringRules: [],
      transactions: [],
      oplogs: [],
      pendingSyncOps: [],
      conflicts: [],
      lastSyncAt: null,
      fxConfig: { defaultHoldRatio: '1.020', defaultCashbackRate: '0.0100' },
      ...override,
    };
  }

  public buildDemoInitialSeed(
    nodeId: string,
    override?: Partial<LocalReplicaState>
  ): LocalReplicaState {
    return {
      version: 2,
      nodeId,
      isOfflineMode: false,
      serverEpochId: null,
      accounts: JSON.parse(JSON.stringify(SEED_ACCOUNTS)),
      budgetPools: JSON.parse(JSON.stringify(SEED_BUDGET_POOLS)),
      categories: JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)),
      monthlyBudgets: JSON.parse(JSON.stringify(SEED_MONTHLY_BUDGETS)),
      projectTags: JSON.parse(JSON.stringify(DEFAULT_PROJECT_TAGS)),
      vouchers: JSON.parse(JSON.stringify(SEED_VOUCHERS)),
      fixedAssets: JSON.parse(JSON.stringify(SEED_FIXED_ASSETS)),
      recurringRules: JSON.parse(JSON.stringify(SEED_RECURRING_RULES)),
      transactions: [],
      oplogs: [],
      pendingSyncOps: [],
      conflicts: [],
      lastSyncAt: null,
      fxConfig: { defaultHoldRatio: '1.020', defaultCashbackRate: '0.0100' },
      ...override,
    };
  }

  public updateFxConfig(config: Partial<FxPreferenceConfig>): FxPreferenceConfig {
    const current = this.state.fxConfig ?? { defaultHoldRatio: '1.020', defaultCashbackRate: '0.0100' };
    const updated: FxPreferenceConfig = {
      defaultHoldRatio: config.defaultHoldRatio ?? current.defaultHoldRatio,
      defaultCashbackRate: config.defaultCashbackRate ?? current.defaultCashbackRate,
    };
    this.state.fxConfig = updated;
    this.saveToStorage();
    return updated;
  }

  public buildInitialSeed(
    nodeId: string,
    override?: Partial<LocalReplicaState>
  ): LocalReplicaState {
    return this.buildDemoInitialSeed(nodeId, override);
  }

  public appendOpLog(
    entityType: SyncEntityType,
    entityId: string,
    opType: 'UPSERT' | 'DELETE',
    payload: unknown
  ): SyncOpLogEntry {
    const hlc = this.hlc.now();
    const op: SyncOpLogEntry = {
      hlc,
      node_id: this.state.nodeId,
      entity_type: entityType,
      entity_id: entityId,
      op_type: opType,
      payload_json: typeof payload === 'string' ? payload : JSON.stringify(payload),
      created_at: new Date().toISOString(),
    };
    this.state.oplogs.push(op);
    this.state.pendingSyncOps.push(op);
    return op;
  }

  private repairBuggedFxTransactions(): void {
    for (const tx of this.state.transactions) {
      const h = tx.header;
      if (
        !h.is_deleted &&
        h.tx_type === 'EXPENSE' &&
        h.settlement_status === 'PENDING_HOLD' &&
        h.original_currency &&
        h.original_currency !== 'CNY' &&
        h.original_amount != null &&
        (h.exchange_rate == null || h.exchange_rate === '') &&
        Number(h.total_net) === Number(h.original_amount)
      ) {
        const acc = this.state.accounts.find((a) => a.id === h.account_id);
        const fxRate = DEFAULT_FX_RATES[h.original_currency] ?? '7.200000';
        const holdRatio =
          this.state.fxConfig?.defaultHoldRatio || acc?.fx_hold_ratio || '1.020';
        const cashbackRate =
          h.fx_cashback_rate !== undefined && h.fx_cashback_rate !== null && h.fx_cashback_rate !== ''
            ? h.fx_cashback_rate
            : this.state.fxConfig?.defaultCashbackRate ??
              acc?.fx_cashback_rate ??
              '0.0100';
        const holdAmountCny = formatCny(
          roundCny(toDecimal(h.original_amount).times(fxRate).times(holdRatio))
        );
        const fxResult = processMastercardFxLifecycle({
          foreignAmount: h.original_amount,
          holdAmountCny,
          holdRatio,
          cashbackRate,
        });
        h.total_gross = fxResult.total_gross;
        h.payment_discount = fxResult.payment_discount;
        h.total_net = fxResult.total_net;
        h.exchange_rate = fxResult.exchange_rate;
        h.hold_amount_cny = fxResult.hold_amount_cny;
        if (tx.items.length > 0) {
          tx.items[0].item_gross = fxResult.total_gross;
          tx.items[0].allocated_discount = fxResult.payment_discount;
          tx.items[0].item_net = fxResult.total_net;
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // 核心财务确定性重算
  // --------------------------------------------------------------------------
  public recalculateAllBalances(): void {
    this.repairBuggedFxTransactions();

    const voucherCostMap = new Map<number, Decimal>();
    for (const v of this.state.vouchers) {
      voucherCostMap.set(v.id, toDecimal(v.acquire_cost ?? 0));
    }

    const accountMap = new Map<
      string,
      { book: Decimal; frozen: Decimal }
    >();

    for (const acc of this.state.accounts) {
      accountMap.set(acc.id, {
        book: toDecimal(acc.initial_balance ?? 0),
        frozen: new Decimal(0),
      });
    }

    // 依序遍历未软删除的交易
    const sortedTxs = [...this.state.transactions]
      .filter((tx) => !tx.header.is_deleted)
      .sort((a, b) => {
        const da = a.header.tx_date.localeCompare(b.header.tx_date);
        if (da !== 0) return da;
        return a.header.id.localeCompare(b.header.id);
      });

    for (const tx of sortedTxs) {
      const h = tx.header;
      const acc = accountMap.get(h.account_id);
      if (!acc) continue;

      if (h.tx_type === 'EXPENSE') {
        if (h.settlement_status === 'PENDING_HOLD') {
          acc.frozen = acc.frozen.plus(toDecimal(h.hold_amount_cny ?? 0));
        } else if (h.settlement_status === 'SETTLED') {
          let cashDeducted = toDecimal(h.total_net);
          if (h.applied_voucher_id != null) {
            const cost = voucherCostMap.get(h.applied_voucher_id) ?? new Decimal(0);
            cashDeducted = cashDeducted.minus(cost);
          }
          acc.book = acc.book.minus(cashDeducted);
        }
      } else if (h.tx_type === 'INCOME' || h.tx_type === 'CASHBACK_OFFSET') {
        acc.book = acc.book.plus(toDecimal(h.total_net));
      } else if (h.tx_type === 'VOUCHER_BUY') {
        acc.book = acc.book.minus(toDecimal(h.total_net));
      } else if (h.tx_type === 'TRANSFER') {
        acc.book = acc.book.minus(toDecimal(h.total_net));
        if (h.target_account_id) {
          const targetAcc = accountMap.get(h.target_account_id);
          if (targetAcc) {
            targetAcc.book = targetAcc.book.plus(toDecimal(h.total_gross));
          }
        }
      }
    }

    // 写回账户对象
    for (const acc of this.state.accounts) {
      const state = accountMap.get(acc.id);
      if (state) {
        acc.book_balance = formatCny(state.book);
        acc.frozen_amount = formatCny(state.frozen);
      }
    }
  }

  // --------------------------------------------------------------------------
  // DSL 极速记账编译器与预览
  // --------------------------------------------------------------------------
  public previewDsl(
    rawText: string,
    appliedVoucherId?: number | null
  ): {
    parsed: ReturnType<typeof parseQuickInputDsl>;
    should_wake_fx_account: boolean;
    voucherSavings: string;
    effectiveNet: string;
    voucherInfo: Voucher | null;
  } {
    const parsed = parseQuickInputDsl(rawText, {
      categories: this.state.categories,
      accounts: this.state.accounts,
      projectTags: this.state.projectTags,
      budgetPools: this.state.budgetPools,
      fxConfig: this.state.fxConfig,
    });

    let voucherInfo: Voucher | null = null;
    let voucherSavings = '0.00';
    let effectiveNet = parsed.total_net;

    if (appliedVoucherId != null) {
      const v = this.state.vouchers.find((it) => it.id === appliedVoucherId);
      if (v) {
        if (v.status !== 'AVAILABLE') {
          throw new Error(`优惠券「${v.title}」已被使用或已失效`);
        }
        if (parsed.tx_type === 'EXPENSE' && v.voucher_type === 'REPAY_COUPON') {
          throw new Error('还款专用券仅限在「转账/还款」中使用');
        }
        if (parsed.tx_type === 'TRANSFER' && v.voucher_type !== 'REPAY_COUPON') {
          throw new Error('转账/还款仅可使用「还款券」类型的优惠券');
        }
        if (parsed.tx_type === 'INCOME') {
          throw new Error('收入交易不可使用优惠券');
        }
        const totalGrossDec = toDecimal(parsed.total_gross);
        if (totalGrossDec.lessThan(toDecimal(v.min_spend))) {
          throw new Error(
            `未达到优惠券「${v.title}」的最低使用门槛（需满 ¥${v.min_spend}，当前金额 ¥${formatCny(totalGrossDec)}）`
          );
        }

        voucherInfo = v;
        if (parsed.tx_type === 'EXPENSE') {
          const cashPaid = Decimal.max(
            0,
            toDecimal(parsed.total_net).minus(toDecimal(v.face_value))
          );
          const splitInputs: SplitItemInput[] = parsed.items.map((it) => ({
            name: it.item_name,
            gross: it.item_gross,
            category_id: it.category_id,
            budget_pool_id: it.budget_pool_id,
            project_tag_id: it.project_tag_id,
            is_primary: it.is_primary_item,
          }));

          const alloc = computeOrderAllocation(
            splitInputs,
            cashPaid,
            parsed.allocation_mode,
            {
              face_value: v.face_value,
              acquire_cost: v.acquire_cost,
              voucher_type: v.voucher_type,
            }
          );

          voucherSavings = alloc.voucher_net_savings;
          effectiveNet = alloc.total_net;

          parsed.total_gross = alloc.total_gross;
          parsed.platform_discount = '0.00';
          parsed.payment_discount = alloc.total_discount;
          parsed.total_net = alloc.total_net;
          parsed.items = alloc.items.map((it, idx) => ({
            ...parsed.items[idx],
            item_gross: it.gross,
            allocated_discount: it.allocated_discount,
            item_net: it.net,
          }));
        } else if (parsed.tx_type === 'TRANSFER') {
          if (toDecimal(parsed.payment_discount).isZero()) {
            parsed.payment_discount = formatCny(v.face_value);
          }
          parsed.total_net = formatCny(
            toDecimal(parsed.total_gross).minus(toDecimal(parsed.payment_discount))
          );
          voucherSavings = formatCny(
            toDecimal(v.face_value).minus(toDecimal(v.acquire_cost))
          );
          effectiveNet = parsed.total_net;
        }
      }
    }

    return {
      parsed,
      should_wake_fx_account: Boolean(parsed.should_wake_fx_account),
      voucherSavings,
      effectiveNet,
      voucherInfo,
    };
  }

  public recordFromDsl(
    rawText: string,
    txDate?: string,
    appliedVoucherId?: number | null
  ): TransactionAggregate {
    const preview = this.previewDsl(rawText, appliedVoucherId);
    const parsed = preview.parsed;
    const hlc = this.hlc.now();
    const txId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const effectiveDate = txDate ?? new Date().toISOString().slice(0, 10);
    const nowIso = new Date().toISOString();

    const header: TransactionHeader = {
      id: txId,
      tx_date: effectiveDate,
      tx_timestamp: nowIso,
      tx_type: parsed.tx_type,
      account_id: parsed.account_id,
      target_account_id: parsed.target_account_id,
      total_gross: parsed.total_gross,
      platform_discount: parsed.platform_discount,
      payment_discount: parsed.payment_discount,
      total_net: parsed.total_net,
      allocation_mode: parsed.allocation_mode,
      original_currency: parsed.original_currency,
      original_amount: parsed.original_amount,
      exchange_rate: parsed.exchange_rate,
      settlement_status: parsed.settlement_status,
      hold_amount_cny: parsed.hold_amount_cny,
      fx_cashback_rate: parsed.fx_cashback_rate ?? null,
      settled_at: parsed.settlement_status === 'SETTLED' ? nowIso : null,
      raw_input_text: parsed.raw_input_text,
      merchant_or_note: parsed.merchant_or_note,
      applied_voucher_id: appliedVoucherId ?? null,
      is_deleted: false,
      updated_hlc: hlc,
      created_at: nowIso,
    };

    const items: TransactionItem[] = parsed.items.map((it, idx) => ({
      id: idx + 1,
      header_id: txId,
      item_name: it.item_name,
      category_id: it.category_id,
      budget_pool_id: it.budget_pool_id,
      project_tag_id: it.project_tag_id,
      item_gross: it.item_gross,
      allocated_discount: it.allocated_discount,
      item_net: it.item_net,
      is_primary_item: it.is_primary_item,
      raw_formula_expr: it.raw_formula_expr,
    }));

    const txAggregate: TransactionAggregate = {
      header,
      items,
      appliedVoucherId: appliedVoucherId ?? null,
    };

    // 1. 追加交易
    this.state.transactions.unshift(txAggregate);

    // 2. 核销卡券
    if (appliedVoucherId != null) {
      const v = this.state.vouchers.find((it) => it.id === appliedVoucherId);
      if (v) {
        v.status = 'USED';
        v.used_tx_id = txId;
        const vHlc = this.hlc.now();
        const vOp: SyncOpLogEntry = {
          hlc: vHlc,
          node_id: this.state.nodeId,
          entity_type: 'VOUCHER',
          entity_id: String(v.id),
          op_type: 'UPSERT',
          payload_json: JSON.stringify(v),
          created_at: nowIso,
        };
        this.state.oplogs.push(vOp);
        this.state.pendingSyncOps.push(vOp);
      }
    }

    // 3. 追加 OpLog
    const txOp: SyncOpLogEntry = {
      hlc,
      node_id: this.state.nodeId,
      entity_type: 'TRANSACTION',
      entity_id: txId,
      op_type: 'UPSERT',
      payload_json: JSON.stringify(txAggregate),
      created_at: nowIso,
    };
    this.state.oplogs.push(txOp);
    this.state.pendingSyncOps.push(txOp);

    // 4. 重算并保存
    this.recalculateAllBalances();
    this.saveToStorage();

    return txAggregate;
  }

  // --------------------------------------------------------------------------
  // Stage 8: 可视化表单手工记账 (无需编写 DSL)
  // --------------------------------------------------------------------------
  public recordManualTransaction(params: {
    tx_type: 'EXPENSE' | 'INCOME' | 'TRANSFER';
    tx_date?: string;
    account_id?: string;
    target_account_id?: string | null;
    amount: string; // gross amount (or transfer amount)
    discount?: string; // optional platform/payment discount
    category_id?: string;
    budget_pool_id?: string;
    project_tag_id?: string | null;
    merchant_or_note: string;
    applied_voucher_id?: number | null;
    currency?: string; // default 'CNY'; if 'USD' etc., support hold_amount_cny or 102% hold on DEBIT_FX
    hold_amount_cny?: string;
    fx_hold_ratio?: string;
    fx_cashback_rate?: string;
  }): TransactionAggregate {
    const accountId =
      params.account_id ||
      this.state.accounts.find((a) => a.is_default_pay)?.id ||
      this.state.accounts[0]?.id ||
      'ACC_UNION_MAIN';
    const acc = this.state.accounts.find((a) => a.id === accountId) || this.state.accounts[0];

    const txId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const nowIso = new Date().toISOString();
    const effectiveDate = params.tx_date ?? nowIso.slice(0, 10);
    const currency = params.currency ?? 'CNY';
    const isFx = currency !== 'CNY';

    let totalGross = formatCny(params.amount);
    let paymentDiscount = formatCny(params.discount ?? '0.00');
    let platformDiscount = '0.00';
    let totalNet = formatCny(
      Decimal.max(0, toDecimal(totalGross).minus(toDecimal(paymentDiscount)))
    );
    let items: TransactionItem[] = [];
    let settlementStatus: 'PENDING_HOLD' | 'SETTLED' = isFx ? 'PENDING_HOLD' : 'SETTLED';
    let holdAmountCny = '0.00';
    let exchangeRate: string | null = isFx ? null : '1.000000';
    let fxCashbackRateToStore: string | null = null;

    let appliedVoucher: Voucher | null = null;
    if (params.applied_voucher_id != null) {
      const v = this.state.vouchers.find(
        (it) => it.id === params.applied_voucher_id
      );
      if (!v) {
        throw new Error(`优惠券 "${params.applied_voucher_id}" 不存在`);
      }
      if (v.status !== 'AVAILABLE') {
        throw new Error(`优惠券「${v.title}」已被使用或已失效`);
      }
      if (params.tx_type === 'EXPENSE' && v.voucher_type === 'REPAY_COUPON') {
        throw new Error('还款专用券仅限在「转账/还款」中使用');
      }
      if (params.tx_type === 'TRANSFER' && v.voucher_type !== 'REPAY_COUPON') {
        throw new Error('转账/还款仅可使用「还款券」类型的优惠券');
      }
      if (params.tx_type === 'INCOME') {
        throw new Error('收入交易不可使用优惠券');
      }
      const totalGrossDec = isFx
        ? roundCny(
            toDecimal(params.amount).times(
              DEFAULT_FX_RATES[currency] ?? '7.200000'
            )
          )
        : toDecimal(params.amount);
      if (totalGrossDec.lessThan(toDecimal(v.min_spend))) {
        throw new Error(
          `未达到优惠券「${v.title}」的最低使用门槛（需满 ¥${v.min_spend}，当前金额 ¥${formatCny(totalGrossDec)}）`
        );
      }
      appliedVoucher = v;
    }

    if (params.tx_type === 'EXPENSE') {
      const catId = params.category_id ?? (this.state.categories[0]?.id ?? 'CAT_FOOD');
      const cat = this.state.categories.find((c) => c.id === catId);
      const poolId = params.budget_pool_id ?? (cat?.default_pool_id ?? 'POOL_DAILY');

      if (appliedVoucher) {
        const v = appliedVoucher;
        const cashPaid = Decimal.max(
          0,
          toDecimal(params.amount)
            .minus(toDecimal(params.discount ?? 0))
            .minus(toDecimal(v.face_value))
        );
          const splitInputs: SplitItemInput[] = [
            {
              name: params.merchant_or_note,
              gross: totalGross,
              category_id: catId,
              budget_pool_id: poolId,
              project_tag_id: params.project_tag_id ?? null,
              is_primary: true,
            },
          ];
          const alloc = computeOrderAllocation(
            splitInputs,
            cashPaid,
            'SINGLE',
            {
              face_value: v.face_value,
              acquire_cost: v.acquire_cost,
              voucher_type: v.voucher_type,
            }
          );
          totalGross = alloc.total_gross;
          paymentDiscount = alloc.total_discount;
          totalNet = alloc.total_net;
          items = [
            {
              id: 1,
              header_id: txId,
              item_name: params.merchant_or_note,
              category_id: catId,
              budget_pool_id: poolId,
              project_tag_id: params.project_tag_id ?? null,
              item_gross: alloc.items[0].gross,
              allocated_discount: alloc.items[0].allocated_discount,
              item_net: alloc.items[0].net,
              is_primary_item: true,
              raw_formula_expr: null,
            },
          ];
        }

      if (items.length === 0) {
        items = [
          {
            id: 1,
            header_id: txId,
            item_name: params.merchant_or_note,
            category_id: catId,
            budget_pool_id: poolId,
            project_tag_id: params.project_tag_id ?? null,
            item_gross: totalGross,
            allocated_discount: paymentDiscount,
            item_net: totalNet,
            is_primary_item: true,
            raw_formula_expr: null,
          },
        ];
      }

      if (isFx) {
        const fxRate = DEFAULT_FX_RATES[currency] ?? '7.200000';
        const holdRatio =
          params.fx_hold_ratio !== undefined && params.fx_hold_ratio !== ''
            ? params.fx_hold_ratio
            : this.state.fxConfig?.defaultHoldRatio ??
              acc?.fx_hold_ratio ??
              '1.020';
        const cashbackRate =
          params.fx_cashback_rate !== undefined && params.fx_cashback_rate !== ''
            ? params.fx_cashback_rate
            : this.state.fxConfig?.defaultCashbackRate ??
              acc?.fx_cashback_rate ??
              '0.0100';
        fxCashbackRateToStore = Number(cashbackRate).toFixed(4);

        if (params.hold_amount_cny && Number(params.hold_amount_cny) > 0) {
          holdAmountCny = formatCny(params.hold_amount_cny);
        } else {
          holdAmountCny = formatCny(
            roundCny(toDecimal(params.amount).times(fxRate).times(holdRatio))
          );
        }

        const fxResult = processMastercardFxLifecycle({
          foreignAmount: params.amount,
          holdAmountCny,
          holdRatio,
          cashbackRate,
        });

        totalGross = fxResult.total_gross;
        paymentDiscount = fxResult.payment_discount;
        totalNet = fxResult.total_net;
        exchangeRate = fxResult.exchange_rate;

        if (items.length > 0) {
          items[0].item_gross = fxResult.total_gross;
          items[0].allocated_discount = fxResult.payment_discount;
          items[0].item_net = fxResult.total_net;
        }
      }
    } else if (params.tx_type === 'TRANSFER') {
      let discountDec = toDecimal(params.discount ?? 0);
      if (appliedVoucher) {
        discountDec = discountDec.plus(toDecimal(appliedVoucher.face_value));
      }
      paymentDiscount = formatCny(discountDec);
      totalNet = formatCny(
        Decimal.max(0, toDecimal(totalGross).minus(discountDec))
      );
    } else if (params.tx_type === 'INCOME') {
      paymentDiscount = '0.00';
      totalNet = totalGross;
    }

    const hlc = this.hlc.now();
    const header: TransactionHeader = {
      id: txId,
      tx_date: effectiveDate,
      tx_timestamp: nowIso,
      tx_type: params.tx_type,
      account_id: accountId,
      target_account_id: params.target_account_id ?? null,
      total_gross: totalGross,
      platform_discount: platformDiscount,
      payment_discount: paymentDiscount,
      total_net: totalNet,
      allocation_mode: 'SINGLE',
      original_currency: currency,
      original_amount: isFx ? formatCny(params.amount) : null,
      exchange_rate: exchangeRate,
      settlement_status: settlementStatus,
      hold_amount_cny: holdAmountCny,
      fx_cashback_rate: fxCashbackRateToStore,
      settled_at: settlementStatus === 'SETTLED' ? nowIso : null,
      raw_input_text: `手动录入：${params.merchant_or_note} ${params.amount}`,
      merchant_or_note: params.merchant_or_note,
      applied_voucher_id: params.applied_voucher_id ?? null,
      is_deleted: false,
      updated_hlc: hlc,
      created_at: nowIso,
    };

    const txAggregate: TransactionAggregate = {
      header,
      items,
      appliedVoucherId: params.applied_voucher_id ?? null,
    };

    this.state.transactions.unshift(txAggregate);

    if (params.applied_voucher_id != null) {
      const v = this.state.vouchers.find(
        (it) => it.id === params.applied_voucher_id
      );
      if (v) {
        v.status = 'USED';
        v.used_tx_id = txId;
        this.appendOpLog('VOUCHER', String(v.id), 'UPSERT', v);
      }
    }

    this.appendOpLog('TRANSACTION', txId, 'UPSERT', txAggregate);
    this.recalculateAllBalances();
    this.saveToStorage();

    return txAggregate;
  }

  // --------------------------------------------------------------------------
  // Stage 8: 交易编辑与删除 (支持优惠券自动回退与全账本重算)
  // --------------------------------------------------------------------------
  public updateTransaction(
    txId: string,
    patch: {
      tx_date?: string;
      account_id?: string;
      target_account_id?: string | null;
      total_gross?: string;
      payment_discount?: string;
      total_net?: string;
      merchant_or_note?: string;
      category_id?: string;
      budget_pool_id?: string;
      project_tag_id?: string | null;
    }
  ): TransactionAggregate {
    const tx = this.state.transactions.find((t) => t.header.id === txId);
    if (!tx) {
      throw new Error(`Transaction "${txId}" not found`);
    }

    const h = tx.header;
    if (patch.tx_date !== undefined) h.tx_date = patch.tx_date;
    if (patch.account_id !== undefined) h.account_id = patch.account_id;
    if (patch.target_account_id !== undefined) h.target_account_id = patch.target_account_id;
    if (patch.merchant_or_note !== undefined) h.merchant_or_note = patch.merchant_or_note;

    if (patch.total_gross !== undefined) {
      h.total_gross = formatCny(patch.total_gross);
    }
    if (patch.payment_discount !== undefined) {
      h.payment_discount = formatCny(patch.payment_discount);
    }
    if (patch.total_net !== undefined) {
      h.total_net = formatCny(patch.total_net);
    } else if (patch.total_gross !== undefined || patch.payment_discount !== undefined) {
      h.total_net = formatCny(
        Decimal.max(0, toDecimal(h.total_gross).minus(toDecimal(h.payment_discount)))
      );
    }

    if (tx.items.length > 0) {
      const primaryItem = tx.items.find((it) => it.is_primary_item) ?? tx.items[0];
      if (patch.merchant_or_note !== undefined) {
        primaryItem.item_name = patch.merchant_or_note;
      }
      if (patch.total_gross !== undefined) {
        primaryItem.item_gross = h.total_gross;
      }
      if (patch.payment_discount !== undefined) {
        primaryItem.allocated_discount = h.payment_discount;
      }
      primaryItem.item_net = h.total_net;
      if (patch.category_id !== undefined) {
        primaryItem.category_id = patch.category_id;
      }
      if (patch.budget_pool_id !== undefined) {
        primaryItem.budget_pool_id = patch.budget_pool_id;
      }
      if (patch.project_tag_id !== undefined) {
        primaryItem.project_tag_id = patch.project_tag_id;
      }
    }

    const hlc = this.hlc.now();
    h.updated_hlc = hlc;

    this.appendOpLog('TRANSACTION', txId, 'UPSERT', tx);
    this.recalculateAllBalances();
    this.saveToStorage();

    return tx;
  }

  public deleteTransaction(txId: string): TransactionAggregate {
    const tx = this.state.transactions.find((t) => t.header.id === txId);
    if (!tx) {
      throw new Error(`Transaction "${txId}" not found`);
    }

    tx.header.is_deleted = true;
    const hlc = this.hlc.now();
    tx.header.updated_hlc = hlc;

    // 1. 若该交易所使用的立减金需要释放回卡包
    if (tx.header.applied_voucher_id != null) {
      const v = this.state.vouchers.find((it) => it.id === tx.header.applied_voucher_id);
      if (v) {
        v.status = 'AVAILABLE';
        v.used_tx_id = null;
        this.appendOpLog('VOUCHER', String(v.id), 'UPSERT', v);
      }
    }

    // 2. 若删除的是购券流水（VOUCHER_BUY），级联删除其对应的卡券
    const purchasedVouchers = this.state.vouchers.filter(
      (v) => v.purchase_tx_id === txId
    );
    for (const pv of purchasedVouchers) {
      for (const otherTx of this.state.transactions) {
        if (otherTx.header.applied_voucher_id === pv.id) {
          otherTx.header.applied_voucher_id = null;
          otherTx.header.updated_hlc = this.hlc.now();
          this.appendOpLog('TRANSACTION', otherTx.header.id, 'UPSERT', otherTx);
        }
      }
      this.state.vouchers = this.state.vouchers.filter((v) => v.id !== pv.id);
      this.appendOpLog('VOUCHER', String(pv.id), 'DELETE', { id: pv.id });
    }

    this.appendOpLog('TRANSACTION', txId, 'UPSERT', tx);
    this.recalculateAllBalances();
    this.saveToStorage();

    return tx;
  }

  // --------------------------------------------------------------------------
  // Stage 8: 账户矩阵 CRUD 与余额校准
  // --------------------------------------------------------------------------
  public upsertAccount(
    account: Partial<Account> & { name: string; account_role: AccountRole }
  ): Account {
    let target = this.state.accounts.find((a) => a.id === account.id);

    if (target) {
      target.name = account.name;
      target.account_role = account.account_role;
      if (account.currency !== undefined) target.currency = account.currency;
      if (account.credit_limit !== undefined) {
        target.credit_limit = account.credit_limit ? formatCny(account.credit_limit) : null;
      }
      if (account.billing_day !== undefined) target.billing_day = account.billing_day;
      if (account.repayment_day !== undefined) target.repayment_day = account.repayment_day;
      if (account.fx_hold_ratio !== undefined) target.fx_hold_ratio = account.fx_hold_ratio;
      if (account.fx_cashback_rate !== undefined) target.fx_cashback_rate = account.fx_cashback_rate;
      if (account.fx_monthly_cap !== undefined) {
        target.fx_monthly_cap = account.fx_monthly_cap ? formatCny(account.fx_monthly_cap) : null;
      }
      if (account.is_default_pay !== undefined) target.is_default_pay = Boolean(account.is_default_pay);
      if (account.is_folded !== undefined) target.is_folded = Boolean(account.is_folded);
      if (account.include_in_networth !== undefined) {
        target.include_in_networth = Boolean(account.include_in_networth);
      }
      if (account.initial_balance !== undefined) {
        target.initial_balance = formatCny(account.initial_balance);
      }
      if (account.market_value !== undefined) {
        target.market_value = account.market_value ? formatCny(account.market_value) : null;
      }
      if (account.sort_order !== undefined) target.sort_order = account.sort_order;
    } else {
      const id = account.id || `ACC_CUSTOM_${Date.now()}`;
      const initBal = formatCny(account.initial_balance ?? '0.00');
      target = {
        id,
        name: account.name,
        account_role: account.account_role,
        currency: account.currency ?? 'CNY',
        initial_balance: initBal,
        book_balance: initBal,
        frozen_amount: '0.00',
        market_value: account.market_value
          ? formatCny(account.market_value)
          : account.account_role === 'INVESTMENT'
            ? '0.00'
            : null,
        credit_limit: account.credit_limit ? formatCny(account.credit_limit) : null,
        fx_hold_ratio: account.fx_hold_ratio ?? (account.account_role === 'DEBIT_FX' ? '1.020' : '1.000'),
        fx_cashback_rate: account.fx_cashback_rate ?? (account.account_role === 'DEBIT_FX' ? '0.0100' : '0.0000'),
        fx_monthly_cap: account.fx_monthly_cap ? formatCny(account.fx_monthly_cap) : null,
        billing_day: account.billing_day ?? null,
        repayment_day: account.repayment_day ?? null,
        is_default_pay: Boolean(account.is_default_pay),
        is_folded: Boolean(account.is_folded),
        include_in_networth: account.include_in_networth ?? true,
        sort_order: account.sort_order ?? 100,
      };
      this.state.accounts.push(target);
    }

    if (account.is_default_pay) {
      for (const a of this.state.accounts) {
        if (a.id !== target.id) {
          a.is_default_pay = false;
        }
      }
    }

    target.updated_hlc = this.hlc.now();
    this.appendOpLog('ACCOUNT', target.id, 'UPSERT', target);
    this.recalculateAllBalances();
    this.saveToStorage();

    return target;
  }

  public calibrateAccountBalance(
    accountId: string,
    targetBookBalance: string
  ): Account {
    const acc = this.state.accounts.find((a) => a.id === accountId);
    if (!acc) {
      throw new Error(`Account "${accountId}" not found`);
    }

    const delta = toDecimal(targetBookBalance).minus(toDecimal(acc.book_balance));
    acc.initial_balance = formatCny(toDecimal(acc.initial_balance ?? 0).plus(delta));
    acc.updated_hlc = this.hlc.now();

    this.appendOpLog('ACCOUNT', acc.id, 'UPSERT', acc);
    this.recalculateAllBalances();
    this.saveToStorage();

    return acc;
  }

  public deleteAccount(accountId: string): void {
    const hasActiveTx = this.state.transactions.some(
      (tx) =>
        !tx.header.is_deleted &&
        (tx.header.account_id === accountId || tx.header.target_account_id === accountId)
    );

    if (hasActiveTx) {
      throw new Error('账户存在关联交易流水，无法直接删除。请先清理或归档相关交易！');
    }

    const idx = this.state.accounts.findIndex((a) => a.id === accountId);
    if (idx !== -1) {
      this.state.accounts.splice(idx, 1);
      this.appendOpLog('ACCOUNT', accountId, 'DELETE', { id: accountId });
      this.saveToStorage();
    }
  }

  // --------------------------------------------------------------------------
  // Stage 8: 预算池与月度分配 CRUD
  // --------------------------------------------------------------------------
  public upsertBudgetPool(
    pool: Partial<BudgetPool> & { name: string; base_allocation?: string }
  ): BudgetPool {
    let target = this.state.budgetPools.find((p) => p.id === pool.id);

    if (target) {
      target.name = pool.name;
      if (pool.pool_type !== undefined) target.pool_type = pool.pool_type;
      if (pool.is_monthly_budget !== undefined) target.is_monthly_budget = pool.is_monthly_budget;
      if (pool.rollover_strategy !== undefined) target.rollover_strategy = pool.rollover_strategy;
      if (pool.description !== undefined) target.description = pool.description;
      if (pool.sort_order !== undefined) target.sort_order = pool.sort_order;
    } else {
      const id = pool.id || `POOL_CUSTOM_${Date.now()}`;
      target = {
        id,
        name: pool.name,
        pool_type: pool.pool_type ?? 'FLEX',
        is_monthly_budget: pool.is_monthly_budget ?? true,
        rollover_strategy: pool.rollover_strategy ?? 'ACCUMULATE',
        description: pool.description ?? null,
        sort_order: pool.sort_order ?? 100,
      };
      this.state.budgetPools.push(target);
    }

    if (target.is_monthly_budget && pool.base_allocation !== undefined) {
      this.upsertMonthlyBudget({
        year_month: '2026-11',
        pool_id: target.id,
        base_allocation: pool.base_allocation,
      });
    }

    this.appendOpLog('BUDGET_POOL', target.id, 'UPSERT', target);
    this.saveToStorage();

    return target;
  }

  public deleteBudgetPool(poolId: string): void {
    const inCategories = this.state.categories.some((c) => c.default_pool_id === poolId);
    const inItems = this.state.transactions.some(
      (tx) => !tx.header.is_deleted && tx.items.some((it) => it.budget_pool_id === poolId)
    );

    if (inCategories || inItems) {
      throw new Error('预算池正在被分类或交易使用，无法直接删除！请先重新分配相关分类或交易。');
    }

    const idx = this.state.budgetPools.findIndex((p) => p.id === poolId);
    if (idx !== -1) {
      this.state.budgetPools.splice(idx, 1);
      this.state.monthlyBudgets = this.state.monthlyBudgets.filter((b) => b.pool_id !== poolId);
      this.appendOpLog('BUDGET_POOL', poolId, 'DELETE', { id: poolId });
      this.saveToStorage();
    }
  }

  public upsertMonthlyBudget(params: {
    year_month: string;
    pool_id: string;
    base_allocation: string;
    rollover_from_prev?: string;
    note?: string | null;
  }): MonthlyBudget {
    let target = this.state.monthlyBudgets.find(
      (b) => b.year_month === params.year_month && b.pool_id === params.pool_id
    );

    if (target) {
      target.base_allocation = formatCny(params.base_allocation);
      if (params.rollover_from_prev !== undefined) {
        target.rollover_from_prev = formatCny(params.rollover_from_prev);
      }
      if (params.note !== undefined) {
        target.note = params.note;
      }
    } else {
      const nextId =
        this.state.monthlyBudgets.reduce((max, b) => Math.max(max, b.id), 0) + 1;
      target = {
        id: nextId,
        year_month: params.year_month,
        pool_id: params.pool_id,
        base_allocation: formatCny(params.base_allocation),
        rollover_from_prev: formatCny(params.rollover_from_prev ?? '0.00'),
        reserved_fixed: '0.00',
        swept_to_fund: '0.00',
        note: params.note ?? null,
      };
      this.state.monthlyBudgets.push(target);
    }

    this.appendOpLog('MONTHLY_BUDGET', `${params.year_month}:${params.pool_id}`, 'UPSERT', target);
    this.saveToStorage();

    return target;
  }

  // --------------------------------------------------------------------------
  // Stage 8: 商品分类 CRUD
  // --------------------------------------------------------------------------
  public upsertCategory(
    cat: Partial<Category> & { name: string; default_pool_id: string; icon?: string }
  ): Category {
    let target = this.state.categories.find((c) => c.id === cat.id);

    if (target) {
      target.name = cat.name;
      target.default_pool_id = cat.default_pool_id;
      if (cat.parent_id !== undefined) target.parent_id = cat.parent_id;
      if (cat.icon_name !== undefined || cat.icon !== undefined) {
        target.icon_name = cat.icon_name ?? cat.icon ?? null;
      }
      if (cat.keywords !== undefined) target.keywords = cat.keywords;
      if (cat.sort_order !== undefined) target.sort_order = cat.sort_order;
    } else {
      const id = cat.id || `CAT_CUSTOM_${Date.now()}`;
      target = {
        id,
        name: cat.name,
        default_pool_id: cat.default_pool_id,
        parent_id: cat.parent_id ?? null,
        icon_name: cat.icon_name ?? cat.icon ?? 'tag',
        keywords: cat.keywords ?? null,
        sort_order: cat.sort_order ?? 100,
      };
      this.state.categories.push(target);
    }

    this.appendOpLog('CATEGORY', target.id, 'UPSERT', target);
    this.saveToStorage();

    return target;
  }

  public deleteCategory(categoryId: string): void {
    const inUse = this.state.transactions.some(
      (tx) => !tx.header.is_deleted && tx.items.some((it) => it.category_id === categoryId)
    );

    if (inUse) {
      throw new Error('分类已被交易流水引用，无法直接删除！');
    }

    const idx = this.state.categories.findIndex((c) => c.id === categoryId);
    if (idx !== -1) {
      this.state.categories.splice(idx, 1);
      this.appendOpLog('CATEGORY', categoryId, 'DELETE', { id: categoryId });
      this.saveToStorage();
    }
  }

  // --------------------------------------------------------------------------
  // Stage 8: 心愿目标 / 跨期专项立项 CRUD
  // --------------------------------------------------------------------------
  public upsertProjectTag(tag: Partial<ProjectTag> & { name: string }): ProjectTag {
    let target = this.state.projectTags.find(
      (t) => (tag.id && t.id === tag.id) || t.name === tag.name
    );

    if (target) {
      target.name = tag.name;
      if (tag.tag_type !== undefined) target.tag_type = tag.tag_type;
      if (tag.target_budget !== undefined) {
        target.target_budget = tag.target_budget ? formatCny(tag.target_budget) : null;
      }
      if (tag.linked_pool_id !== undefined) target.linked_pool_id = tag.linked_pool_id;
      if (tag.is_active !== undefined) target.is_active = Boolean(tag.is_active);
      if (tag.start_date !== undefined) target.start_date = tag.start_date;
      if (tag.end_date !== undefined) target.end_date = tag.end_date;
    } else {
      const id = tag.id || `TAG_CUSTOM_${Date.now()}`;
      target = {
        id,
        name: tag.name,
        tag_type: tag.tag_type ?? 'PROJECT',
        target_budget: tag.target_budget ? formatCny(tag.target_budget) : null,
        linked_pool_id: tag.linked_pool_id ?? null,
        is_active: tag.is_active ?? true,
        start_date: tag.start_date ?? null,
        end_date: tag.end_date ?? null,
        created_at: new Date().toISOString(),
      };
      this.state.projectTags.push(target);
    }

    this.appendOpLog('PROJECT_TAG', target.id, 'UPSERT', target);
    this.saveToStorage();

    return target;
  }

  public deleteProjectTag(tagId: string): void {
    const inUse = this.state.transactions.some(
      (tx) => !tx.header.is_deleted && tx.items.some((it) => it.project_tag_id === tagId)
    );

    if (inUse) {
      throw new Error('专项标签/心愿已被交易流水引用，无法直接删除！');
    }

    const idx = this.state.projectTags.findIndex((t) => t.id === tagId);
    if (idx !== -1) {
      this.state.projectTags.splice(idx, 1);
      this.appendOpLog('PROJECT_TAG', tagId, 'DELETE', { id: tagId });
      this.saveToStorage();
    }
  }

  // --------------------------------------------------------------------------
  // Stage 8: 虚拟卡包 (免费/有偿) 与周期性规则 CRUD
  // --------------------------------------------------------------------------
  public upsertVoucher(params: {
    id?: number;
    title?: string;
    voucher_type: VoucherType;
    face_value: string;
    acquire_cost: string;
    min_spend: string;
    expire_date?: string | null;
    status?: 'AVAILABLE' | 'USED' | 'EXPIRED';
    accountId?: string;
  }): { voucher: Voucher; tx?: TransactionAggregate } {
    const finalTitle =
      params.title?.trim() ||
      generateVoucherTitle(
        params.voucher_type,
        params.face_value,
        params.min_spend,
        params.acquire_cost
      );

    if (!params.id && Number(params.acquire_cost) > 0) {
      return this.buyVoucher({
        title: finalTitle,
        voucher_type: params.voucher_type,
        face_value: params.face_value,
        acquire_cost: params.acquire_cost,
        min_spend: params.min_spend,
        accountId: params.accountId ?? 'ACC_UNION_MAIN',
        expire_date: params.expire_date,
      });
    }

    if (params.id) {
      const v = this.state.vouchers.find((it) => it.id === params.id);
      if (!v) {
        throw new Error(`Voucher "${params.id}" not found`);
      }
      v.title = finalTitle;
      v.voucher_type = params.voucher_type;
      v.face_value = formatCny(params.face_value);
      v.acquire_cost = formatCny(params.acquire_cost ?? '0.00');
      v.min_spend = formatCny(params.min_spend ?? '0.00');
      if (params.expire_date !== undefined) v.expire_date = params.expire_date;
      if (params.status !== undefined) v.status = params.status;

      this.appendOpLog('VOUCHER', String(v.id), 'UPSERT', v);
      this.recalculateAllBalances();
      this.saveToStorage();
      return { voucher: v };
    }

    const nextId =
      this.state.vouchers.reduce((max, it) => Math.max(max, it.id), 0) + 1;
    const newV: Voucher = {
      id: nextId,
      title: finalTitle,
      voucher_type: params.voucher_type,
      face_value: formatCny(params.face_value),
      acquire_cost: formatCny(params.acquire_cost ?? '0.00'),
      min_spend: formatCny(params.min_spend ?? '0.00'),
      status: params.status ?? 'AVAILABLE',
      purchase_tx_id: null,
      used_tx_id: null,
      expire_date: params.expire_date ?? '2026-12-31',
      created_at: new Date().toISOString(),
    };
    this.state.vouchers.unshift(newV);

    this.appendOpLog('VOUCHER', String(newV.id), 'UPSERT', newV);
    this.recalculateAllBalances();
    this.saveToStorage();

    return { voucher: newV };
  }

  public deleteVoucher(id: number): void {
    const idx = this.state.vouchers.findIndex((v) => v.id === id);
    if (idx !== -1) {
      const v = this.state.vouchers[idx];
      if (v.purchase_tx_id) {
        const pTx = this.state.transactions.find((t) => t.header.id === v.purchase_tx_id);
        if (pTx) {
          pTx.header.is_deleted = true;
          pTx.header.updated_hlc = this.hlc.now();
          this.appendOpLog('TRANSACTION', pTx.header.id, 'UPSERT', pTx);
        }
      }
      this.state.vouchers.splice(idx, 1);
      this.appendOpLog('VOUCHER', String(id), 'DELETE', { id });
      this.recalculateAllBalances();
      this.saveToStorage();
    }
  }

  public upsertRecurringRule(
    rule: Partial<RecurringRule> & { title: string; amount: string; account_id?: string }
  ): RecurringRule {
    let target = this.state.recurringRules.find((r) => r.id === rule.id);

    if (target) {
      target.title = rule.title;
      target.amount = formatCny(rule.amount);
      if (rule.account_id !== undefined) target.account_id = rule.account_id;
      if (rule.rule_type !== undefined) target.rule_type = rule.rule_type;
      if (rule.cron_cycle !== undefined) target.cron_cycle = rule.cron_cycle;
      if (rule.trigger_day !== undefined) target.trigger_day = rule.trigger_day;
      if (rule.currency !== undefined) target.currency = rule.currency;
      if (rule.target_account_id !== undefined) target.target_account_id = rule.target_account_id;
      if (rule.category_id !== undefined) target.category_id = rule.category_id;
      if (rule.budget_pool_id !== undefined) target.budget_pool_id = rule.budget_pool_id;
      if (rule.auto_reserve_budget !== undefined) {
        target.auto_reserve_budget = Boolean(rule.auto_reserve_budget);
      }
      if (rule.is_active !== undefined) target.is_active = Boolean(rule.is_active);
    } else {
      const nextId =
        this.state.recurringRules.reduce((max, r) => Math.max(max, r.id), 0) + 1;
      target = {
        id: nextId,
        title: rule.title,
        rule_type: rule.rule_type ?? 'FIXED_EXPENSE',
        cron_cycle: rule.cron_cycle ?? 'MONTHLY',
        trigger_day: rule.trigger_day ?? 1,
        currency: rule.currency ?? 'CNY',
        amount: formatCny(rule.amount),
        account_id: rule.account_id ?? 'ACC_UNION_MAIN',
        target_account_id: rule.target_account_id ?? null,
        category_id: rule.category_id ?? null,
        budget_pool_id: rule.budget_pool_id ?? null,
        auto_reserve_budget: rule.auto_reserve_budget ?? true,
        is_active: rule.is_active ?? true,
      };
      this.state.recurringRules.push(target);
    }

    this.appendOpLog('RECURRING_RULE', String(target.id), 'UPSERT', target);
    this.saveToStorage();

    return target;
  }

  public deleteRecurringRule(id: number): void {
    const idx = this.state.recurringRules.findIndex((r) => r.id === id);
    if (idx !== -1) {
      this.state.recurringRules.splice(idx, 1);
      this.appendOpLog('RECURRING_RULE', String(id), 'DELETE', { id });
      this.saveToStorage();
    }
  }

  public executeRecurringRule(
    id: number,
    txDate?: string
  ): TransactionAggregate {
    const rule = this.state.recurringRules.find((r) => r.id === id);
    if (!rule) {
      throw new Error(`Recurring rule "${id}" not found`);
    }

    if (rule.rule_type === 'AUTO_INVEST') {
      return this.recordManualTransaction({
        tx_type: 'TRANSFER',
        tx_date: txDate,
        account_id: rule.account_id,
        target_account_id: rule.target_account_id,
        amount: rule.amount,
        category_id: rule.category_id ?? undefined,
        budget_pool_id: rule.budget_pool_id ?? 'POOL_FIXED',
        merchant_or_note: rule.title,
        currency: rule.currency,
      });
    }

    if (rule.rule_type === 'FX_SUBSCRIPTION') {
      return this.recordManualTransaction({
        tx_type: 'EXPENSE',
        tx_date: txDate,
        account_id: rule.account_id,
        amount: rule.amount,
        category_id: rule.category_id ?? 'CAT_DIGITAL_SUB',
        budget_pool_id: rule.budget_pool_id ?? 'POOL_FLEX',
        merchant_or_note: rule.title,
        currency: rule.currency,
      });
    }

    return this.recordManualTransaction({
      tx_type: 'EXPENSE',
      tx_date: txDate,
      account_id: rule.account_id,
      amount: rule.amount,
      category_id: rule.category_id ?? 'CAT_TELECOM',
      budget_pool_id: rule.budget_pool_id ?? 'POOL_FIXED',
      merchant_or_note: rule.title,
      currency: rule.currency,
    });
  }

  // --------------------------------------------------------------------------
  // 万事达外币预授权清算
  // --------------------------------------------------------------------------
  public settleMastercardPending(
    txId: string,
    settledAmountCny: string,
    cashbackRate?: string
  ): TransactionAggregate {
    const tx = this.state.transactions.find((it) => it.header.id === txId);
    if (!tx) {
      throw new Error(`Transaction with ID "${txId}" not found`);
    }
    if (tx.header.settlement_status !== 'PENDING_HOLD') {
      throw new Error(
        `Transaction is not in PENDING_HOLD state (current: ${tx.header.settlement_status})`
      );
    }

    const resolvedCashbackRate =
      cashbackRate !== undefined && cashbackRate !== null && cashbackRate !== ''
        ? Number(cashbackRate).toFixed(4)
        : tx.header.fx_cashback_rate !== undefined &&
            tx.header.fx_cashback_rate !== null &&
            tx.header.fx_cashback_rate !== ''
          ? Number(tx.header.fx_cashback_rate).toFixed(4)
          : this.state.fxConfig?.defaultCashbackRate ?? '0.0100';

    const originalForeign = tx.header.original_amount ?? '1';
    const fxResult = processMastercardFxLifecycle({
      foreignAmount: originalForeign,
      holdAmountCny: tx.header.hold_amount_cny,
      settledAmountCny,
      cashbackRate: resolvedCashbackRate,
    });

    const nowIso = new Date().toISOString();
    const hlc = this.hlc.now();

    tx.header.settlement_status = 'SETTLED';
    tx.header.hold_amount_cny = '0.00';
    tx.header.fx_cashback_rate = resolvedCashbackRate;
    tx.header.total_gross = fxResult.total_gross;
    tx.header.payment_discount = fxResult.payment_discount;
    tx.header.total_net = fxResult.total_net;
    tx.header.exchange_rate = fxResult.exchange_rate;
    tx.header.settled_at = nowIso;
    tx.header.updated_hlc = hlc;

    // 同步更新子项
    if (tx.items.length > 0) {
      tx.items[0].item_gross = fxResult.total_gross;
      tx.items[0].allocated_discount = fxResult.payment_discount;
      tx.items[0].item_net = fxResult.total_net;
    }

    const op: SyncOpLogEntry = {
      hlc,
      node_id: this.state.nodeId,
      entity_type: 'TRANSACTION',
      entity_id: txId,
      op_type: 'UPSERT',
      payload_json: JSON.stringify(tx),
      created_at: nowIso,
    };
    this.state.oplogs.push(op);
    this.state.pendingSyncOps.push(op);

    this.recalculateAllBalances();
    this.saveToStorage();

    return tx;
  }

  // --------------------------------------------------------------------------
  // 虚拟卡包：有偿购券入库
  // --------------------------------------------------------------------------
  public buyVoucher(params: {
    title?: string;
    voucher_type: VoucherType;
    face_value: string;
    acquire_cost: string;
    min_spend: string;
    accountId?: string;
    expire_date?: string | null;
  }): { voucher: Voucher; tx: TransactionAggregate } {
    const finalTitle =
      params.title?.trim() ||
      generateVoucherTitle(
        params.voucher_type,
        params.face_value,
        params.min_spend,
        params.acquire_cost
      );
    const nextId =
      this.state.vouchers.reduce((max, v) => Math.max(max, v.id), 0) + 1;
    const nowIso = new Date().toISOString();
    const today = nowIso.slice(0, 10);
    const txId = `tx_buy_voucher_${Date.now()}`;
    const hlc = this.hlc.now();
    const accountId = params.accountId || 'ACC_UNION_MAIN';

    const newVoucher: Voucher = {
      id: nextId,
      title: finalTitle,
      voucher_type: params.voucher_type,
      face_value: formatCny(params.face_value),
      acquire_cost: formatCny(params.acquire_cost),
      min_spend: formatCny(params.min_spend),
      status: 'AVAILABLE',
      purchase_tx_id: txId,
      used_tx_id: null,
      expire_date: params.expire_date ?? '2026-12-31',
    };

    const txHeader: TransactionHeader = {
      id: txId,
      tx_date: today,
      tx_timestamp: nowIso,
      tx_type: 'VOUCHER_BUY',
      account_id: accountId,
      target_account_id: null,
      total_gross: formatCny(params.acquire_cost),
      platform_discount: '0.00',
      payment_discount: '0.00',
      total_net: formatCny(params.acquire_cost),
      allocation_mode: 'SINGLE',
      original_currency: 'CNY',
      original_amount: null,
      exchange_rate: '1.000000',
      settlement_status: 'SETTLED',
      hold_amount_cny: '0.00',
      settled_at: nowIso,
      raw_input_text: `购买卡券：${finalTitle}`,
      merchant_or_note: `购买卡券：${finalTitle}`,
      applied_voucher_id: null,
      is_deleted: false,
      updated_hlc: hlc,
      created_at: nowIso,
    };

    const tx: TransactionAggregate = {
      header: txHeader,
      items: [],
    };

    this.state.vouchers.unshift(newVoucher);
    this.state.transactions.unshift(tx);

    const vOp: SyncOpLogEntry = {
      hlc: this.hlc.now(),
      node_id: this.state.nodeId,
      entity_type: 'VOUCHER',
      entity_id: String(newVoucher.id),
      op_type: 'UPSERT',
      payload_json: JSON.stringify(newVoucher),
      created_at: nowIso,
    };
    const txOp: SyncOpLogEntry = {
      hlc,
      node_id: this.state.nodeId,
      entity_type: 'TRANSACTION',
      entity_id: txId,
      op_type: 'UPSERT',
      payload_json: JSON.stringify(tx),
      created_at: nowIso,
    };

    this.state.oplogs.push(vOp, txOp);
    this.state.pendingSyncOps.push(vOp, txOp);

    this.recalculateAllBalances();
    this.saveToStorage();

    return { voucher: newVoucher, tx };
  }

  // --------------------------------------------------------------------------
  // 指数基金市值更新
  // --------------------------------------------------------------------------
  public updateEtfMarketValue(
    accountId: string,
    marketValue: string
  ): Account {
    const acc = this.state.accounts.find((it) => it.id === accountId);
    if (!acc) throw new Error(`Account "${accountId}" not found`);

    acc.market_value = formatCny(marketValue);
    const hlc = this.hlc.now();
    acc.updated_hlc = hlc;

    const op: SyncOpLogEntry = {
      hlc,
      node_id: this.state.nodeId,
      entity_type: 'ACCOUNT',
      entity_id: acc.id,
      op_type: 'UPSERT',
      payload_json: JSON.stringify(acc),
      created_at: new Date().toISOString(),
    };
    this.state.oplogs.push(op);
    this.state.pendingSyncOps.push(op);

    this.saveToStorage();
    return acc;
  }

  // --------------------------------------------------------------------------
  // 高频生活池月末正结余划入专项考证基金池
  // --------------------------------------------------------------------------
  public sweepDailyToFund(yearMonth: string): {
    sweptAmount: string;
    yearMonth: string;
  } {
    const statusRows = this.getMonthlyBudgetStatus(yearMonth);
    const dailyRow = statusRows.find((r) => r.pool_id === 'POOL_DAILY');
    if (!dailyRow) {
      throw new Error(`Budget status for POOL_DAILY in ${yearMonth} not found`);
    }

    const remainingDec = toDecimal(dailyRow.remaining_budget);
    if (remainingDec.lessThanOrEqualTo(0)) {
      throw new Error(
        `POOL_DAILY in ${yearMonth} has no surplus to sweep (remaining: ${dailyRow.remaining_budget})`
      );
    }

    const sweptAmount = formatCny(remainingDec);
    const dailyBudget = this.state.monthlyBudgets.find(
      (b) => b.year_month === yearMonth && b.pool_id === 'POOL_DAILY'
    );
    if (dailyBudget) {
      dailyBudget.swept_to_fund = formatCny(
        toDecimal(dailyBudget.swept_to_fund).plus(remainingDec)
      );
    }

    const fundBudget = this.state.monthlyBudgets.find(
      (b) => b.year_month === yearMonth && b.pool_id === 'POOL_FUND'
    );
    if (fundBudget) {
      fundBudget.rollover_from_prev = formatCny(
        toDecimal(fundBudget.rollover_from_prev).plus(remainingDec)
      );
    }

    const hlc = this.hlc.now();
    const op: SyncOpLogEntry = {
      hlc,
      node_id: this.state.nodeId,
      entity_type: 'MONTHLY_BUDGET',
      entity_id: `${yearMonth}:SWEEP`,
      op_type: 'UPSERT',
      payload_json: JSON.stringify({ yearMonth, sweptAmount }),
      created_at: new Date().toISOString(),
    };
    this.state.oplogs.push(op);
    this.state.pendingSyncOps.push(op);

    this.saveToStorage();
    return { sweptAmount, yearMonth };
  }

  // --------------------------------------------------------------------------
  // 睡眠卡折叠切换
  // --------------------------------------------------------------------------
  public toggleAccountFolded(accountId: string): Account {
    const acc = this.state.accounts.find((a) => a.id === accountId);
    if (!acc) throw new Error(`Account "${accountId}" not found`);
    acc.is_folded = !acc.is_folded;
    this.saveToStorage();
    return acc;
  }

  // --------------------------------------------------------------------------
  // 二手回血冲抵固定资产
  // --------------------------------------------------------------------------
  public recordAssetResale(
    assetId: number,
    resaleRecovery: string
  ): FixedAsset {
    const asset = this.state.fixedAssets.find((a) => a.id === assetId);
    if (!asset) throw new Error(`Asset ID "${assetId}" not found`);

    asset.resale_recovery = formatCny(resaleRecovery);
    asset.status = 'SOLD';
    asset.resale_date = new Date().toISOString().slice(0, 10);

    const hlc = this.hlc.now();
    const op: SyncOpLogEntry = {
      hlc,
      node_id: this.state.nodeId,
      entity_type: 'FIXED_ASSET',
      entity_id: String(assetId),
      op_type: 'UPSERT',
      payload_json: JSON.stringify(asset),
      created_at: new Date().toISOString(),
    };
    this.state.oplogs.push(op);
    this.state.pendingSyncOps.push(op);

    this.saveToStorage();
    return asset;
  }

  // --------------------------------------------------------------------------
  // 看板与统计查询方法
  // --------------------------------------------------------------------------
  public getAccountDashboard(): AccountDashboardRow[] {
    return this.state.accounts.map((acc) => {
      const book = toDecimal(acc.book_balance);
      const frozen = toDecimal(acc.frozen_amount);
      const available = book.minus(frozen);
      let pnl = '0.00';
      if (acc.account_role === 'INVESTMENT' && acc.market_value != null) {
        pnl = formatCny(toDecimal(acc.market_value).minus(book));
      }
      return {
        id: acc.id,
        name: acc.name,
        account_role: acc.account_role,
        currency: acc.currency,
        book_balance: acc.book_balance,
        frozen_amount: acc.frozen_amount,
        available_balance: formatCny(available),
        market_value: acc.market_value,
        unrealized_pnl: pnl,
        is_folded: acc.is_folded,
      };
    });
  }

  public getPendingFxTransactions(): TransactionAggregate[] {
    return this.state.transactions.filter(
      (tx) =>
        !tx.header.is_deleted &&
        tx.header.settlement_status === 'PENDING_HOLD'
    );
  }

  public getMonthlyBudgetStatus(
    yearMonth = '2026-11'
  ): MonthlyBudgetStatusRow[] {
    const txsInMonth = this.state.transactions.filter(
      (tx) =>
        !tx.header.is_deleted &&
        tx.header.tx_type === 'EXPENSE' &&
        tx.header.tx_date.startsWith(yearMonth)
    );

    return this.state.budgetPools.map((pool) => {
      const mb = this.state.monthlyBudgets.find(
        (b) => b.year_month === yearMonth && b.pool_id === pool.id
      ) ?? {
        id: 0,
        year_month: yearMonth,
        pool_id: pool.id,
        base_allocation: '0.00',
        rollover_from_prev: '0.00',
        reserved_fixed: '0.00',
        swept_to_fund: '0.00',
        note: null,
      };

      const baseDec = toDecimal(mb.base_allocation);
      const rolloverDec = toDecimal(mb.rollover_from_prev);
      const sweptDec = toDecimal(mb.swept_to_fund);
      const totalAvailable = baseDec.plus(rolloverDec);

      let spentGross = new Decimal(0);
      let totalDiscount = new Decimal(0);
      let spentNet = new Decimal(0);

      for (const tx of txsInMonth) {
        for (const it of tx.items) {
          if (it.project_tag_id) continue;
          if (it.budget_pool_id === pool.id) {
            spentGross = spentGross.plus(toDecimal(it.item_gross));
            totalDiscount = totalDiscount.plus(toDecimal(it.allocated_discount));
            spentNet = spentNet.plus(toDecimal(it.item_net));
          }
        }
      }

      const remaining = totalAvailable.minus(sweptDec).minus(spentNet);

      return {
        year_month: yearMonth,
        pool_id: pool.id,
        pool_name: pool.name,
        pool_type: pool.pool_type,
        base_allocation: formatCny(baseDec),
        rollover_from_prev: formatCny(rolloverDec),
        total_available_budget: formatCny(totalAvailable),
        reserved_fixed: mb.reserved_fixed,
        spent_gross: formatCny(spentGross),
        total_saved_discount: formatCny(totalDiscount),
        spent_net: formatCny(spentNet),
        remaining_budget: formatCny(remaining),
      };
    });
  }

  public getDailyBudgetSummary(
    yearMonth = '2026-11',
    currentDate = '2026-11-12'
  ): DailyBudgetSummary {
    const statuses = this.getMonthlyBudgetStatus(yearMonth);
    const dailyRow = statuses.find((s) => s.pool_id === 'POOL_DAILY');

    const totalAvailable = dailyRow ? dailyRow.total_available_budget : '650.00';
    const spentNet = dailyRow ? dailyRow.spent_net : '0.00';
    const remaining = dailyRow ? dailyRow.remaining_budget : '650.00';

    // 计算当月剩余天数
    // 假设 2026-11 月共 30 天
    const currentDay = parseInt(currentDate.slice(8, 10), 10) || 12;
    const daysInMonth = 30;
    const remainingDays = Math.max(1, daysInMonth - currentDay + 1);

    const remainingDec = Decimal.max(0, toDecimal(remaining));
    const dailyAvailableAmount = formatCny(
      remainingDec.dividedBy(remainingDays)
    );

    // 计算全月累计薅羊毛省钱金额
    const totalSavedWool = formatCny(
      statuses.reduce(
        (sum, s) => sum.plus(toDecimal(s.total_saved_discount)),
        new Decimal(0)
      )
    );

    const formula = `(${formatCny(remainingDec)} 元 ÷ ${remainingDays} 剩余天数)`;

    return {
      poolName: '高频饮食与洗护池 (POOL_DAILY)',
      totalAvailable,
      spentNet,
      remainingBudget: remaining,
      remainingDays,
      dailyAvailableAmount,
      formula,
      totalSavedWool,
    };
  }

  public getFixedAssetsWithCost(currentDate = '2026-11-12'): FixedAssetWithCost[] {
    const currDateObj = new Date(currentDate);

    return this.state.fixedAssets.map((asset) => {
      const pDateObj = new Date(asset.purchase_date);
      let endDateObj = currDateObj;
      if (asset.status === 'SOLD' && asset.resale_date) {
        endDateObj = new Date(asset.resale_date);
      }

      const diffMs = endDateObj.getTime() - pDateObj.getTime();
      const daysHeld = Math.max(1, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

      const netCost = toDecimal(asset.purchase_net_cost).minus(
        toDecimal(asset.resale_recovery ?? 0)
      );
      const currentDaily = formatCny(netCost.dividedBy(daysHeld));

      let progressPercent = 0;
      if (asset.target_daily_cost) {
        const targetCostDec = toDecimal(asset.target_daily_cost);
        if (targetCostDec.greaterThan(0)) {
          const targetDays = netCost.dividedBy(targetCostDec).toNumber();
          progressPercent = Math.min(
            100,
            Math.max(0, Math.round((daysHeld / targetDays) * 100))
          );
        }
      }

      return {
        ...asset,
        daysHeld,
        currentDailyCost: currentDaily,
        progressPercent,
      };
    });
  }

  // --------------------------------------------------------------------------
  // 分布式同步、模拟并发冲突与防炸机演练
  // --------------------------------------------------------------------------
  public setOfflineMode(offline: boolean): void {
    this.state.isOfflineMode = offline;
    this.saveToStorage();
  }

  public async syncWithServer(apiBaseUrl = ''): Promise<{
    success: boolean;
    serverResetDetected: boolean;
    appliedRemoteCount: number;
    conflictsDetected: number;
    error?: string;
  }> {
    if (this.state.isOfflineMode) {
      return {
        success: false,
        serverResetDetected: false,
        appliedRemoteCount: 0,
        conflictsDetected: this.state.conflicts.length,
        error: '当前处于【离线断网模式】，已暂停向服务端推送同步',
      };
    }

    try {
      // 1. 发起增量同步交换
      const res = await fetch(`${apiBaseUrl}/api/sync/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ops: this.state.pendingSyncOps,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Server returned ${res.status}: ${errText}`);
      }

      const data = await res.json();
      const serverEpochId = data.serverEpochId as string;
      const serverOps = (data.serverOps ?? []) as SyncOpLogEntry[];

      // 2. 检测服务器删库炸机与重置
      if (
        this.state.serverEpochId &&
        this.state.serverEpochId !== serverEpochId &&
        serverOps.length === 0
      ) {
        this.serverResetDetected = true;
        this.state.serverEpochId = serverEpochId;
        this.saveToStorage();
        return {
          success: true,
          serverResetDetected: true,
          appliedRemoteCount: 0,
          conflictsDetected: this.state.conflicts.length,
        };
      }

      this.state.serverEpochId = serverEpochId;

      // 3. 运行核心因果合并与语义冲突检测器
      const mergeResult = mergeOpLogEntries(this.state.oplogs, serverOps);

      // 记录新冲突
      for (const cf of mergeResult.detectedConflicts) {
        if (!this.state.conflicts.some((c) => c.id === cf.id)) {
          this.state.conflicts.unshift(cf);
        }
      }

      // 服务端如果有持久化冲突也合入
      if (Array.isArray(data.conflicts)) {
        for (const cf of data.conflicts as SyncConflict[]) {
          if (!this.state.conflicts.some((c) => c.id === cf.id)) {
            this.state.conflicts.unshift(cf);
          }
        }
      }

      // 更新本地 oplogs
      this.state.oplogs = mergeResult.mergedOps;
      this.state.pendingSyncOps = [];
      this.state.lastSyncAt = new Date().toISOString();

      // 单调推进时钟
      for (const op of serverOps) {
        this.hlc.receive(op.hlc);
      }

      // 4. 重放聚合根状态
      this.serverResetDetected = false;
      this.replayMergedEntities(mergeResult.winningEntities);
      this.recalculateAllBalances();
      this.saveToStorage();

      return {
        success: true,
        serverResetDetected: false,
        appliedRemoteCount: serverOps.length,
        conflictsDetected: this.state.conflicts.length,
      };
    } catch (err) {
      return {
        success: false,
        serverResetDetected: false,
        appliedRemoteCount: 0,
        conflictsDetected: this.state.conflicts.length,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private replayMergedEntities(
    winningMap: Map<string, SyncOpLogEntry>
  ): void {
    for (const [key, op] of winningMap.entries()) {
      const [entityType, entityId] = key.split(':');
      if (op.op_type === 'DELETE') {
        if (entityType === 'TRANSACTION') {
          const t = this.state.transactions.find((tx) => tx.header.id === entityId);
          if (t) t.header.is_deleted = true;
        } else if (entityType === 'ACCOUNT') {
          this.state.accounts = this.state.accounts.filter((a) => a.id !== entityId);
        } else if (entityType === 'VOUCHER') {
          this.state.vouchers = this.state.vouchers.filter((v) => String(v.id) !== entityId);
        } else if (entityType === 'BUDGET_POOL') {
          this.state.budgetPools = this.state.budgetPools.filter((b) => b.id !== entityId);
        } else if (entityType === 'MONTHLY_BUDGET' || entityType === 'BUDGET') {
          this.state.monthlyBudgets = this.state.monthlyBudgets.filter(
            (b) => `${b.year_month}:${b.pool_id}` !== entityId && String(b.id) !== entityId
          );
        } else if (entityType === 'CATEGORY') {
          this.state.categories = this.state.categories.filter((c) => c.id !== entityId);
        } else if (entityType === 'PROJECT_TAG') {
          this.state.projectTags = this.state.projectTags.filter((p) => p.id !== entityId);
        } else if (entityType === 'RECURRING_RULE') {
          this.state.recurringRules = this.state.recurringRules.filter((r) => String(r.id) !== entityId);
        } else if (entityType === 'FIXED_ASSET') {
          this.state.fixedAssets = this.state.fixedAssets.filter((f) => String(f.id) !== entityId);
        }
        continue;
      }

      try {
        const payload = JSON.parse(op.payload_json);
        if (entityType === 'TRANSACTION') {
          const tx = payload as TransactionAggregate;
          const idx = this.state.transactions.findIndex(
            (t) => t.header.id === tx.header.id
          );
          if (idx !== -1) {
            this.state.transactions[idx] = tx;
          } else {
            this.state.transactions.unshift(tx);
          }
        } else if (entityType === 'VOUCHER') {
          const v = payload as Voucher;
          const idx = this.state.vouchers.findIndex((it) => it.id === v.id);
          if (idx !== -1) {
            this.state.vouchers[idx] = v;
          } else {
            this.state.vouchers.unshift(v);
          }
        } else if (entityType === 'ACCOUNT') {
          const acc = payload as Account;
          const idx = this.state.accounts.findIndex((it) => it.id === acc.id);
          if (idx !== -1) {
            this.state.accounts[idx] = { ...this.state.accounts[idx], ...acc };
          } else {
            this.state.accounts.push(acc);
          }
        } else if (entityType === 'BUDGET_POOL') {
          const pool = payload as BudgetPool;
          const idx = this.state.budgetPools.findIndex((p) => p.id === pool.id);
          if (idx !== -1) {
            this.state.budgetPools[idx] = { ...this.state.budgetPools[idx], ...pool };
          } else {
            this.state.budgetPools.push(pool);
          }
        } else if (entityType === 'MONTHLY_BUDGET' || entityType === 'BUDGET') {
          const mb = payload as MonthlyBudget;
          const idx = this.state.monthlyBudgets.findIndex(
            (b) => b.year_month === mb.year_month && b.pool_id === mb.pool_id
          );
          if (idx !== -1) {
            this.state.monthlyBudgets[idx] = { ...this.state.monthlyBudgets[idx], ...mb };
          } else {
            this.state.monthlyBudgets.push(mb);
          }
        } else if (entityType === 'CATEGORY') {
          const cat = payload as Category;
          const idx = this.state.categories.findIndex((c) => c.id === cat.id);
          if (idx !== -1) {
            this.state.categories[idx] = { ...this.state.categories[idx], ...cat };
          } else {
            this.state.categories.push(cat);
          }
        } else if (entityType === 'PROJECT_TAG') {
          const tag = payload as ProjectTag;
          const idx = this.state.projectTags.findIndex((t) => t.id === tag.id);
          if (idx !== -1) {
            this.state.projectTags[idx] = { ...this.state.projectTags[idx], ...tag };
          } else {
            this.state.projectTags.push(tag);
          }
        } else if (entityType === 'RECURRING_RULE') {
          const rule = payload as RecurringRule;
          const idx = this.state.recurringRules.findIndex((r) => r.id === rule.id);
          if (idx !== -1) {
            this.state.recurringRules[idx] = { ...this.state.recurringRules[idx], ...rule };
          } else {
            this.state.recurringRules.push(rule);
          }
        } else if (entityType === 'FIXED_ASSET') {
          const asset = payload as FixedAsset;
          const idx = this.state.fixedAssets.findIndex((a) => a.id === asset.id);
          if (idx !== -1) {
            this.state.fixedAssets[idx] = { ...this.state.fixedAssets[idx], ...asset };
          } else {
            this.state.fixedAssets.push(asset);
          }
        }
      } catch (e) {
        console.warn('[LocalLedgerEngine] Replay payload parse error:', e);
      }
    }
  }

  // --------------------------------------------------------------------------
  // 模拟并发冲突
  // --------------------------------------------------------------------------
  public simulateConcurrentConflict(): SyncConflict {
    // 确保有至少一笔交易供修改
    if (this.state.transactions.length === 0) {
      this.recordFromDsl('咸蛋黄拌面 16.8-0.15 #饮食');
    }

    const targetTx = this.state.transactions[0];
    const remoteNodeId = 'phone-client-node';
    const remoteHlc = new HybridLogicalClock(remoteNodeId).now();

    const remoteTx: TransactionAggregate = JSON.parse(JSON.stringify(targetTx));
    remoteTx.header.raw_input_text = `${targetTx.header.raw_input_text} (来自手机端离线修改)`;
    remoteTx.header.merchant_or_note = '手机端离线修改备注与净额';
    remoteTx.header.total_net = formatCny(
      toDecimal(remoteTx.header.total_net).plus(2)
    );
    remoteTx.header.updated_hlc = remoteHlc;

    const remoteOp: SyncOpLogEntry = {
      hlc: remoteHlc,
      node_id: remoteNodeId,
      entity_type: 'TRANSACTION',
      entity_id: targetTx.header.id,
      op_type: 'UPSERT',
      payload_json: JSON.stringify(remoteTx),
      created_at: new Date().toISOString(),
    };

    const mergeRes = mergeOpLogEntries(this.state.oplogs, [remoteOp]);
    let conflict: SyncConflict;

    if (mergeRes.detectedConflicts.length > 0) {
      conflict = mergeRes.detectedConflicts[0];
    } else {
      conflict = {
        id: `conflict_${Date.now()}_${targetTx.header.id}`,
        conflict_type: 'CONCURRENT_TX_EDIT',
        entity_id: targetTx.header.id,
        winner_hlc: targetTx.header.updated_hlc ?? this.hlc.now(),
        loser_hlc: remoteHlc,
        winner_summary: `本机版本：实付 ${targetTx.header.total_net} 元 (${targetTx.header.merchant_or_note})`,
        loser_summary: `手机端版本：实付 ${remoteTx.header.total_net} 元 (${remoteTx.header.merchant_or_note})`,
        loser_payload_json: JSON.stringify(remoteTx),
        status: 'PENDING',
        created_at: new Date().toISOString(),
      };
    }

    this.state.conflicts.unshift(conflict);
    this.saveToStorage();
    return conflict;
  }

  public resolveConflict(
    conflictId: string,
    resolution: 'KEEP_WINNER' | 'USE_LOSER'
  ): SyncConflict {
    const cf = this.state.conflicts.find((c) => c.id === conflictId);
    if (!cf) throw new Error(`Conflict "${conflictId}" not found`);

    if (resolution === 'USE_LOSER') {
      try {
        const loserPayload = JSON.parse(cf.loser_payload_json) as TransactionAggregate;
        const newHlc = this.hlc.now();
        loserPayload.header.updated_hlc = newHlc;
        const idx = this.state.transactions.findIndex(
          (t) => t.header.id === loserPayload.header.id
        );
        if (idx !== -1) {
          this.state.transactions[idx] = loserPayload;
        } else {
          this.state.transactions.unshift(loserPayload);
        }

        const op: SyncOpLogEntry = {
          hlc: newHlc,
          node_id: this.state.nodeId,
          entity_type: 'TRANSACTION',
          entity_id: loserPayload.header.id,
          op_type: 'UPSERT',
          payload_json: JSON.stringify(loserPayload),
          created_at: new Date().toISOString(),
        };
        this.state.oplogs.push(op);
        this.state.pendingSyncOps.push(op);
      } catch (e) {
        console.warn('[LocalLedgerEngine] Failed to apply loser payload:', e);
      }
    }

    cf.status = 'RESOLVED';
    this.recalculateAllBalances();
    this.saveToStorage();
    return cf;
  }

  // --------------------------------------------------------------------------
  // 模拟服务器删库炸机与反向一键推流恢复
  // --------------------------------------------------------------------------
  public async simulateServerCrashAndRecover(apiBaseUrl = ''): Promise<{
    crashed: boolean;
    restored: boolean;
    restoredAccounts: number;
    restoredOpLogs: number;
  }> {
    // 1. 调用服务端炸机演示接口
    const crashRes = await fetch(`${apiBaseUrl}/api/sync/simulate-crash`, {
      method: 'POST',
    });
    if (!crashRes.ok) {
      throw new Error(`Crash API failed with ${crashRes.status}`);
    }
    const crashData = await crashRes.json();
    this.serverResetDetected = true;
    this.state.serverEpochId = crashData.serverEpochId;

    // 2. 调用服务端反向恢复推流接口
    const bundle = this.exportFullSyncBundle();
    const reseedRes = await fetch(`${apiBaseUrl}/api/sync/reseed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bundle }),
    });
    if (!reseedRes.ok) {
      throw new Error(`Reseed API failed with ${reseedRes.status}`);
    }

    this.serverResetDetected = false;
    this.state.pendingSyncOps = [];
    this.saveToStorage();

    return {
      crashed: true,
      restored: true,
      restoredAccounts: bundle.accounts.length,
      restoredOpLogs: bundle.oplogs.length,
    };
  }

  /**
   * 仅将本机完整账本推送至云端服务端覆盖恢复（不会清空云端前的模拟销毁调用）
   */
  public async pushLocalBundleToServer(apiBaseUrl = ''): Promise<{
    restoredTransactions: number;
    restoredOpLogs: number;
  }> {
    const bundle = this.exportFullSyncBundle();
    const reseedRes = await fetch(`${apiBaseUrl}/api/sync/reseed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bundle }),
    });
    if (!reseedRes.ok) {
      const errText = await reseedRes.text().catch(() => '');
      throw new Error(`云端恢复失败 (${reseedRes.status}): ${errText || '服务端返回异常'}`);
    }

    this.serverResetDetected = false;
    this.state.pendingSyncOps = [];
    this.state.lastSyncAt = new Date().toISOString();
    this.saveToStorage();

    return {
      restoredTransactions: (bundle.transactions ?? []).length,
      restoredOpLogs: bundle.oplogs.length,
    };
  }

  /**
   * 从导出的 JSON 备份文件导入完整账本数据
   */
  public importFullSyncBundle(bundle: Partial<FullSyncBundle>): {
    transactionsCount: number;
    poolsCount: number;
    vouchersCount: number;
  } {
    if (!bundle || typeof bundle !== 'object') {
      throw new Error('无效的备份文件格式');
    }

    const hasCoreArray =
      Array.isArray(bundle.transactions) ||
      Array.isArray(bundle.budgetPools) ||
      Array.isArray(bundle.vouchers) ||
      Array.isArray(bundle.monthlyBudgets);

    if (!hasCoreArray) {
      throw new Error('备份文件中缺少账本核心数据（流水、预算池或卡券）');
    }

    const cloneOrFallback = <T>(val: T[] | undefined, fallback: T[]): T[] =>
      Array.isArray(val) ? JSON.parse(JSON.stringify(val)) : JSON.parse(JSON.stringify(fallback));

    this.state.accounts = cloneOrFallback(bundle.accounts, CLEAN_SEED_ACCOUNTS);
    this.state.budgetPools = cloneOrFallback(bundle.budgetPools, CLEAN_SEED_BUDGET_POOLS);
    this.state.categories = cloneOrFallback(bundle.categories, DEFAULT_CATEGORIES);
    this.state.projectTags = cloneOrFallback(bundle.projectTags, []);
    this.state.recurringRules = cloneOrFallback(bundle.recurringRules, []);
    this.state.fixedAssets = cloneOrFallback(bundle.fixedAssets, []);
    this.state.vouchers = cloneOrFallback(bundle.vouchers, []);
    this.state.monthlyBudgets = cloneOrFallback(bundle.monthlyBudgets, CLEAN_SEED_MONTHLY_BUDGETS);
    this.state.transactions = cloneOrFallback(bundle.transactions, []);
    this.state.oplogs = cloneOrFallback(bundle.oplogs, []);

    this.cleanupDeprecatedPoolsFromState(this.state);

    this.state.pendingSyncOps = JSON.parse(JSON.stringify(this.state.oplogs));
    this.state.conflicts = [];
    this.serverResetDetected = false;

    let maxHlc: string | undefined;
    for (const op of this.state.oplogs) {
      if (op?.hlc && (!maxHlc || HybridLogicalClock.compare(op.hlc, maxHlc) > 0)) {
        maxHlc = op.hlc;
      }
    }
    this.hlc = new HybridLogicalClock(this.state.nodeId, maxHlc);
    this.recalculateAllBalances();
    this.saveToStorage();

    return {
      transactionsCount: this.state.transactions.filter((t) => !t.header?.is_deleted).length,
      poolsCount: this.state.budgetPools.filter((p) => p.is_monthly_budget).length,
      vouchersCount: this.state.vouchers.length,
    };
  }

  public exportFullSyncBundle(): FullSyncBundle {
    return {
      nodeId: this.state.nodeId,
      exportedAt: new Date().toISOString(),
      accounts: this.state.accounts,
      budgetPools: this.state.budgetPools,
      categories: this.state.categories,
      projectTags: this.state.projectTags,
      recurringRules: this.state.recurringRules,
      fixedAssets: this.state.fixedAssets,
      oplogs: this.state.oplogs,
      vouchers: this.state.vouchers,
      monthlyBudgets: this.state.monthlyBudgets,
      transactions: this.state.transactions,
    };
  }
}
