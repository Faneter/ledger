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
  SyncConflict,
  HybridLogicalClock,
  mergeOpLogEntries,
  parseQuickInputDsl,
  computeOrderAllocation,
  processMastercardFxLifecycle,
  SplitItemInput,
  DEFAULT_CATEGORIES,
  DEFAULT_ACCOUNTS,
  DEFAULT_PROJECT_TAGS,
} from '@ledger/core';

export const LOCAL_STORAGE_KEY = 'geek_ledger_local_replica_v1';

export interface FullSyncBundle {
  nodeId: string;
  exportedAt: string;
  accounts: Account[];
  oplogs: SyncOpLogEntry[];
  vouchers: Voucher[];
  monthlyBudgets: MonthlyBudget[];
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
    rollover_strategy: 'RESET',
    description: '房租、话费、游戏月卡、定期定投',
    sort_order: 10,
  },
  {
    id: 'POOL_DAILY',
    name: '高频饮食与洗护池',
    pool_type: 'DAILY',
    is_monthly_budget: true,
    rollover_strategy: 'SWEEP_TO_FUND',
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
  public hlc: HybridLogicalClock;
  public serverResetDetected = false;
  private listeners = new Set<() => void>();

  constructor(nodeId = 'client-web-local', initialSeedOverride?: Partial<LocalReplicaState>) {
    const loaded = this.loadFromStorage();
    if (loaded) {
      this.state = loaded;
    } else {
      this.state = this.buildInitialSeed(nodeId, initialSeedOverride);
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
  // 持久化存储
  // --------------------------------------------------------------------------
  private loadFromStorage(): LocalReplicaState | null {
    try {
      const raw = getStorage().getItem(LOCAL_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.version === 1) {
        return parsed;
      }
    } catch (e) {
      console.warn('[LocalLedgerEngine] Failed to load from storage:', e);
    }
    return null;
  }

  public saveToStorage(): void {
    try {
      getStorage().setItem(LOCAL_STORAGE_KEY, JSON.stringify(this.state));
    } catch (e) {
      console.warn('[LocalLedgerEngine] Failed to save to storage:', e);
    }
    this.notify();
  }

  public resetToSeed(): void {
    this.state = this.buildInitialSeed(this.state.nodeId);
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

  private buildInitialSeed(
    nodeId: string,
    override?: Partial<LocalReplicaState>
  ): LocalReplicaState {
    return {
      version: 1,
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
      ...override,
    };
  }

  // --------------------------------------------------------------------------
  // 核心财务确定性重算
  // --------------------------------------------------------------------------
  public recalculateAllBalances(): void {
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
    });

    let voucherInfo: Voucher | null = null;
    let voucherSavings = '0.00';
    let effectiveNet = parsed.total_net;

    if (appliedVoucherId != null) {
      const v = this.state.vouchers.find(
        (it) => it.id === appliedVoucherId && it.status === 'AVAILABLE'
      );
      if (v) {
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
  // 万事达外币预授权清算
  // --------------------------------------------------------------------------
  public settleMastercardPending(
    txId: string,
    settledAmountCny: string
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

    const originalForeign = tx.header.original_amount ?? '1';
    const fxResult = processMastercardFxLifecycle({
      foreignAmount: originalForeign,
      holdAmountCny: tx.header.hold_amount_cny,
      settledAmountCny,
    });

    const nowIso = new Date().toISOString();
    const hlc = this.hlc.now();

    tx.header.settlement_status = 'SETTLED';
    tx.header.hold_amount_cny = '0.00';
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
    title: string;
    voucher_type: VoucherType;
    face_value: string;
    acquire_cost: string;
    min_spend: string;
    accountId: string;
    expire_date?: string | null;
  }): { voucher: Voucher; tx: TransactionAggregate } {
    const nextId =
      this.state.vouchers.reduce((max, v) => Math.max(max, v.id), 0) + 1;
    const nowIso = new Date().toISOString();
    const today = nowIso.slice(0, 10);
    const txId = `tx_buy_voucher_${Date.now()}`;
    const hlc = this.hlc.now();

    const newVoucher: Voucher = {
      id: nextId,
      title: params.title,
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
      account_id: params.accountId,
      target_account_id: null,
      total_gross: formatCny(params.face_value),
      platform_discount: formatCny(
        toDecimal(params.face_value).minus(toDecimal(params.acquire_cost))
      ),
      payment_discount: '0.00',
      total_net: formatCny(params.acquire_cost),
      allocation_mode: 'SINGLE',
      original_currency: 'CNY',
      original_amount: null,
      exchange_rate: '1.000000',
      settlement_status: 'SETTLED',
      hold_amount_cny: '0.00',
      settled_at: nowIso,
      raw_input_text: `购买卡券：${params.title} 成本 ${params.acquire_cost}`,
      merchant_or_note: params.title,
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
            this.state.vouchers.push(v);
          }
        } else if (entityType === 'ACCOUNT') {
          const acc = payload as Account;
          const idx = this.state.accounts.findIndex((it) => it.id === acc.id);
          if (idx !== -1) {
            this.state.accounts[idx] = { ...this.state.accounts[idx], ...acc };
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

  public exportFullSyncBundle(): FullSyncBundle {
    return {
      nodeId: this.state.nodeId,
      exportedAt: new Date().toISOString(),
      accounts: this.state.accounts,
      oplogs: this.state.oplogs,
      vouchers: this.state.vouchers,
      monthlyBudgets: this.state.monthlyBudgets,
    };
  }
}
