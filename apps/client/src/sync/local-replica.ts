import {
  Decimal,
  toDecimal,
  roundCny,
  formatCny,
  formatRate,
  sumCny,
  equalsCny,
  BudgetPool,
  Category,
  MonthlyBudget,
  MonthlyBudgetStatusRow,
  ProjectTag,
  TransactionHeader,
  TransactionItem,
  TransactionAggregate,
  AllocationMode,
  RecurringRule,
  SyncOpLogEntry,
  SyncEntityType,
  SyncConflict,
  HybridLogicalClock,
  mergeOpLogEntries,
  parseQuickInputDsl,
  allocateSplitDiscounts,
  processMastercardFxLifecycle,
  DEFAULT_FX_RATES,
  SplitItemInput,
  DEFAULT_CATEGORIES,
  DEFAULT_PROJECT_TAGS,
  FxPreferenceConfig,
  getLocalTodayDateStr,
  getLocalYearMonthStr,
} from '@ledger/core';

export const LOCAL_STORAGE_KEY = 'geek_ledger_local_replica_v2';

export interface FullSyncBundle {
  nodeId: string;
  exportedAt: string;
  oplogs: SyncOpLogEntry[];
  monthlyBudgets: MonthlyBudget[];
  budgetPools?: BudgetPool[];
  categories?: Category[];
  projectTags?: ProjectTag[];
  recurringRules?: RecurringRule[];
  transactions?: TransactionAggregate[];
}

export interface LocalReplicaState {
  version: number;
  nodeId: string;
  isOfflineMode: boolean;
  serverEpochId: string | null;
  budgetPools: BudgetPool[];
  categories: Category[];
  monthlyBudgets: MonthlyBudget[];
  projectTags: ProjectTag[];
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
];

// ----------------------------------------------------------------------------
// 纯净初始账本种子配置常量（Stage 8 纯净初始化规范）
// ----------------------------------------------------------------------------

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

export const SEED_RECURRING_RULES: RecurringRule[] = [
  {
    id: 1,
    title: '每月固定话费(移动8+电信29+联通49)',
    rule_type: 'FIXED_EXPENSE',
    cron_cycle: 'MONTHLY',
    trigger_day: 1,
    currency: 'CNY',
    amount: '86.00',
    category_id: 'CAT_TELECOM',
    budget_pool_id: 'POOL_FIXED',
    auto_reserve_budget: true,
    is_active: true,
  },
  {
    id: 2,
    title: 'Porkbun域名续费',
    rule_type: 'FX_SUBSCRIPTION',
    cron_cycle: 'YEARLY',
    trigger_day: 1,
    currency: 'USD',
    amount: '10.37',
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
      if (Array.isArray(target.categories)) {
        for (const cat of target.categories) {
          if (cat.default_pool_id && poolsToRemove.has(cat.default_pool_id)) {
            cat.default_pool_id = 'POOL_FLEX';
            cleaned = true;
          }
        }
      }
    }

    // 清理历史版本遗留的 accounts / fixedAssets / vouchers / AUTO_INVEST 状态
    if ('accounts' in (target as any)) {
      delete (target as any).accounts;
      cleaned = true;
    }
    if ('fixedAssets' in (target as any)) {
      delete (target as any).fixedAssets;
      cleaned = true;
    }
    if ('vouchers' in (target as any)) {
      delete (target as any).vouchers;
      cleaned = true;
    }
    if (Array.isArray(target.transactions)) {
      const nextTxs: TransactionAggregate[] = [];
      for (const tx of target.transactions) {
        const txType = tx?.header?.tx_type as string | undefined;
        if (txType !== 'EXPENSE' && txType !== 'INCOME') {
          cleaned = true;
          continue;
        }
        if (tx?.header && 'applied_voucher_id' in (tx.header as any)) {
          delete (tx.header as any).applied_voucher_id;
          cleaned = true;
        }
        if (tx && 'appliedVoucherId' in (tx as any)) {
          delete (tx as any).appliedVoucherId;
          cleaned = true;
        }
        nextTxs.push(tx);
      }
      if (nextTxs.length !== target.transactions.length) {
        target.transactions = nextTxs;
        cleaned = true;
      }
    }
    if (Array.isArray(target.oplogs)) {
      const nextOps: SyncOpLogEntry[] = [];
      for (const op of target.oplogs) {
        const et = (op as any)?.entity_type;
        if (et === 'VOUCHER' || et === 'ACCOUNT' || et === 'FIXED_ASSET') {
          cleaned = true;
          continue;
        }
        if (et === 'TRANSACTION' && typeof op.payload_json === 'string') {
          try {
            const p = JSON.parse(op.payload_json);
            const h = p?.header ?? p;
            if (h?.tx_type && h.tx_type !== 'EXPENSE' && h.tx_type !== 'INCOME') {
              cleaned = true;
              continue;
            }
            if ((h && 'applied_voucher_id' in h) || (p && 'appliedVoucherId' in p)) {
              if (h) delete h.applied_voucher_id;
              if (p && 'appliedVoucherId' in p) delete p.appliedVoucherId;
              nextOps.push({ ...op, payload_json: JSON.stringify(p) });
              cleaned = true;
              continue;
            }
          } catch {
            // Keep unparseable op as-is
          }
        }
        nextOps.push(op);
      }
      target.oplogs = nextOps;
    }
    if (Array.isArray(target.pendingSyncOps)) {
      const nextPending = target.pendingSyncOps.filter((op: any) => {
        const et = op?.entity_type;
        if (et === 'VOUCHER' || et === 'ACCOUNT' || et === 'FIXED_ASSET') {
          return false;
        }
        if (et === 'TRANSACTION' && typeof op.payload_json === 'string') {
          try {
            const p = JSON.parse(op.payload_json);
            const h = p?.header ?? p;
            if (h?.tx_type && h.tx_type !== 'EXPENSE' && h.tx_type !== 'INCOME') {
              return false;
            }
          } catch {
            // Ignore
          }
        }
        return true;
      });
      if (nextPending.length !== target.pendingSyncOps.length) {
        target.pendingSyncOps = nextPending;
        cleaned = true;
      }
    }
    if (Array.isArray(target.conflicts)) {
      const nextConflicts = target.conflicts.filter(
        (c: any) => c?.conflict_type !== 'VOUCHER_DOUBLE_SPEND'
      );
      if (nextConflicts.length !== target.conflicts.length) {
        target.conflicts = nextConflicts;
        cleaned = true;
      }
    }
    if (Array.isArray(target.recurringRules)) {
      const nextRules = target.recurringRules.filter(
        (r: any) => r?.rule_type !== 'AUTO_INVEST'
      );
      if (nextRules.length !== target.recurringRules.length) {
        target.recurringRules = nextRules;
        cleaned = true;
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
   * 重置为纯净账本状态（0 交易流水，仅保留标准 4 大月度预算池与收支分类体系）
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
   * 加载演示数据（包含示例预算池、专项预算与周期扣款规则）
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
      budgetPools: JSON.parse(JSON.stringify(CLEAN_SEED_BUDGET_POOLS)),
      categories: JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)),
      monthlyBudgets: JSON.parse(JSON.stringify(CLEAN_SEED_MONTHLY_BUDGETS)),
      projectTags: [],
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
      budgetPools: JSON.parse(JSON.stringify(SEED_BUDGET_POOLS)),
      categories: JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)),
      monthlyBudgets: JSON.parse(JSON.stringify(SEED_MONTHLY_BUDGETS)),
      projectTags: JSON.parse(JSON.stringify(DEFAULT_PROJECT_TAGS)),
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
        const fxRate = DEFAULT_FX_RATES[h.original_currency] ?? '7.200000';
        const holdRatio =
          this.state.fxConfig?.defaultHoldRatio || '1.020';
        const cashbackRate =
          h.fx_cashback_rate !== undefined && h.fx_cashback_rate !== null && h.fx_cashback_rate !== ''
            ? h.fx_cashback_rate
            : this.state.fxConfig?.defaultCashbackRate ?? '0.0100';
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
  // 核心财务确定性重算（仅修复历史外币预授权记录）
  // --------------------------------------------------------------------------
  public recalculateAllBalances(): void {
    this.repairBuggedFxTransactions();
  }

  // --------------------------------------------------------------------------
  // DSL 极速记账编译器与预览
  // --------------------------------------------------------------------------
  public previewDsl(rawText: string): {
    parsed: ReturnType<typeof parseQuickInputDsl>;
    is_fx_detected: boolean;
    effectiveNet: string;
  } {
    const parsed = parseQuickInputDsl(rawText, {
      categories: this.state.categories,
      projectTags: this.state.projectTags,
      budgetPools: this.state.budgetPools,
      fxConfig: this.state.fxConfig,
    });

    return {
      parsed,
      is_fx_detected: Boolean(parsed.is_fx_detected),
      effectiveNet: parsed.total_net,
    };
  }

  public recordFromDsl(
    rawText: string,
    txDate?: string
  ): TransactionAggregate {
    const preview = this.previewDsl(rawText);
    const parsed = preview.parsed;
    const hlc = this.hlc.now();
    const txId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const effectiveDate = txDate ?? getLocalTodayDateStr();
    const nowIso = new Date().toISOString();

    const header: TransactionHeader = {
      id: txId,
      tx_date: effectiveDate,
      tx_timestamp: nowIso,
      tx_type: parsed.tx_type,
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
    };

    // 1. 追加交易
    this.state.transactions.unshift(txAggregate);

    // 2. 追加 OpLog
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

    // 3. 重算并保存
    this.recalculateAllBalances();
    this.saveToStorage();

    return txAggregate;
  }

  // --------------------------------------------------------------------------
  // Stage 8: 可视化表单手工记账 (无需编写 DSL)
  // --------------------------------------------------------------------------
  public recordManualTransaction(params: {
    tx_type: 'EXPENSE' | 'INCOME';
    tx_date?: string;
    amount: string; // gross amount
    discount?: string; // optional platform/payment discount
    category_id?: string;
    budget_pool_id?: string;
    project_tag_id?: string | null;
    merchant_or_note: string;
    currency?: string; // default 'CNY'; if 'USD' etc., support hold_amount_cny or 102% hold
    hold_amount_cny?: string;
    fx_hold_ratio?: string;
    fx_cashback_rate?: string;
  }): TransactionAggregate {
    const txId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const nowIso = new Date().toISOString();
    const effectiveDate = params.tx_date ?? getLocalTodayDateStr();
    const currency = params.currency ?? 'CNY';
    const isFx = currency !== 'CNY';

    let totalGross = formatCny(params.amount);
    let paymentDiscount = formatCny(params.discount ?? '0.00');
    const platformDiscount = '0.00';
    let totalNet = formatCny(
      Decimal.max(0, toDecimal(totalGross).minus(toDecimal(paymentDiscount)))
    );
    let items: TransactionItem[] = [];
    const settlementStatus: 'PENDING_HOLD' | 'SETTLED' = isFx
      ? 'PENDING_HOLD'
      : 'SETTLED';
    let holdAmountCny = '0.00';
    let exchangeRate: string | null = isFx ? null : '1.000000';
    let fxCashbackRateToStore: string | null = null;

    if (params.tx_type === 'EXPENSE') {
      const catId = params.category_id ?? (this.state.categories[0]?.id ?? 'CAT_FOOD');
      const cat = this.state.categories.find((c) => c.id === catId);
      const poolId = params.budget_pool_id ?? (cat?.default_pool_id ?? 'POOL_DAILY');

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

      if (isFx) {
        const fxRate = DEFAULT_FX_RATES[currency] ?? '7.200000';
        const holdRatio =
          params.fx_hold_ratio !== undefined && params.fx_hold_ratio !== ''
            ? params.fx_hold_ratio
            : this.state.fxConfig?.defaultHoldRatio ?? '1.020';
        const cashbackRate =
          params.fx_cashback_rate !== undefined && params.fx_cashback_rate !== ''
            ? params.fx_cashback_rate
            : this.state.fxConfig?.defaultCashbackRate ?? '0.0100';
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
      is_deleted: false,
      updated_hlc: hlc,
      created_at: nowIso,
    };

    const txAggregate: TransactionAggregate = {
      header,
      items,
    };

    this.state.transactions.unshift(txAggregate);
    this.appendOpLog('TRANSACTION', txId, 'UPSERT', txAggregate);
    this.recalculateAllBalances();
    this.saveToStorage();

    return txAggregate;
  }

  // --------------------------------------------------------------------------
  // Stage 8: 交易编辑与删除 (支持全账本自动重算)
  // --------------------------------------------------------------------------
  public updateTransaction(
    txId: string,
    patch: {
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
  ): TransactionAggregate {
    const tx = this.state.transactions.find((t) => t.header.id === txId);
    if (!tx) {
      throw new Error(`Transaction "${txId}" not found`);
    }

    const h = tx.header;
    const prevGross = h.total_gross;
    const prevDiscount = h.payment_discount;
    const prevNet = h.total_net;

    if (patch.tx_date !== undefined) h.tx_date = patch.tx_date;
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

    const amountsChanged =
      !equalsCny(prevGross, h.total_gross) ||
      !equalsCny(prevNet, h.total_net);

    if (tx.items.length === 1) {
      const primaryItem = tx.items[0];
      const itemPatch = patch.item_updates?.find(
        (u) =>
          (u.index !== undefined && u.index === 0) ||
          (u.id !== undefined && u.id !== 0 && u.id === primaryItem.id)
      );
      if (itemPatch?.item_name !== undefined) {
        primaryItem.item_name = itemPatch.item_name;
      } else if (patch.merchant_or_note !== undefined) {
        primaryItem.item_name = patch.merchant_or_note;
      }
      if (patch.total_gross !== undefined) {
        primaryItem.item_gross = h.total_gross;
      }
      if (patch.payment_discount !== undefined) {
        primaryItem.allocated_discount = h.payment_discount;
      }
      primaryItem.item_net = h.total_net;
      if (itemPatch?.category_id !== undefined) {
        primaryItem.category_id = itemPatch.category_id;
      } else if (patch.category_id !== undefined) {
        primaryItem.category_id = patch.category_id;
      }
      if (itemPatch?.budget_pool_id !== undefined) {
        primaryItem.budget_pool_id = itemPatch.budget_pool_id;
      } else if (patch.budget_pool_id !== undefined) {
        primaryItem.budget_pool_id = patch.budget_pool_id;
      }
      if (itemPatch?.project_tag_id !== undefined) {
        primaryItem.project_tag_id = itemPatch.project_tag_id;
      } else if (patch.project_tag_id !== undefined) {
        primaryItem.project_tag_id = patch.project_tag_id;
      }
    } else if (tx.items.length > 1) {
      tx.items.forEach((item, idx) => {
        const itemPatch = patch.item_updates?.find(
          (u) =>
            (u.index !== undefined && u.index === idx) ||
            (u.id !== undefined && u.id !== 0 && u.id === item.id)
        );
        if (itemPatch) {
          if (itemPatch.item_name !== undefined) item.item_name = itemPatch.item_name;
          if (itemPatch.category_id !== undefined) item.category_id = itemPatch.category_id;
          if (itemPatch.budget_pool_id !== undefined) item.budget_pool_id = itemPatch.budget_pool_id;
          if (itemPatch.project_tag_id !== undefined) item.project_tag_id = itemPatch.project_tag_id;
        } else if (item.is_primary_item) {
          if (patch.category_id !== undefined) item.category_id = patch.category_id;
          if (patch.budget_pool_id !== undefined) item.budget_pool_id = patch.budget_pool_id;
          if (patch.project_tag_id !== undefined) item.project_tag_id = patch.project_tag_id;
        }
      });

      if (amountsChanged) {
        const oldGrossDec = toDecimal(prevGross);
        const newGrossDec = toDecimal(h.total_gross);
        let scaledGrosses: Decimal[];
        if (!equalsCny(prevGross, h.total_gross) && oldGrossDec.greaterThan(0)) {
          scaledGrosses = tx.items.map((it) =>
            roundCny(toDecimal(it.item_gross).div(oldGrossDec).times(newGrossDec))
          );
          const sumScaled = scaledGrosses.reduce((a, b) => a.plus(b), new Decimal(0));
          const diff = newGrossDec.minus(sumScaled);
          if (!diff.isZero() && scaledGrosses.length > 0) {
            scaledGrosses[0] = roundCny(scaledGrosses[0].plus(diff));
          }
        } else {
          scaledGrosses = tx.items.map((it) => toDecimal(it.item_gross));
        }

        const splitInputs: SplitItemInput[] = tx.items.map((it, idx) => ({
          name: it.item_name,
          gross: formatCny(scaledGrosses[idx]),
          category_id: it.category_id,
          budget_pool_id: it.budget_pool_id,
          project_tag_id: it.project_tag_id ?? null,
          is_primary: it.is_primary_item,
          raw_formula_expr: it.raw_formula_expr ?? undefined,
        }));
        const mode: AllocationMode =
          h.allocation_mode === 'MANUAL' ? 'PROPORTIONAL' : h.allocation_mode;
        const allocated = allocateSplitDiscounts(splitInputs, h.total_net, mode);
        tx.items.forEach((it, idx) => {
          const res = allocated[idx];
          if (res) {
            it.item_gross = res.gross;
            it.allocated_discount = res.allocated_discount;
            it.item_net = res.net;
          }
        });
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

    this.appendOpLog('TRANSACTION', txId, 'UPSERT', tx);
    this.recalculateAllBalances();
    this.saveToStorage();

    return tx;
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
  // Stage 8: 周期性规则 CRUD
  // --------------------------------------------------------------------------
  public upsertRecurringRule(
    rule: Partial<RecurringRule> & { title: string; amount: string }
  ): RecurringRule {
    let target = this.state.recurringRules.find((r) => r.id === rule.id);

    if (target) {
      target.title = rule.title;
      target.amount = formatCny(rule.amount);
      if (rule.rule_type !== undefined) target.rule_type = rule.rule_type;
      if (rule.cron_cycle !== undefined) target.cron_cycle = rule.cron_cycle;
      if (rule.trigger_day !== undefined) target.trigger_day = rule.trigger_day;
      if (rule.currency !== undefined) target.currency = rule.currency;
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

    if (rule.rule_type === 'FX_SUBSCRIPTION') {
      return this.recordManualTransaction({
        tx_type: 'EXPENSE',
        tx_date: txDate,
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
  public settleMastercardTransaction(
    txId: string,
    settledAmountCny: string,
    settledAt?: string,
    cashbackRate?: string
  ): TransactionAggregate {
    return this.settleMastercardPending(
      txId,
      settledAmountCny,
      cashbackRate,
      settledAt
    );
  }

  public settleMastercardPending(
    txId: string,
    settledAmountCny: string,
    cashbackRate?: string,
    settledAt?: string
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

    const nowIso = settledAt ?? new Date().toISOString();
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

    // 同步更新子项（单品直接赋值，多品按清算数额重算缩放分摊）
    if (tx.items.length === 1) {
      tx.items[0].item_gross = fxResult.total_gross;
      tx.items[0].allocated_discount = fxResult.payment_discount;
      tx.items[0].item_net = fxResult.total_net;
    } else if (tx.items.length > 1) {
      const oldGrossSum = sumCny(tx.items.map((it) => it.item_gross));
      const newGrossDec = toDecimal(fxResult.total_gross);
      let scaledGrosses = oldGrossSum.gt(0)
        ? tx.items.map((it) =>
            roundCny(
              toDecimal(it.item_gross).times(newGrossDec).dividedBy(oldGrossSum)
            )
          )
        : tx.items.map((it) => toDecimal(it.item_gross));
      if (scaledGrosses.length > 0 && oldGrossSum.gt(0)) {
        const diff = newGrossDec.minus(sumCny(scaledGrosses));
        scaledGrosses[0] = roundCny(scaledGrosses[0].plus(diff));
      }
      const splitInputs: SplitItemInput[] = tx.items.map((it, idx) => ({
        name: it.item_name,
        gross: formatCny(scaledGrosses[idx]),
        category_id: it.category_id,
        budget_pool_id: it.budget_pool_id,
        project_tag_id: it.project_tag_id,
        is_primary: it.is_primary_item,
      }));
      const mode: AllocationMode =
        tx.header.allocation_mode === 'MANUAL'
          ? 'PROPORTIONAL'
          : tx.header.allocation_mode;
      const allocated = allocateSplitDiscounts(
        splitInputs,
        fxResult.total_net,
        mode
      );
      tx.items.forEach((it, idx) => {
        const a = allocated[idx];
        if (a) {
          it.item_gross = a.gross;
          it.allocated_discount = a.allocated_discount;
          it.item_net = a.net;
        }
      });
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
  // 看板与统计查询方法
  // --------------------------------------------------------------------------
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

    const sortedPools = [...this.state.budgetPools].sort((a, b) =>
      a.id.localeCompare(b.id)
    );

    return sortedPools.map((pool) => {
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
          if (it.project_tag_id && pool.is_monthly_budget) continue;
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

  public getMonthlyBudgetDashboard(
    yearMonth: string,
    currentDateStr?: string
  ): {
    pools: MonthlyBudgetStatusRow[];
    dailyPoolRemainingPerDay: string;
    totalMonthlyBudget: string;
    totalMonthlySpent: string;
    totalMonthlySaved: string;
  } {
    const pools = this.getMonthlyBudgetStatus(yearMonth);
    const [y, m] = yearMonth.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    let remainingDays = daysInMonth;

    if (currentDateStr && currentDateStr.startsWith(yearMonth)) {
      const parts = currentDateStr.split('-');
      const curDay = parseInt(parts[2], 10);
      if (!Number.isNaN(curDay)) {
        remainingDays = Math.max(1, daysInMonth - curDay + 1);
      }
    }

    const dailyPool = pools.find(
      (p) => p.pool_id === 'POOL_DAILY' || p.pool_type === 'DAILY'
    );
    let dailyPoolRemainingPerDay = '0.00';
    if (dailyPool) {
      const remaining = toDecimal(dailyPool.remaining_budget);
      dailyPoolRemainingPerDay = formatCny(remaining.dividedBy(remainingDays));
    }

    const monthlyPools = pools.filter((p) =>
      ['POOL_FIXED', 'POOL_DAILY', 'POOL_FLEX', 'POOL_EMERGENCY'].includes(
        p.pool_id
      )
    );
    const totalMonthlyBudget = formatCny(
      sumCny(monthlyPools.map((p) => p.total_available_budget))
    );
    const totalMonthlySpent = formatCny(
      sumCny(monthlyPools.map((p) => p.spent_net))
    );
    const totalMonthlySaved = formatCny(
      sumCny(monthlyPools.map((p) => p.total_saved_discount))
    );

    return {
      pools,
      dailyPoolRemainingPerDay,
      totalMonthlyBudget,
      totalMonthlySpent,
      totalMonthlySaved,
    };
  }

  public executeMonthRollover(
    fromYearMonth: string,
    toYearMonth: string
  ): MonthlyBudgetStatusRow[] {
    const fromRows = this.getMonthlyBudgetStatus(fromYearMonth);
    const sortedPools = [...this.state.budgetPools].sort(
      (a, b) => a.sort_order - b.sort_order
    );

    for (const pool of sortedPools) {
      let rollover = '0.00';
      const fromRow = fromRows.find((p) => p.pool_id === pool.id);
      if (pool.rollover_strategy === 'RESET') {
        rollover = '0.00';
      } else if (pool.rollover_strategy === 'ACCUMULATE') {
        rollover = formatCny(toDecimal(fromRow?.remaining_budget ?? '0.00'));
      }

      this.upsertMonthlyBudget({
        year_month: toYearMonth,
        pool_id: pool.id,
        base_allocation: fromRow?.base_allocation ?? '0.00',
        rollover_from_prev: rollover,
      });
    }

    return this.getMonthlyBudgetStatus(toYearMonth);
  }

  public getDailyBudgetSummary(
    yearMonth = getLocalYearMonthStr(),
    currentDate = getLocalTodayDateStr()
  ): DailyBudgetSummary {
    const statuses = this.getMonthlyBudgetStatus(yearMonth);
    const dailyRow = statuses.find((s) => s.pool_id === 'POOL_DAILY');

    const totalAvailable = dailyRow ? dailyRow.total_available_budget : '650.00';
    const spentNet = dailyRow ? dailyRow.spent_net : '0.00';
    const remaining = dailyRow ? dailyRow.remaining_budget : '650.00';

    // 计算当月实际总天数与剩余天数
    const [yStr, mStr] = yearMonth.split('-');
    const yearNum = Number(yStr);
    const monthNum = Number(mStr);
    const daysInMonth =
      yearNum > 0 && monthNum >= 1 && monthNum <= 12
        ? new Date(yearNum, monthNum, 0).getDate()
        : 30;
    const currentDay = parseInt(currentDate.slice(8, 10), 10) || 1;
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

      // 3. 运行核心因果合并与语义冲突检测器（过滤历史卡包/双花冲突）
      const filteredServerOps: SyncOpLogEntry[] = [];
      for (const op of serverOps) {
        const et = op.entity_type as string;
        if (et === 'VOUCHER' || et === 'ACCOUNT' || et === 'FIXED_ASSET') {
          continue;
        }
        if (et === 'TRANSACTION') {
          try {
            const p = JSON.parse(op.payload_json);
            const h = p?.header ?? p;
            if (h?.tx_type && h.tx_type !== 'EXPENSE' && h.tx_type !== 'INCOME') {
              continue;
            }
            if ((h && 'applied_voucher_id' in h) || (p && 'appliedVoucherId' in p)) {
              if (h) delete h.applied_voucher_id;
              if (p && 'appliedVoucherId' in p) delete p.appliedVoucherId;
              filteredServerOps.push({ ...op, payload_json: JSON.stringify(p) });
              continue;
            }
          } catch {
            // Keep unparseable op
          }
        }
        filteredServerOps.push(op);
      }

      const mergeResult = mergeOpLogEntries(this.state.oplogs, filteredServerOps);

      // 记录新冲突
      for (const cf of mergeResult.detectedConflicts) {
        if ((cf.conflict_type as string) === 'VOUCHER_DOUBLE_SPEND') continue;
        if (!this.state.conflicts.some((c) => c.id === cf.id)) {
          this.state.conflicts.unshift(cf);
        }
      }

      // 服务端如果有持久化冲突也合入
      if (Array.isArray(data.conflicts)) {
        for (const cf of data.conflicts as SyncConflict[]) {
          if ((cf.conflict_type as string) === 'VOUCHER_DOUBLE_SPEND') continue;
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
      for (const op of filteredServerOps) {
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
        appliedRemoteCount: filteredServerOps.length,
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
          // 账户体系已彻底移除，兼容忽略历史遗留的 ACCOUNT 同步日志
          continue;
        } else if (entityType === 'VOUCHER') {
          // 卡包功能已移除，兼容忽略历史同步日志
          continue;
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
          // 固定资产功能已移除，兼容忽略历史 DELETE 日志
          continue;
        }
        continue;
      }

      try {
        const payload = JSON.parse(op.payload_json);
        if (entityType === 'TRANSACTION') {
          const tx = payload as TransactionAggregate;
          const txType = tx?.header?.tx_type as string | undefined;
          if (txType !== 'EXPENSE' && txType !== 'INCOME') {
            continue;
          }
          if ('applied_voucher_id' in (tx.header as any)) {
            delete (tx.header as any).applied_voucher_id;
          }
          if ('appliedVoucherId' in (tx as any)) {
            delete (tx as any).appliedVoucherId;
          }
          const idx = this.state.transactions.findIndex(
            (t) => t.header.id === tx.header.id
          );
          if (idx !== -1) {
            this.state.transactions[idx] = tx;
          } else {
            this.state.transactions.unshift(tx);
          }
        } else if (entityType === 'VOUCHER') {
          // 卡包功能已移除，兼容忽略历史同步日志
          continue;
        } else if (entityType === 'ACCOUNT') {
          // 账户体系已彻底移除，兼容忽略历史遗留的 ACCOUNT 同步日志
          continue;
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
          // 固定资产功能已移除，兼容忽略历史同步日志
          continue;
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
    restoredTransactions: number;
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
      restoredTransactions: (bundle.transactions ?? []).length,
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
  } {
    if (!bundle || typeof bundle !== 'object') {
      throw new Error('无效的备份文件格式');
    }

    const hasCoreArray =
      Array.isArray(bundle.transactions) ||
      Array.isArray(bundle.budgetPools) ||
      Array.isArray(bundle.monthlyBudgets) ||
      Array.isArray(bundle.oplogs);

    if (!hasCoreArray) {
      throw new Error('备份文件中缺少账本核心数据（流水或预算池）');
    }

    const cloneOrFallback = <T>(val: T[] | undefined, fallback: T[]): T[] =>
      Array.isArray(val) ? JSON.parse(JSON.stringify(val)) : JSON.parse(JSON.stringify(fallback));

    this.state.budgetPools = cloneOrFallback(bundle.budgetPools, CLEAN_SEED_BUDGET_POOLS);
    this.state.categories = cloneOrFallback(bundle.categories, DEFAULT_CATEGORIES);
    this.state.projectTags = cloneOrFallback(bundle.projectTags, []);
    this.state.recurringRules = cloneOrFallback(bundle.recurringRules, []);
    this.state.monthlyBudgets = cloneOrFallback(bundle.monthlyBudgets, CLEAN_SEED_MONTHLY_BUDGETS);
    this.state.transactions = cloneOrFallback(bundle.transactions, []);
    this.state.oplogs = cloneOrFallback(bundle.oplogs, []).filter(
      (op: any) =>
        op?.entity_type !== 'VOUCHER' &&
        op?.entity_type !== 'ACCOUNT' &&
        op?.entity_type !== 'FIXED_ASSET'
    );

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
    };
  }

  public exportFullSyncBundle(): FullSyncBundle {
    return {
      nodeId: this.state.nodeId,
      exportedAt: new Date().toISOString(),
      budgetPools: this.state.budgetPools,
      categories: this.state.categories,
      projectTags: this.state.projectTags,
      recurringRules: this.state.recurringRules,
      oplogs: this.state.oplogs,
      monthlyBudgets: this.state.monthlyBudgets,
      transactions: this.state.transactions,
    };
  }
}
