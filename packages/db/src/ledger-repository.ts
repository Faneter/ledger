import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
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
  PoolType,
  Category,
  MonthlyBudget,
  MonthlyBudgetStatusRow,
  ProjectTag,
  Voucher,
  VoucherType,
  TransactionHeader,
  TransactionItem,
  TransactionAggregate,
  AllocationMode,
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
  allocateSplitDiscounts,
  processMastercardFxLifecycle,
  DEFAULT_FX_RATES,
  SplitItemInput,
  generateVoucherTitle,
  type FullSyncBundle,
} from '@ledger/core';
import { SCHEMA_SQL, SEED_SQL } from './schema.js';
import { recalculateAllAccounts } from './balance-recalculator.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: typeof DatabaseSyncType;
};

export type { FullSyncBundle };

export class LedgerRepository {
  public readonly db: DatabaseSyncType;
  public readonly nodeId: string;
  public readonly hlc: HybridLogicalClock;

  constructor(dbPath = ':memory:', nodeId = 'local-node') {
    this.nodeId = nodeId;
    this.db = new DatabaseSync(dbPath);

    // 启用外键约束
    this.db.exec('PRAGMA foreign_keys = ON;');

    // 初始化建表与种子数据
    this.db.exec(SCHEMA_SQL);
    this.ensureSchemaMigrations();
    this.db.exec(SEED_SQL);

    // 确定混合逻辑时钟初始水位
    const maxHlcRow = this.db
      .prepare('SELECT MAX(hlc) as max_hlc FROM sync_oplog')
      .get() as { max_hlc: string | null } | undefined;
    this.hlc = new HybridLogicalClock(nodeId, maxHlcRow?.max_hlc ?? undefined);

    // 初始化重算各账户余额
    recalculateAllAccounts(this.db);
  }

  /**
   * 对已存在的老 SQLite 数据库执行向后兼容的列迁移
   */
  private ensureSchemaMigrations(): void {
    const cols = this.db
      .prepare('PRAGMA table_info(transaction_headers)')
      .all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'fx_cashback_rate')) {
      this.db.exec(
        'ALTER TABLE transaction_headers ADD COLUMN fx_cashback_rate NUMERIC(5, 4) DEFAULT NULL;'
      );
    }
  }

  /**
   * 设置账户初始本金/余额
   */
  public setAccountInitialBalance(
    accountId: string,
    initialBalance: string
  ): void {
    const formatted = formatCny(initialBalance);
    const hlc = this.hlc.now();

    this.db
      .prepare(
        'UPDATE accounts SET initial_balance = ?, updated_hlc = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      )
      .run(formatted, hlc, accountId);

    this.recordOpLog({
      hlc,
      node_id: this.nodeId,
      entity_type: 'ACCOUNT',
      entity_id: accountId,
      op_type: 'UPSERT',
      payload_json: JSON.stringify({
        id: accountId,
        initial_balance: formatted,
      }),
      created_at: new Date().toISOString(),
    });

    recalculateAllAccounts(this.db);
  }

  /**
   * 获取账户双轨看板数据 (v_account_dashboard)
   */
  public getAccountDashboard(): AccountDashboardRow[] {
    const rows = this.db
      .prepare('SELECT * FROM v_account_dashboard')
      .all() as any[];

    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      account_role: r.account_role as AccountRole,
      currency: String(r.currency),
      book_balance: formatCny(r.book_balance),
      frozen_amount: formatCny(r.frozen_amount),
      available_balance: formatCny(r.available_balance),
      market_value: r.market_value != null ? formatCny(r.market_value) : null,
      unrealized_pnl: formatCny(r.unrealized_pnl),
      is_folded: Boolean(r.is_folded),
    }));
  }

  /**
   * 获取月度预算池执行水位与剩余额度看板 (v_monthly_budget_status)
   */
  public getMonthlyBudgetStatus(
    yearMonth: string,
    currentDateStr?: string
  ): {
    pools: MonthlyBudgetStatusRow[];
    dailyPoolRemainingPerDay: string;
    totalMonthlyBudget: string;
    totalMonthlySpent: string;
    totalMonthlySaved: string;
  } {
    const rows = this.db
      .prepare(
        'SELECT * FROM v_monthly_budget_status WHERE year_month = ? ORDER BY pool_id ASC'
      )
      .all(yearMonth) as any[];

    const pools: MonthlyBudgetStatusRow[] = rows.map((r) => ({
      year_month: String(r.year_month),
      pool_id: String(r.pool_id),
      pool_name: String(r.pool_name),
      pool_type: r.pool_type as PoolType,
      base_allocation: formatCny(r.base_allocation),
      rollover_from_prev: formatCny(r.rollover_from_prev),
      total_available_budget: formatCny(r.total_available_budget),
      reserved_fixed: formatCny(r.reserved_fixed),
      spent_gross: formatCny(r.spent_gross),
      total_saved_discount: formatCny(r.total_saved_discount),
      spent_net: formatCny(r.spent_net),
      remaining_budget: formatCny(r.remaining_budget),
    }));

    // PRD 2.1 高频生活池动态日均可用额度计算
    // 今日剩余日均可用额度 = (高频池月度总可用额 - 本月累计已用净额) / 本月剩余天数（含今日）
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

    // 4 个常规月度预算池汇总
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

  /**
   * 录入结构化完整交易聚合实体
   */
  public recordTransaction(
    aggregate: Omit<TransactionAggregate, 'header' | 'items'> & {
      header: Omit<TransactionHeader, 'id' | 'tx_timestamp'> & {
        id?: string;
        tx_timestamp?: string;
      };
      items: Array<
        Omit<TransactionItem, 'id' | 'header_id' | 'raw_formula_expr'> & {
          id?: number;
          header_id?: string;
          raw_formula_expr?: string | null;
        }
      >;
    }
  ): TransactionAggregate {
    const { header, items, appliedVoucherId } = aggregate;

    // 财务守恒定律校验：若为 EXPENSE 支出交易，items 之和必须严格等于 header 总额
    if (header.tx_type === 'EXPENSE' && items.length > 0) {
      const sumGross = sumCny(items.map((it) => it.item_gross));
      const sumNet = sumCny(items.map((it) => it.item_net));

      if (!equalsCny(sumGross, header.total_gross)) {
        throw new Error(
          `Conservation law violated: sum(items.item_gross) (${formatCny(
            sumGross
          )}) != header.total_gross (${formatCny(header.total_gross)})`
        );
      }
      if (!equalsCny(sumNet, header.total_net)) {
        throw new Error(
          `Conservation law violated: sum(items.item_net) (${formatCny(
            sumNet
          )}) != header.total_net (${formatCny(header.total_net)})`
        );
      }
    }

    const txId =
      header.id ??
      `TX_${Date.now()}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const txTimestamp = header.tx_timestamp ?? new Date().toISOString();
    const hlc = this.hlc.now();

    const voucherIdToUse =
      appliedVoucherId ?? header.applied_voucher_id ?? null;

    // 1. 写入主表 transaction_headers
    this.db
      .prepare(
        `
      INSERT INTO transaction_headers (
        id, tx_date, tx_timestamp, tx_type, account_id, target_account_id,
        total_gross, platform_discount, payment_discount, total_net,
        allocation_mode, original_currency, original_amount, exchange_rate,
        settlement_status, hold_amount_cny, fx_cashback_rate, settled_at, raw_input_text,
        merchant_or_note, applied_voucher_id, is_deleted, updated_hlc
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        txId,
        header.tx_date,
        txTimestamp,
        header.tx_type,
        header.account_id,
        header.target_account_id ?? null,
        formatCny(header.total_gross),
        formatCny(header.platform_discount ?? 0),
        formatCny(header.payment_discount ?? 0),
        formatCny(header.total_net),
        header.allocation_mode ?? 'SINGLE',
        header.original_currency ?? 'CNY',
        header.original_amount != null
          ? formatCny(header.original_amount)
          : null,
        header.exchange_rate ? formatRate(header.exchange_rate) : '1.000000',
        header.settlement_status ?? 'SETTLED',
        formatCny(header.hold_amount_cny ?? 0),
        header.fx_cashback_rate != null && header.fx_cashback_rate !== ''
          ? Number(header.fx_cashback_rate).toFixed(4)
          : null,
        header.settled_at ?? null,
        header.raw_input_text ?? null,
        header.merchant_or_note ?? null,
        voucherIdToUse,
        0,
        hlc
      );

    // 2. 写入子表 transaction_items
    const insertedItems: TransactionItem[] = [];
    const insertItemStmt = this.db.prepare(`
      INSERT INTO transaction_items (
        header_id, item_name, category_id, budget_pool_id, project_tag_id,
        item_gross, allocated_discount, item_net, is_primary_item, raw_formula_expr
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const item of items) {
      const res = insertItemStmt.run(
        txId,
        item.item_name,
        item.category_id,
        item.budget_pool_id,
        item.project_tag_id ?? null,
        formatCny(item.item_gross),
        formatCny(item.allocated_discount ?? 0),
        formatCny(item.item_net),
        item.is_primary_item ? 1 : 0,
        item.raw_formula_expr ?? null
      );
      insertedItems.push({
        ...item,
        id: Number(res.lastInsertRowid),
        header_id: txId,
        item_gross: formatCny(item.item_gross),
        allocated_discount: formatCny(item.allocated_discount ?? 0),
        item_net: formatCny(item.item_net),
        raw_formula_expr: item.raw_formula_expr ?? null,
      });
    }

    // 3. 若核销了卡券，更新 vouchers 状态为 USED
    if (voucherIdToUse != null) {
      this.db
        .prepare(
          "UPDATE vouchers SET status = 'USED', used_tx_id = ? WHERE id = ?"
        )
        .run(txId, voucherIdToUse);
    }

    const finalAggregate: TransactionAggregate = {
      header: {
        ...header,
        id: txId,
        tx_timestamp: txTimestamp,
        total_gross: formatCny(header.total_gross),
        platform_discount: formatCny(header.platform_discount ?? 0),
        payment_discount: formatCny(header.payment_discount ?? 0),
        total_net: formatCny(header.total_net),
        hold_amount_cny: formatCny(header.hold_amount_cny ?? 0),
        exchange_rate: header.exchange_rate
          ? formatRate(header.exchange_rate)
          : '1.000000',
        applied_voucher_id: voucherIdToUse,
        is_deleted: false,
        updated_hlc: hlc,
      },
      items: insertedItems,
      appliedVoucherId: voucherIdToUse,
    };

    // 4. 写入同步变更日志
    this.recordOpLog({
      hlc,
      node_id: this.nodeId,
      entity_type: 'TRANSACTION',
      entity_id: txId,
      op_type: 'UPSERT',
      payload_json: JSON.stringify(finalAggregate),
      created_at: new Date().toISOString(),
    });

    // 5. 重新确定性计算各账户余额
    recalculateAllAccounts(this.db);

    return finalAggregate;
  }

  /**
   * 从极速记账算式 DSL 录入交易（支持跨品类凑单、外币预授权、用券还款与立减金核销）
   */
  public recordFromDsl(
    rawText: string,
    txDate?: string,
    appliedVoucherId?: number | null
  ): TransactionAggregate {
    const categories = this.db
      .prepare('SELECT * FROM categories')
      .all() as unknown as Category[];
    const accounts = (
      this.db
        .prepare(
          'SELECT id, name, account_role, is_default_pay FROM accounts'
        )
        .all() as any[]
    ).map((a) => ({
      ...a,
      is_default_pay: Boolean(a.is_default_pay),
    }));
    const projectTags = this.db
      .prepare('SELECT * FROM projects_and_tags')
      .all() as unknown as ProjectTag[];

    const parsed = parseQuickInputDsl(rawText, {
      categories,
      accounts,
      projectTags,
      txDate,
    });

    let totalGross = parsed.total_gross;
    let paymentDiscount = parsed.payment_discount;
    let platformDiscount = parsed.platform_discount;
    let totalNet = parsed.total_net;
    let items = parsed.items;

    // 若传入 appliedVoucherId，结合卡券成本结转计算
    if (appliedVoucherId != null) {
      const voucher = this.db
        .prepare('SELECT * FROM vouchers WHERE id = ?')
        .get(appliedVoucherId) as Voucher | undefined;

      if (voucher) {
        if (voucher.status !== 'AVAILABLE') {
          throw new Error(`优惠券「${voucher.title}」已被使用或已失效`);
        }
        if (parsed.tx_type === 'EXPENSE' && voucher.voucher_type === 'REPAY_COUPON') {
          throw new Error('还款专用券仅限在「转账/还款」中使用');
        }
        if (parsed.tx_type === 'TRANSFER' && voucher.voucher_type !== 'REPAY_COUPON') {
          throw new Error('转账/还款仅可使用「还款券」类型的优惠券');
        }
        if (parsed.tx_type === 'INCOME') {
          throw new Error('收入交易不可使用优惠券');
        }
        const totalGrossDec = toDecimal(parsed.total_gross);
        if (totalGrossDec.lessThan(toDecimal(voucher.min_spend))) {
          throw new Error(
            `未达到优惠券「${voucher.title}」的最低使用门槛（需满 ¥${voucher.min_spend}，当前金额 ¥${formatCny(totalGrossDec)}）`
          );
        }

        if (parsed.tx_type === 'EXPENSE') {
          // 实际现场微信/刷卡支付现金
          const cashPaid = Decimal.max(
            0,
            toDecimal(parsed.total_net).minus(toDecimal(voucher.face_value))
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
              face_value: voucher.face_value,
              acquire_cost: voucher.acquire_cost,
              voucher_type: voucher.voucher_type,
            }
          );

          totalGross = alloc.total_gross;
          paymentDiscount = alloc.total_discount;
          platformDiscount = '0.00';
          totalNet = alloc.total_net;
          items = parsed.items.map((it, idx) => ({
            ...it,
            item_gross: alloc.items[idx].gross,
            allocated_discount: alloc.items[idx].allocated_discount,
            item_net: alloc.items[idx].net,
          }));
        } else if (parsed.tx_type === 'TRANSFER') {
          // 还款券抵扣（若 DSL 中已包含 `- 还款券 5` 则不重复累加）
          if (toDecimal(paymentDiscount).isZero()) {
            paymentDiscount = formatCny(voucher.face_value);
          }
          totalNet = formatCny(
            toDecimal(totalGross).minus(toDecimal(paymentDiscount))
          );
        }
      }
    }

    return this.recordTransaction({
      header: {
        tx_date: txDate ?? new Date().toISOString().slice(0, 10),
        tx_type: parsed.tx_type,
        account_id: parsed.account_id,
        target_account_id: parsed.target_account_id,
        total_gross: totalGross,
        platform_discount: platformDiscount,
        payment_discount: paymentDiscount,
        total_net: totalNet,
        allocation_mode: parsed.allocation_mode,
        original_currency: parsed.original_currency,
        original_amount: parsed.original_amount,
        exchange_rate: parsed.exchange_rate,
        settlement_status: parsed.settlement_status,
        hold_amount_cny: parsed.hold_amount_cny,
        fx_cashback_rate: parsed.fx_cashback_rate ?? null,
        settled_at: null,
        raw_input_text: parsed.raw_input_text,
        merchant_or_note: parsed.merchant_or_note,
        applied_voucher_id: appliedVoucherId ?? null,
      },
      items: items.map((it) => ({
        id: 0,
        header_id: '',
        item_name: it.item_name,
        category_id: it.category_id,
        budget_pool_id: it.budget_pool_id,
        project_tag_id: it.project_tag_id,
        item_gross: it.item_gross,
        allocated_discount: it.allocated_discount,
        item_net: it.item_net,
        is_primary_item: it.is_primary_item,
        raw_formula_expr: it.raw_formula_expr,
      })),
      appliedVoucherId,
    });
  }

  /**
   * 万事达外币预授权清算确认 (PENDING_HOLD -> SETTLED)
   */
  public settleMastercardTransaction(
    txId: string,
    settledAmountCny: string,
    settledAt?: string,
    cashbackRate?: string
  ): TransactionAggregate {
    const header = this.db
      .prepare('SELECT * FROM transaction_headers WHERE id = ?')
      .get(txId) as any;

    if (!header) {
      throw new Error(`Transaction with ID "${txId}" not found`);
    }
    if (header.settlement_status !== 'PENDING_HOLD') {
      throw new Error(
        `Transaction "${txId}" is in status "${header.settlement_status}", not "PENDING_HOLD"`
      );
    }

    const resolvedCashbackRate =
      cashbackRate !== undefined && cashbackRate !== null && cashbackRate !== ''
        ? Number(cashbackRate).toFixed(4)
        : header.fx_cashback_rate != null && header.fx_cashback_rate !== ''
          ? Number(header.fx_cashback_rate).toFixed(4)
          : '0.0100';

    const fxResult = processMastercardFxLifecycle({
      foreignAmount: header.original_amount!,
      holdAmountCny: header.hold_amount_cny,
      settledAmountCny,
      cashbackRate: resolvedCashbackRate,
    });

    const items = this.db
      .prepare('SELECT * FROM transaction_items WHERE header_id = ?')
      .all(txId) as any[];

    let updatedItems: any[] = [];
    if (items.length <= 1) {
      updatedItems = items.map((it) => ({
        ...it,
        item_gross: fxResult.total_gross,
        allocated_discount: fxResult.payment_discount,
        item_net: fxResult.total_net,
      }));
    } else {
      const splitInputs: SplitItemInput[] = items.map((it) => ({
        name: it.item_name,
        gross: it.item_gross,
        category_id: it.category_id,
        budget_pool_id: it.budget_pool_id,
        project_tag_id: it.project_tag_id,
        is_primary: Boolean(it.is_primary_item),
      }));
      const allocs = allocateSplitDiscounts(
        splitInputs,
        fxResult.total_net,
        header.allocation_mode as AllocationMode
      );
      updatedItems = items.map((it, idx) => ({
        ...it,
        item_gross: allocs[idx].gross,
        allocated_discount: allocs[idx].allocated_discount,
        item_net: allocs[idx].net,
      }));
    }

    const hlc = this.hlc.now();
    const finalSettledAt = settledAt ?? new Date().toISOString();

    // 更新主表
    this.db
      .prepare(
        `
      UPDATE transaction_headers
      SET settlement_status = 'SETTLED',
          hold_amount_cny = '0.00',
          fx_cashback_rate = ?,
          total_gross = ?,
          payment_discount = ?,
          total_net = ?,
          exchange_rate = ?,
          settled_at = ?,
          updated_hlc = ?
      WHERE id = ?
    `
      )
      .run(
        resolvedCashbackRate,
        fxResult.total_gross,
        fxResult.payment_discount,
        fxResult.total_net,
        fxResult.exchange_rate,
        finalSettledAt,
        hlc,
        txId
      );

    // 更新子明细
    const updateItemStmt = this.db.prepare(`
      UPDATE transaction_items
      SET item_gross = ?, allocated_discount = ?, item_net = ?
      WHERE id = ?
    `);
    for (const it of updatedItems) {
      updateItemStmt.run(
        it.item_gross,
        it.allocated_discount,
        it.item_net,
        it.id
      );
    }

    const finalAggregate: TransactionAggregate = {
      header: {
        ...header,
        settlement_status: 'SETTLED',
        hold_amount_cny: '0.00',
        fx_cashback_rate: resolvedCashbackRate,
        total_gross: fxResult.total_gross,
        payment_discount: fxResult.payment_discount,
        total_net: fxResult.total_net,
        exchange_rate: fxResult.exchange_rate,
        settled_at: finalSettledAt,
        updated_hlc: hlc,
      },
      items: updatedItems,
      appliedVoucherId: header.applied_voucher_id,
    };

    this.recordOpLog({
      hlc,
      node_id: this.nodeId,
      entity_type: 'TRANSACTION',
      entity_id: txId,
      op_type: 'UPSERT',
      payload_json: JSON.stringify(finalAggregate),
      created_at: new Date().toISOString(),
    });

    recalculateAllAccounts(this.db);

    return finalAggregate;
  }

  /**
   * 购买有偿立减金或领取代金券入库
   */
  public buyVoucher(params: {
    accountId?: string;
    title?: string;
    voucherType?: VoucherType;
    faceValue: string;
    acquireCost: string;
    minSpend?: string;
    txDate?: string;
  }): { voucher: Voucher; transaction: TransactionAggregate } {
    const voucherType = params.voucherType ?? 'PREPAID_COUPON';
    const faceValue = formatCny(params.faceValue);
    const acquireCost = formatCny(params.acquireCost);
    const minSpend = params.minSpend ? formatCny(params.minSpend) : '0.00';
    const finalTitle =
      params.title?.trim() ||
      generateVoucherTitle(voucherType, faceValue, minSpend, acquireCost);
    const discount = formatCny(toDecimal(faceValue).minus(toDecimal(acquireCost)));
    const txDate = params.txDate ?? new Date().toISOString().slice(0, 10);
    const accountId = params.accountId || 'ACC_UNION_MAIN';

    // 生成 VOUCHER_BUY 流水
    const tx = this.recordTransaction({
      header: {
        tx_date: txDate,
        tx_type: 'VOUCHER_BUY',
        account_id: accountId,
        target_account_id: null,
        total_gross: acquireCost,
        platform_discount: '0.00',
        payment_discount: '0.00',
        total_net: acquireCost,
        allocation_mode: 'SINGLE',
        original_currency: 'CNY',
        original_amount: null,
        exchange_rate: '1.000000',
        settlement_status: 'SETTLED',
        hold_amount_cny: '0.00',
        settled_at: null,
        raw_input_text: `购买卡券: ${finalTitle}`,
        merchant_or_note: `购买卡券: ${finalTitle}`,
      },
      items: [],
    });

    const info = this.db
      .prepare(
        `
      INSERT INTO vouchers (title, voucher_type, face_value, acquire_cost, min_spend, status, purchase_tx_id)
      VALUES (?, ?, ?, ?, ?, 'AVAILABLE', ?)
    `
      )
      .run(
        finalTitle,
        voucherType,
        faceValue,
        acquireCost,
        minSpend,
        tx.header.id
      );

    const voucher = this.db
      .prepare('SELECT * FROM vouchers WHERE id = ?')
      .get(info.lastInsertRowid) as any;

    const formattedVoucher: Voucher = {
      ...voucher,
      id: Number(voucher.id),
      face_value: formatCny(voucher.face_value),
      acquire_cost: formatCny(voucher.acquire_cost),
      min_spend: formatCny(voucher.min_spend),
    };

    const voucherHlc = this.hlc.now();
    this.recordOpLog({
      hlc: voucherHlc,
      node_id: this.nodeId,
      entity_type: 'VOUCHER',
      entity_id: String(formattedVoucher.id),
      op_type: 'UPSERT',
      payload_json: JSON.stringify(formattedVoucher),
      created_at: new Date().toISOString(),
    });

    return {
      voucher: formattedVoucher,
      transaction: tx,
    };
  }

  /**
   * 月底手动更新指数基金市值并返回最新盈亏看板
   */
  public updateInvestmentMarketValue(
    accountId: string,
    marketValue: string
  ): AccountDashboardRow {
    const formatted = formatCny(marketValue);
    const hlc = this.hlc.now();

    this.db
      .prepare(
        'UPDATE accounts SET market_value = ?, updated_hlc = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      )
      .run(formatted, hlc, accountId);

    this.recordOpLog({
      hlc,
      node_id: this.nodeId,
      entity_type: 'ACCOUNT',
      entity_id: accountId,
      op_type: 'UPSERT',
      payload_json: JSON.stringify({ id: accountId, market_value: formatted }),
      created_at: new Date().toISOString(),
    });

    const rows = this.getAccountDashboard();
    const target = rows.find((a) => a.id === accountId);
    if (!target) {
      throw new Error(`Account "${accountId}" not found`);
    }
    return target;
  }

  /**
   * PRD 2.3「清零并归集至专项基金 (SWEEP_TO_FUND)」
   */
  public sweepDailyPoolToSinkingFund(yearMonth: string): {
    sweptAmount: string;
    dailyPoolRemaining: string;
    fundPoolTotal: string;
  } {
    const status = this.getMonthlyBudgetStatus(yearMonth);
    const dailyPool = status.pools.find(
      (p) => p.pool_id === 'POOL_DAILY' || p.pool_type === 'DAILY'
    );
    const remaining = toDecimal(dailyPool?.remaining_budget ?? 0);

    let sweptAmount = '0.00';
    if (remaining.greaterThan(0)) {
      sweptAmount = formatCny(remaining);

      // 更新高频生活池的 swept_to_fund
      const dailyMb = this.db
        .prepare(
          "SELECT swept_to_fund FROM monthly_budgets WHERE year_month = ? AND pool_id = 'POOL_DAILY'"
        )
        .get(yearMonth) as any;
      const newSwept = formatCny(
        toDecimal(dailyMb?.swept_to_fund ?? 0).plus(toDecimal(sweptAmount))
      );
      this.db
        .prepare(
          "UPDATE monthly_budgets SET swept_to_fund = ? WHERE year_month = ? AND pool_id = 'POOL_DAILY'"
        )
        .run(newSwept, yearMonth);

      // 划入年度专项基金池 POOL_FUND 的 base_allocation
      const fundRow = this.db
        .prepare(
          "SELECT base_allocation FROM monthly_budgets WHERE year_month = ? AND pool_id = 'POOL_FUND'"
        )
        .get(yearMonth) as any;

      if (fundRow) {
        const newBase = formatCny(
          toDecimal(fundRow.base_allocation ?? 0).plus(toDecimal(sweptAmount))
        );
        this.db
          .prepare(
            "UPDATE monthly_budgets SET base_allocation = ? WHERE year_month = ? AND pool_id = 'POOL_FUND'"
          )
          .run(newBase, yearMonth);
      } else {
        this.db
          .prepare(
            "INSERT INTO monthly_budgets (year_month, pool_id, base_allocation, rollover_from_prev) VALUES (?, 'POOL_FUND', ?, '0.00')"
          )
          .run(yearMonth, sweptAmount);
      }
    }

    const updatedStatus = this.getMonthlyBudgetStatus(yearMonth);
    const updatedFund = updatedStatus.pools.find(
      (p) => p.pool_id === 'POOL_FUND'
    );

    return {
      sweptAmount,
      dailyPoolRemaining: '0.00',
      fundPoolTotal: updatedFund?.total_available_budget ?? '0.00',
    };
  }

  /**
   * PRD 2.3 月末结余滚存执行引擎
   */
  public executeMonthRollover(
    fromYearMonth: string,
    toYearMonth: string
  ): MonthlyBudgetStatusRow[] {
    const fromStatus = this.getMonthlyBudgetStatus(fromYearMonth);
    const pools = this.db
      .prepare('SELECT * FROM budget_pools ORDER BY sort_order ASC')
      .all() as unknown as BudgetPool[];

    // 检查是否存在高频池正结余可归集至专项基金
    let sweptFromDaily = new Decimal(0);
    const dailyRow = fromStatus.pools.find((p) => p.pool_id === 'POOL_DAILY');
    if (dailyRow) {
      const rem = toDecimal(dailyRow.remaining_budget);
      if (rem.greaterThan(0)) {
        sweptFromDaily = rem;
      }
    }

    for (const pool of pools) {
      let rollover = '0.00';
      const fromRow = fromStatus.pools.find((p) => p.pool_id === pool.id);

      if (pool.rollover_strategy === 'RESET') {
        rollover = '0.00';
      } else if (pool.rollover_strategy === 'SWEEP_TO_FUND') {
        rollover = '0.00';
      } else if (pool.rollover_strategy === 'ACCUMULATE') {
        let rem = toDecimal(fromRow?.remaining_budget ?? 0);
        if (pool.id === 'POOL_FUND') {
          rem = rem.plus(sweptFromDaily);
        }
        rollover = formatCny(rem);
      }

      const existingTo = this.db
        .prepare(
          'SELECT * FROM monthly_budgets WHERE year_month = ? AND pool_id = ?'
        )
        .get(toYearMonth, pool.id) as any;

      if (existingTo) {
        this.db
          .prepare(
            'UPDATE monthly_budgets SET rollover_from_prev = ? WHERE year_month = ? AND pool_id = ?'
          )
          .run(rollover, toYearMonth, pool.id);
      } else {
        const baseAlloc = fromRow?.base_allocation ?? '0.00';
        this.db
          .prepare(
            'INSERT INTO monthly_budgets (year_month, pool_id, base_allocation, rollover_from_prev) VALUES (?, ?, ?, ?)'
          )
          .run(toYearMonth, pool.id, baseAlloc, rollover);
      }
    }

    return this.getMonthlyBudgetStatus(toYearMonth).pools;
  }

  /**
   * PRD 2.2 大件固定资产日均持有成本追踪计算
   */
  public getFixedAssetsWithCost(currentDateStr?: string): FixedAssetWithCost[] {
    const assets = this.db
      .prepare('SELECT * FROM fixed_assets ORDER BY id ASC')
      .all() as any[];

    const todayStr = currentDateStr ?? new Date().toISOString().slice(0, 10);
    const todayMs = new Date(todayStr).getTime();

    return assets.map((asset) => {
      const purchaseMs = new Date(asset.purchase_date).getTime();
      const diffMs = todayMs - purchaseMs;
      const daysHeld = Math.max(1, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

      const netCost = toDecimal(asset.purchase_net_cost).minus(
        toDecimal(asset.resale_recovery ?? 0)
      );
      const currentDailyCost = formatCny(netCost.dividedBy(daysHeld));

      let progressPercent = 0;
      if (
        asset.target_daily_cost != null &&
        Number(asset.target_daily_cost) > 0
      ) {
        const targetCostDec = toDecimal(asset.target_daily_cost);
        const targetDays = netCost.dividedBy(targetCostDec).toNumber();
        if (targetDays > 0) {
          progressPercent = Math.min(
            100,
            Math.max(0, Math.round((daysHeld / targetDays) * 100))
          );
        }
      }

      return {
        id: Number(asset.id),
        asset_name: String(asset.asset_name),
        purchase_item_id: asset.purchase_item_id
          ? Number(asset.purchase_item_id)
          : null,
        purchase_date: String(asset.purchase_date),
        purchase_net_cost: formatCny(asset.purchase_net_cost),
        target_daily_cost: asset.target_daily_cost
          ? formatCny(asset.target_daily_cost)
          : null,
        status: asset.status,
        resale_date: asset.resale_date ? String(asset.resale_date) : null,
        resale_recovery: formatCny(asset.resale_recovery ?? 0),
        note: asset.note ? String(asset.note) : null,
        daysHeld,
        currentDailyCost,
        progressPercent,
      };
    });
  }

  /**
   * 应用远端同步变更日志并进行因果合并与冲突解决
   */
  public applyRemoteOpLogs(incomingOps: SyncOpLogEntry[]): {
    appliedCount: number;
    conflicts: SyncConflict[];
  } {
    if (incomingOps.length === 0) {
      return { appliedCount: 0, conflicts: [] };
    }

    const existingOps = this.getOpLogs();
    const { mergedOps, winningEntities, detectedConflicts } =
      mergeOpLogEntries(existingOps, incomingOps);

    // 1. 批量保存所有新操作入 sync_oplog
    const insertOpStmt = this.db.prepare(`
      INSERT OR IGNORE INTO sync_oplog (hlc, node_id, entity_type, entity_id, op_type, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const op of incomingOps) {
      insertOpStmt.run(
        op.hlc,
        op.node_id,
        op.entity_type,
        op.entity_id,
        op.op_type,
        op.payload_json,
        op.created_at
      );
    }

    // 2. 记录检测到的冲突
    const insertConflictStmt = this.db.prepare(`
      INSERT OR IGNORE INTO sync_conflicts (
        id, conflict_type, entity_id, winner_hlc, loser_hlc,
        winner_summary, loser_summary, loser_payload_json, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const c of detectedConflicts) {
      insertConflictStmt.run(
        c.id,
        c.conflict_type,
        c.entity_id,
        c.winner_hlc,
        c.loser_hlc,
        c.winner_summary,
        c.loser_summary,
        c.loser_payload_json,
        c.status,
        c.created_at
      );
    }

    // 3. 将胜出实体的最新状态重放至业务表
    // 按实体依赖顺序排序：
    // BUDGET_POOL (1) -> CATEGORY (2) -> PROJECT_TAG (3) -> ACCOUNT (4) -> VOUCHER (5) -> MONTHLY_BUDGET/BUDGET (6) -> RECURRING_RULE (7) -> FIXED_ASSET (8) -> TRANSACTION (9)
    const entityOrder: Record<string, number> = {
      BUDGET_POOL: 1,
      CATEGORY: 2,
      PROJECT_TAG: 3,
      ACCOUNT: 4,
      VOUCHER: 5,
      MONTHLY_BUDGET: 6,
      BUDGET: 6,
      RECURRING_RULE: 7,
      FIXED_ASSET: 8,
      TRANSACTION: 9,
    };
    const sortedWinningOps = Array.from(winningEntities.values()).sort(
      (a, b) => (entityOrder[a.entity_type] ?? 99) - (entityOrder[b.entity_type] ?? 99)
    );

    this.db.exec('PRAGMA foreign_keys = OFF;');
    try {
      for (const winningOp of sortedWinningOps) {
        let payload: any = {};
        try {
          payload = JSON.parse(winningOp.payload_json);
        } catch {
          payload = {};
        }

        if (winningOp.entity_type === 'BUDGET_POOL') {
          if (winningOp.op_type === 'DELETE') {
            this.db.prepare('DELETE FROM monthly_budgets WHERE pool_id = ?').run(winningOp.entity_id);
            this.db.prepare('DELETE FROM budget_pools WHERE id = ?').run(winningOp.entity_id);
          } else {
            this.db.prepare(`
              INSERT OR REPLACE INTO budget_pools (
                id, name, pool_type, is_monthly_budget, rollover_strategy, description, sort_order
              ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
              payload.id || winningOp.entity_id,
              payload.name,
              payload.pool_type,
              payload.is_monthly_budget ? 1 : 0,
              payload.rollover_strategy ?? 'ACCUMULATE',
              payload.description ?? null,
              payload.sort_order ?? 100
            );
          }
        } else if (winningOp.entity_type === 'CATEGORY') {
          if (winningOp.op_type === 'DELETE') {
            this.db.prepare('DELETE FROM categories WHERE id = ?').run(winningOp.entity_id);
          } else {
            this.db.prepare(`
              INSERT OR REPLACE INTO categories (
                id, parent_id, name, default_pool_id, icon_name, keywords, sort_order
              ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
              payload.id || winningOp.entity_id,
              payload.parent_id ?? null,
              payload.name,
              payload.default_pool_id,
              payload.icon_name ?? null,
              payload.keywords ?? null,
              payload.sort_order ?? 100
            );
          }
        } else if (winningOp.entity_type === 'PROJECT_TAG') {
          if (winningOp.op_type === 'DELETE') {
            this.db.prepare('DELETE FROM projects_and_tags WHERE id = ?').run(winningOp.entity_id);
          } else {
            this.db.prepare(`
              INSERT OR REPLACE INTO projects_and_tags (
                id, name, tag_type, target_budget, linked_pool_id, is_active
              ) VALUES (?, ?, ?, ?, ?, ?)
            `).run(
              payload.id || winningOp.entity_id,
              payload.name,
              payload.tag_type,
              payload.target_budget != null ? formatCny(payload.target_budget) : null,
              payload.linked_pool_id ?? null,
              payload.is_active ? 1 : 0
            );
          }
        } else if (winningOp.entity_type === 'ACCOUNT') {
          if (winningOp.op_type === 'DELETE') {
            this.db.prepare('DELETE FROM accounts WHERE id = ?').run(winningOp.entity_id);
          } else if (payload.name && payload.account_role) {
            this.db.prepare(`
              INSERT INTO accounts (
                id, name, account_role, currency, initial_balance, book_balance, frozen_amount,
                market_value, credit_limit, fx_hold_ratio, fx_cashback_rate, fx_monthly_cap,
                billing_day, repayment_day, is_default_pay, is_folded, include_in_networth, sort_order, updated_hlc
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                name=excluded.name,
                account_role=excluded.account_role,
                currency=excluded.currency,
                initial_balance=excluded.initial_balance,
                market_value=excluded.market_value,
                credit_limit=excluded.credit_limit,
                fx_hold_ratio=excluded.fx_hold_ratio,
                fx_cashback_rate=excluded.fx_cashback_rate,
                fx_monthly_cap=excluded.fx_monthly_cap,
                billing_day=excluded.billing_day,
                repayment_day=excluded.repayment_day,
                is_default_pay=excluded.is_default_pay,
                is_folded=excluded.is_folded,
                include_in_networth=excluded.include_in_networth,
                sort_order=excluded.sort_order,
                updated_hlc=excluded.updated_hlc,
                updated_at=CURRENT_TIMESTAMP
            `).run(
              payload.id || winningOp.entity_id,
              payload.name,
              payload.account_role,
              payload.currency ?? 'CNY',
              formatCny(payload.initial_balance ?? 0),
              formatCny(payload.book_balance ?? 0),
              formatCny(payload.frozen_amount ?? 0),
              payload.market_value ? formatCny(payload.market_value) : null,
              payload.credit_limit ? formatCny(payload.credit_limit) : null,
              payload.fx_hold_ratio ?? '1.000',
              payload.fx_cashback_rate ?? '0.0000',
              payload.fx_monthly_cap ? formatCny(payload.fx_monthly_cap) : null,
              payload.billing_day ?? null,
              payload.repayment_day ?? null,
              payload.is_default_pay ? 1 : 0,
              payload.is_folded ? 1 : 0,
              payload.include_in_networth !== false ? 1 : 0,
              payload.sort_order ?? 100,
              winningOp.hlc
            );
          } else {
            if (payload.initial_balance !== undefined) {
              this.db.prepare(
                'UPDATE accounts SET initial_balance = ?, updated_hlc = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
              ).run(formatCny(payload.initial_balance), winningOp.hlc, payload.id || winningOp.entity_id);
            }
            if (payload.market_value !== undefined) {
              this.db.prepare(
                'UPDATE accounts SET market_value = ?, updated_hlc = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
              ).run(
                payload.market_value ? formatCny(payload.market_value) : null,
                winningOp.hlc,
                payload.id || winningOp.entity_id
              );
            }
          }
        } else if (winningOp.entity_type === 'VOUCHER') {
          const vId = Number(payload.id ?? winningOp.entity_id);
          if (winningOp.op_type === 'DELETE') {
            const existingVoucher = this.db.prepare('SELECT purchase_tx_id FROM vouchers WHERE id = ?').get(vId) as any;
            if (existingVoucher?.purchase_tx_id) {
              this.db.prepare('UPDATE transaction_headers SET is_deleted = 1 WHERE id = ?').run(existingVoucher.purchase_tx_id);
            }
            this.db.prepare('UPDATE transaction_headers SET applied_voucher_id = NULL WHERE applied_voucher_id = ?').run(vId);
            this.db.prepare('DELETE FROM vouchers WHERE id = ?').run(vId);
          } else if (payload && (payload.id != null || winningOp.entity_id)) {
            this.db.prepare(`
              INSERT OR REPLACE INTO vouchers (
                id, title, voucher_type, face_value, acquire_cost, min_spend,
                status, purchase_tx_id, used_tx_id, expire_date
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              vId,
              payload.title,
              payload.voucher_type ?? 'PREPAID_COUPON',
              formatCny(payload.face_value ?? 0),
              formatCny(payload.acquire_cost ?? 0),
              formatCny(payload.min_spend ?? 0),
              payload.status ?? 'AVAILABLE',
              payload.purchase_tx_id ?? null,
              payload.used_tx_id ?? null,
              payload.expire_date ?? null
            );
          }
        } else if (winningOp.entity_type === 'MONTHLY_BUDGET' || winningOp.entity_type === 'BUDGET') {
          if (winningOp.op_type === 'DELETE') {
            this.db.prepare(
              "DELETE FROM monthly_budgets WHERE id = ? OR (year_month || ':' || pool_id) = ?"
            ).run(winningOp.entity_id, winningOp.entity_id);
          } else if (payload.year_month && payload.pool_id) {
            this.db.prepare(`
              INSERT INTO monthly_budgets (
                year_month, pool_id, base_allocation, rollover_from_prev, reserved_fixed, swept_to_fund, note
              ) VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(year_month, pool_id) DO UPDATE SET
                base_allocation=excluded.base_allocation,
                rollover_from_prev=excluded.rollover_from_prev,
                reserved_fixed=excluded.reserved_fixed,
                swept_to_fund=excluded.swept_to_fund,
                note=excluded.note
            `).run(
              payload.year_month,
              payload.pool_id,
              formatCny(payload.base_allocation ?? 0),
              formatCny(payload.rollover_from_prev ?? 0),
              formatCny(payload.reserved_fixed ?? 0),
              formatCny(payload.swept_to_fund ?? 0),
              payload.note ?? null
            );
          }
        } else if (winningOp.entity_type === 'RECURRING_RULE') {
          if (winningOp.op_type === 'DELETE') {
            this.db.prepare('DELETE FROM recurring_rules WHERE id = ?').run(winningOp.entity_id);
          } else {
            this.db.prepare(`
              INSERT OR REPLACE INTO recurring_rules (
                id, title, rule_type, cron_cycle, trigger_day, currency, amount,
                account_id, target_account_id, category_id, budget_pool_id, auto_reserve_budget, is_active
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              payload.id || Number(winningOp.entity_id),
              payload.title,
              payload.rule_type,
              payload.cron_cycle,
              payload.trigger_day,
              payload.currency ?? 'CNY',
              formatCny(payload.amount),
              payload.account_id,
              payload.target_account_id ?? null,
              payload.category_id ?? null,
              payload.budget_pool_id ?? null,
              payload.auto_reserve_budget ? 1 : 0,
              payload.is_active ? 1 : 0
            );
          }
        } else if (winningOp.entity_type === 'FIXED_ASSET') {
          if (winningOp.op_type === 'DELETE') {
            this.db.prepare('DELETE FROM fixed_assets WHERE id = ?').run(winningOp.entity_id);
          } else {
            this.db.prepare(`
              INSERT OR REPLACE INTO fixed_assets (
                id, asset_name, purchase_item_id, purchase_date, purchase_net_cost,
                target_daily_cost, status, resale_date, resale_recovery, note
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              payload.id || Number(winningOp.entity_id),
              payload.asset_name,
              payload.purchase_item_id ?? null,
              payload.purchase_date,
              formatCny(payload.purchase_net_cost),
              payload.target_daily_cost != null ? formatCny(payload.target_daily_cost) : '2.00',
              payload.status ?? 'IN_USE',
              payload.resale_date ?? null,
              formatCny(payload.resale_recovery ?? 0),
              payload.note ?? null
            );
          }
        } else if (winningOp.entity_type === 'TRANSACTION') {
          const header = payload.header ?? payload;
          const items = payload.items ?? [];

          if (winningOp.op_type === 'DELETE' || header.is_deleted) {
            this.db
              .prepare(
                'UPDATE transaction_headers SET is_deleted = 1, updated_hlc = ? WHERE id = ?'
              )
              .run(winningOp.hlc, header.id || winningOp.entity_id);

            // Also delete any voucher whose purchase_tx_id = header.id
            this.db.prepare('DELETE FROM vouchers WHERE purchase_tx_id = ?').run(header.id || winningOp.entity_id);

            // And if header.applied_voucher_id != null, restore that voucher
            const appliedVId = payload.appliedVoucherId ?? header.applied_voucher_id;
            if (appliedVId != null) {
              this.db.prepare("UPDATE vouchers SET status = 'AVAILABLE', used_tx_id = NULL WHERE id = ?").run(appliedVId);
            }
          } else {
            this.db
              .prepare(
                `
              INSERT INTO transaction_headers (
                id, tx_date, tx_timestamp, tx_type, account_id, target_account_id,
                total_gross, platform_discount, payment_discount, total_net,
                allocation_mode, original_currency, original_amount, exchange_rate,
                settlement_status, hold_amount_cny, fx_cashback_rate, settled_at, raw_input_text,
                merchant_or_note, applied_voucher_id, is_deleted, updated_hlc
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                tx_date=excluded.tx_date,
                tx_timestamp=excluded.tx_timestamp,
                tx_type=excluded.tx_type,
                account_id=excluded.account_id,
                target_account_id=excluded.target_account_id,
                total_gross=excluded.total_gross,
                platform_discount=excluded.platform_discount,
                payment_discount=excluded.payment_discount,
                total_net=excluded.total_net,
                allocation_mode=excluded.allocation_mode,
                original_currency=excluded.original_currency,
                original_amount=excluded.original_amount,
                exchange_rate=excluded.exchange_rate,
                settlement_status=excluded.settlement_status,
                hold_amount_cny=excluded.hold_amount_cny,
                fx_cashback_rate=excluded.fx_cashback_rate,
                settled_at=excluded.settled_at,
                raw_input_text=excluded.raw_input_text,
                merchant_or_note=excluded.merchant_or_note,
                applied_voucher_id=excluded.applied_voucher_id,
                is_deleted=excluded.is_deleted,
                updated_hlc=excluded.updated_hlc
            `
              )
              .run(
                header.id,
                header.tx_date,
                header.tx_timestamp,
                header.tx_type,
                header.account_id,
                header.target_account_id ?? null,
                formatCny(header.total_gross),
                formatCny(header.platform_discount ?? 0),
                formatCny(header.payment_discount ?? 0),
                formatCny(header.total_net),
                header.allocation_mode ?? 'SINGLE',
                header.original_currency ?? 'CNY',
                header.original_amount != null
                  ? formatCny(header.original_amount)
                  : null,
                header.exchange_rate
                  ? formatRate(header.exchange_rate)
                  : '1.000000',
                header.settlement_status ?? 'SETTLED',
                formatCny(header.hold_amount_cny ?? 0),
                header.fx_cashback_rate != null && header.fx_cashback_rate !== ''
                  ? Number(header.fx_cashback_rate).toFixed(4)
                  : null,
                header.settled_at ?? null,
                header.raw_input_text ?? null,
                header.merchant_or_note ?? null,
                payload.appliedVoucherId ?? header.applied_voucher_id ?? null,
                0,
                winningOp.hlc
              );

            // 覆盖更新子明细
            this.db
              .prepare('DELETE FROM transaction_items WHERE header_id = ?')
              .run(header.id);

            const insertItem = this.db.prepare(`
              INSERT INTO transaction_items (
                header_id, item_name, category_id, budget_pool_id, project_tag_id,
                item_gross, allocated_discount, item_net, is_primary_item, raw_formula_expr
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            for (const it of items) {
              insertItem.run(
                header.id,
                it.item_name,
                it.category_id,
                it.budget_pool_id,
                it.project_tag_id ?? null,
                formatCny(it.item_gross),
                formatCny(it.allocated_discount ?? 0),
                formatCny(it.item_net),
                it.is_primary_item ? 1 : 0,
                it.raw_formula_expr ?? null
              );
            }

            const vId = payload.appliedVoucherId ?? header.applied_voucher_id;
            if (vId != null) {
              this.db
                .prepare(
                  "UPDATE vouchers SET status = 'USED', used_tx_id = ? WHERE id = ?"
                )
                .run(header.id, vId);
            }
          }
        }
      }
    } finally {
      this.db.exec('PRAGMA foreign_keys = ON;');
    }

    // 推进本地混合逻辑时钟
    for (const op of incomingOps) {
      this.hlc.receive(op.hlc);
    }

    // 触发全局余额收敛重算
    recalculateAllAccounts(this.db);

    return { appliedCount: incomingOps.length, conflicts: detectedConflicts };
  }

  /**
   * 导出全部同步日志
   */
  public getOpLogs(): SyncOpLogEntry[] {
    return this.db
      .prepare('SELECT * FROM sync_oplog ORDER BY hlc ASC')
      .all() as any[];
  }

  /**
   * 导出完整备份快照包（用于全量同步与冷备恢复）
   */
  public exportFullSyncBundle(): FullSyncBundle {
    const accounts = this.db.prepare('SELECT * FROM accounts').all() as any[];
    const oplogs = this.getOpLogs();
    const vouchers = this.db.prepare('SELECT * FROM vouchers').all() as any[];
    const monthlyBudgets = this.db
      .prepare('SELECT * FROM monthly_budgets')
      .all() as any[];
    const budgetPools = this.db
      .prepare('SELECT * FROM budget_pools ORDER BY sort_order ASC')
      .all() as any[];
    const categories = this.db
      .prepare('SELECT * FROM categories ORDER BY sort_order ASC')
      .all() as any[];
    const projectTags = this.db
      .prepare('SELECT * FROM projects_and_tags ORDER BY id ASC')
      .all() as any[];
    const recurringRules = this.db
      .prepare('SELECT * FROM recurring_rules ORDER BY id ASC')
      .all() as any[];
    const fixedAssets = this.db
      .prepare('SELECT * FROM fixed_assets ORDER BY id ASC')
      .all() as any[];

    return {
      nodeId: this.nodeId,
      exportedAt: new Date().toISOString(),
      accounts,
      budgetPools,
      categories,
      projectTags,
      recurringRules,
      fixedAssets,
      oplogs,
      vouchers,
      monthlyBudgets,
    };
  }

  /**
   * 在服务端炸机/空库时从完整快照包 100% 幂等恢复
   */
  public reseedFromBundle(bundle: FullSyncBundle): void {
    this.db.exec('PRAGMA foreign_keys = OFF;');
    try {
      // 1. 清空现有业务表数据并重新初始化
      this.db.exec(`
        DELETE FROM transaction_items;
        DELETE FROM transaction_headers;
        DELETE FROM sync_oplog;
        DELETE FROM sync_conflicts;
        DELETE FROM vouchers;
        DELETE FROM monthly_budgets;
        DELETE FROM fixed_assets;
        DELETE FROM recurring_rules;
        DELETE FROM projects_and_tags;
        DELETE FROM categories;
        DELETE FROM budget_pools;
        DELETE FROM accounts;
      `);
      this.db.exec(SCHEMA_SQL);
      this.db.exec(SEED_SQL);

      // 2. 还原预算池
      if (bundle.budgetPools && bundle.budgetPools.length > 0) {
        const stmt = this.db.prepare(`
          INSERT OR REPLACE INTO budget_pools (id, name, pool_type, is_monthly_budget, rollover_strategy, description, sort_order)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const p of bundle.budgetPools) {
          stmt.run(
            p.id,
            p.name,
            p.pool_type,
            p.is_monthly_budget ? 1 : 0,
            p.rollover_strategy ?? 'ACCUMULATE',
            p.description ?? null,
            p.sort_order ?? 100
          );
        }
      }

      // 3. 还原分类
      if (bundle.categories && bundle.categories.length > 0) {
        const stmt = this.db.prepare(`
          INSERT OR REPLACE INTO categories (id, parent_id, name, default_pool_id, icon_name, keywords, sort_order)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const c of bundle.categories) {
          stmt.run(
            c.id,
            c.parent_id ?? null,
            c.name,
            c.default_pool_id,
            c.icon_name ?? null,
            c.keywords ?? null,
            c.sort_order ?? 100
          );
        }
      }

      // 4. 还原项目与标签
      if (bundle.projectTags && bundle.projectTags.length > 0) {
        const stmt = this.db.prepare(`
          INSERT OR REPLACE INTO projects_and_tags (id, name, tag_type, target_budget, linked_pool_id, is_active)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        for (const t of bundle.projectTags) {
          stmt.run(
            t.id,
            t.name,
            t.tag_type,
            t.target_budget != null ? formatCny(t.target_budget) : null,
            t.linked_pool_id ?? null,
            t.is_active ? 1 : 0
          );
        }
      }

      // 5. 还原账户（支持自定义账户 ACC_CUSTOM_... 插入）
      if (bundle.accounts && bundle.accounts.length > 0) {
        const stmt = this.db.prepare(`
          INSERT OR REPLACE INTO accounts (
            id, name, account_role, currency, initial_balance, book_balance, frozen_amount,
            market_value, credit_limit, fx_hold_ratio, fx_cashback_rate, fx_monthly_cap,
            billing_day, repayment_day, is_default_pay, is_folded, include_in_networth, sort_order, updated_hlc
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const acc of bundle.accounts) {
          stmt.run(
            acc.id,
            acc.name,
            acc.account_role,
            acc.currency ?? 'CNY',
            formatCny(acc.initial_balance ?? 0),
            formatCny(acc.book_balance ?? 0),
            formatCny(acc.frozen_amount ?? 0),
            acc.market_value ? formatCny(acc.market_value) : null,
            acc.credit_limit ? formatCny(acc.credit_limit) : null,
            acc.fx_hold_ratio ?? '1.000',
            acc.fx_cashback_rate ?? '0.0000',
            acc.fx_monthly_cap ? formatCny(acc.fx_monthly_cap) : null,
            acc.billing_day ?? null,
            acc.repayment_day ?? null,
            acc.is_default_pay ? 1 : 0,
            acc.is_folded ? 1 : 0,
            acc.include_in_networth !== false ? 1 : 0,
            acc.sort_order ?? 100,
            acc.updated_hlc ?? null
          );
        }
      }

      // 6. 还原月度预算
      if (bundle.monthlyBudgets && bundle.monthlyBudgets.length > 0) {
        const stmt = this.db.prepare(`
          INSERT INTO monthly_budgets (
            year_month, pool_id, base_allocation, rollover_from_prev, reserved_fixed, swept_to_fund, note
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(year_month, pool_id) DO UPDATE SET
            base_allocation=excluded.base_allocation,
            rollover_from_prev=excluded.rollover_from_prev,
            reserved_fixed=excluded.reserved_fixed,
            swept_to_fund=excluded.swept_to_fund,
            note=excluded.note
        `);
        for (const b of bundle.monthlyBudgets) {
          stmt.run(
            b.year_month,
            b.pool_id,
            formatCny(b.base_allocation ?? 0),
            formatCny(b.rollover_from_prev ?? 0),
            formatCny(b.reserved_fixed ?? 0),
            formatCny(b.swept_to_fund ?? 0),
            b.note ?? null
          );
        }
      }

      // 7. 还原卡券
      if (bundle.vouchers && bundle.vouchers.length > 0) {
        const insertVoucher = this.db.prepare(`
          INSERT OR REPLACE INTO vouchers (
            id, title, voucher_type, face_value, acquire_cost, min_spend, status, purchase_tx_id, used_tx_id, expire_date
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const v of bundle.vouchers) {
          insertVoucher.run(
            v.id,
            v.title,
            v.voucher_type ?? 'PREPAID_COUPON',
            formatCny(v.face_value),
            formatCny(v.acquire_cost),
            formatCny(v.min_spend),
            v.status ?? 'AVAILABLE',
            v.purchase_tx_id ?? null,
            v.used_tx_id ?? null,
            v.expire_date ?? null
          );
        }
      }

      // 8. 还原周期性规则
      if (bundle.recurringRules && bundle.recurringRules.length > 0) {
        const stmt = this.db.prepare(`
          INSERT OR REPLACE INTO recurring_rules (
            id, title, rule_type, cron_cycle, trigger_day, currency, amount,
            account_id, target_account_id, category_id, budget_pool_id, auto_reserve_budget, is_active
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const r of bundle.recurringRules) {
          stmt.run(
            r.id,
            r.title,
            r.rule_type,
            r.cron_cycle,
            r.trigger_day,
            r.currency ?? 'CNY',
            formatCny(r.amount),
            r.account_id,
            r.target_account_id ?? null,
            r.category_id ?? null,
            r.budget_pool_id ?? null,
            r.auto_reserve_budget ? 1 : 0,
            r.is_active ? 1 : 0
          );
        }
      }

      // 9. 重放全部操作变更日志
      this.applyRemoteOpLogs(bundle.oplogs);

      // 10. 最终确定性重算全局账户
      recalculateAllAccounts(this.db);
    } finally {
      this.db.exec('PRAGMA foreign_keys = ON;');
    }
  }

  /**
   * 内部辅助：写入同步操作日志表
   */
  private recordOpLog(entry: SyncOpLogEntry): void {
    this.db
      .prepare(
        `
      INSERT OR REPLACE INTO sync_oplog (
        hlc, node_id, entity_type, entity_id, op_type, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        entry.hlc,
        entry.node_id,
        entry.entity_type,
        entry.entity_id,
        entry.op_type,
        entry.payload_json,
        entry.created_at
      );
  }

  /**
   * 查询最近交易聚合列表（含子项明细）
   */
  public getRecentTransactions(limit = 50): TransactionAggregate[] {
    const headers = this.db
      .prepare(
        'SELECT * FROM transaction_headers WHERE is_deleted = 0 ORDER BY tx_date DESC, tx_timestamp DESC, id DESC LIMIT ?'
      )
      .all(limit) as any[];

    const itemStmt = this.db.prepare(
      'SELECT * FROM transaction_items WHERE header_id = ? ORDER BY id ASC'
    );

    return headers.map((h) => {
      const rawItems = itemStmt.all(h.id) as any[];
      return {
        header: {
          ...h,
          total_gross: formatCny(h.total_gross),
          platform_discount: formatCny(h.platform_discount),
          payment_discount: formatCny(h.payment_discount),
          total_net: formatCny(h.total_net),
          hold_amount_cny: formatCny(h.hold_amount_cny ?? 0),
          fx_cashback_rate:
            h.fx_cashback_rate != null && h.fx_cashback_rate !== ''
              ? Number(h.fx_cashback_rate).toFixed(4)
              : null,
          exchange_rate: h.exchange_rate ? formatRate(h.exchange_rate) : '1.000000',
          is_deleted: Boolean(h.is_deleted),
        },
        items: rawItems.map((it) => ({
          ...it,
          item_gross: formatCny(it.item_gross),
          allocated_discount: formatCny(it.allocated_discount),
          item_net: formatCny(it.item_net),
          is_primary_item: Boolean(it.is_primary_item),
        })),
        appliedVoucherId: h.applied_voucher_id ?? null,
      };
    });
  }

  /**
   * 查询所有待清算万事达外币预授权交易 (PENDING_HOLD)
   */
  public getPendingFxTransactions(): TransactionAggregate[] {
    return this.getRecentTransactions(200).filter(
      (tx) => tx.header.settlement_status === 'PENDING_HOLD'
    );
  }

  /**
   * 查询卡包中的所有优惠券与立减金
   */
  public getVouchers(): Voucher[] {
    const rows = this.db
      .prepare('SELECT * FROM vouchers ORDER BY id DESC')
      .all() as any[];
    return rows.map((v) => ({
      ...v,
      face_value: formatCny(v.face_value),
      acquire_cost: formatCny(v.acquire_cost),
      min_spend: formatCny(v.min_spend),
    }));
  }

  /**
   * 查询所有分类、专项项目标签与周期性规则
   */
  public getMetadata(): {
    categories: Category[];
    projectTags: ProjectTag[];
    recurringRules: RecurringRule[];
  } {
    const categories = this.db
      .prepare('SELECT * FROM categories ORDER BY sort_order ASC')
      .all() as unknown as Category[];
    const projectTags = (
      this.db
        .prepare('SELECT * FROM projects_and_tags ORDER BY id ASC')
        .all() as any[]
    ).map((t) => ({
      ...t,
      target_budget: t.target_budget != null ? formatCny(t.target_budget) : null,
      is_active: Boolean(t.is_active),
    }));
    const recurringRules = (
      this.db
        .prepare('SELECT * FROM recurring_rules ORDER BY id ASC')
        .all() as any[]
    ).map((r) => ({
      ...r,
      amount: formatCny(r.amount),
      auto_reserve_budget: Boolean(r.auto_reserve_budget),
      is_active: Boolean(r.is_active),
    }));
    return { categories, projectTags, recurringRules };
  }

  /**
   * 查询同步冲突列表
   */
  public getConflicts(): SyncConflict[] {
    return this.db
      .prepare('SELECT * FROM sync_conflicts ORDER BY created_at DESC')
      .all() as unknown as SyncConflict[];
  }

  /**
   * 解决同步冲突（保留胜出版本或采纳落败版本）
   */
  public resolveConflict(
    conflictId: string,
    resolution: 'KEEP_WINNER' | 'USE_LOSER'
  ): SyncConflict | null {
    const conflict = this.db
      .prepare('SELECT * FROM sync_conflicts WHERE id = ?')
      .get(conflictId) as unknown as SyncConflict | undefined;
    if (!conflict) return null;

    if (resolution === 'USE_LOSER') {
      try {
        const loserPayload = JSON.parse(conflict.loser_payload_json);
        if (loserPayload?.header) {
          const newHlc = this.hlc.now();
          this.applyRemoteOpLogs([
            {
              hlc: newHlc,
              node_id: this.nodeId,
              entity_type: 'TRANSACTION',
              entity_id: loserPayload.header.id,
              op_type: 'UPSERT',
              payload_json: JSON.stringify(loserPayload),
              created_at: new Date().toISOString(),
            },
          ]);
        }
      } catch {}
    }

    this.db
      .prepare("UPDATE sync_conflicts SET status = 'RESOLVED' WHERE id = ?")
      .run(conflictId);

    return {
      ...conflict,
      status: 'RESOLVED',
    };
  }

  // ==========================================================================
  // Stage 8: 全生命周期 CRUD 管理方法 (Repository 层)
  // ==========================================================================

  public recordManualTransaction(params: {
    tx_type: 'EXPENSE' | 'INCOME' | 'TRANSFER';
    tx_date?: string;
    account_id?: string;
    target_account_id?: string | null;
    amount: string;
    discount?: string;
    category_id?: string;
    budget_pool_id?: string;
    project_tag_id?: string | null;
    merchant_or_note: string;
    applied_voucher_id?: number | null;
    currency?: string;
    hold_amount_cny?: string;
    fx_hold_ratio?: string;
    fx_cashback_rate?: string;
  }): TransactionAggregate {
    const effectiveAccountId = params.account_id || 'ACC_UNION_MAIN';
    let account = this.db
      .prepare('SELECT * FROM accounts WHERE id = ?')
      .get(effectiveAccountId) as any;
    if (!account) {
      account = this.db.prepare('SELECT * FROM accounts LIMIT 1').get() as any;
    }

    const effectiveDate = params.tx_date ?? new Date().toISOString().slice(0, 10);
    const currency = params.currency ?? 'CNY';
    const isFx = currency !== 'CNY';

    let totalGross = formatCny(params.amount);
    let paymentDiscount = formatCny(params.discount ?? '0.00');
    let platformDiscount = '0.00';
    let totalNet = formatCny(
      Decimal.max(0, toDecimal(totalGross).minus(toDecimal(paymentDiscount)))
    );
    let items: Array<{
      item_name: string;
      category_id: string;
      budget_pool_id: string;
      project_tag_id: string | null;
      item_gross: string;
      allocated_discount: string;
      item_net: string;
      is_primary_item: boolean;
      raw_formula_expr?: string | null;
    }> = [];
    let settlementStatus: 'PENDING_HOLD' | 'SETTLED' = isFx ? 'PENDING_HOLD' : 'SETTLED';
    let holdAmountCny = '0.00';
    let fxCashbackRateToStore: string | null = null;

    let appliedVoucher: Voucher | null = null;
    if (params.applied_voucher_id != null) {
      const v = this.db
        .prepare('SELECT * FROM vouchers WHERE id = ?')
        .get(params.applied_voucher_id) as Voucher | undefined;
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
              toDecimal(DEFAULT_FX_RATES[currency] ?? '7.200000')
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
      const catId = params.category_id ?? 'CAT_FOOD';
      const cat = this.db
        .prepare('SELECT * FROM categories WHERE id = ?')
        .get(catId) as any;
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
        const refRate = DEFAULT_FX_RATES[currency] ?? '7.200000';
        const holdRatio =
          params.fx_hold_ratio !== undefined && params.fx_hold_ratio !== ''
            ? params.fx_hold_ratio
            : account?.fx_hold_ratio || '1.020';
        const cashbackRate =
          params.fx_cashback_rate !== undefined && params.fx_cashback_rate !== ''
            ? params.fx_cashback_rate
            : account?.fx_cashback_rate ?? '0.0100';
        fxCashbackRateToStore = Number(cashbackRate).toFixed(4);
        holdAmountCny =
          params.hold_amount_cny && Number(params.hold_amount_cny) > 0
            ? formatCny(params.hold_amount_cny)
            : formatCny(
                roundCny(
                  toDecimal(params.amount)
                    .times(toDecimal(refRate))
                    .times(toDecimal(holdRatio))
                )
              );
        const fxRes = processMastercardFxLifecycle({
          foreignAmount: params.amount,
          holdAmountCny,
          holdRatio,
          cashbackRate,
        });
        totalGross = fxRes.total_gross;
        paymentDiscount = fxRes.payment_discount;
        totalNet = fxRes.total_net;
        if (items.length > 0) {
          items[0].item_gross = fxRes.total_gross;
          items[0].allocated_discount = fxRes.payment_discount;
          items[0].item_net = fxRes.total_net;
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

    return this.recordTransaction({
      header: {
        tx_date: effectiveDate,
        tx_type: params.tx_type,
        account_id: effectiveAccountId,
        target_account_id: params.target_account_id ?? null,
        total_gross: totalGross,
        platform_discount: platformDiscount,
        payment_discount: paymentDiscount,
        total_net: totalNet,
        allocation_mode: 'SINGLE',
        original_currency: currency,
        original_amount: isFx ? formatCny(params.amount) : null,
        exchange_rate: isFx ? null : '1.000000',
        settlement_status: settlementStatus,
        hold_amount_cny: holdAmountCny,
        fx_cashback_rate: fxCashbackRateToStore,
        settled_at: settlementStatus === 'SETTLED' ? new Date().toISOString() : null,
        raw_input_text: `手动录入：${params.merchant_or_note} ${params.amount}`,
        merchant_or_note: params.merchant_or_note,
        applied_voucher_id: params.applied_voucher_id ?? null,
      },
      items: items.map((it) => ({
        id: 0,
        header_id: '',
        ...it,
        raw_formula_expr: it.raw_formula_expr ?? null,
      })),
      appliedVoucherId: params.applied_voucher_id ?? null,
    });
  }

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
    const existing = this.getRecentTransactions(1000).find((t) => t.header.id === txId);
    if (!existing) {
      throw new Error(`Transaction "${txId}" not found`);
    }

    const h = existing.header;
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

    const hlc = this.hlc.now();
    h.updated_hlc = hlc;

    this.db
      .prepare(`
        UPDATE transaction_headers SET
          tx_date = ?, account_id = ?, target_account_id = ?, total_gross = ?,
          payment_discount = ?, total_net = ?, merchant_or_note = ?, updated_hlc = ?
        WHERE id = ?
      `)
      .run(
        h.tx_date,
        h.account_id,
        h.target_account_id ?? null,
        h.total_gross,
        h.payment_discount,
        h.total_net,
        h.merchant_or_note,
        hlc,
        txId
      );

    if (existing.items.length > 0) {
      const primary = existing.items.find((it) => it.is_primary_item) ?? existing.items[0];
      if (patch.merchant_or_note !== undefined) primary.item_name = patch.merchant_or_note;
      if (patch.total_gross !== undefined) primary.item_gross = h.total_gross;
      if (patch.payment_discount !== undefined) primary.allocated_discount = h.payment_discount;
      primary.item_net = h.total_net;
      if (patch.category_id !== undefined) primary.category_id = patch.category_id;
      if (patch.budget_pool_id !== undefined) primary.budget_pool_id = patch.budget_pool_id;
      if (patch.project_tag_id !== undefined) primary.project_tag_id = patch.project_tag_id;

      this.db
        .prepare(`
          UPDATE transaction_items SET
            item_name = ?, item_gross = ?, allocated_discount = ?, item_net = ?,
            category_id = ?, budget_pool_id = ?, project_tag_id = ?
          WHERE id = ?
        `)
        .run(
          primary.item_name,
          primary.item_gross,
          primary.allocated_discount,
          primary.item_net,
          primary.category_id,
          primary.budget_pool_id,
          primary.project_tag_id ?? null,
          primary.id
        );
    }

    this.recordOpLog({
      hlc,
      node_id: this.nodeId,
      entity_type: 'TRANSACTION',
      entity_id: txId,
      op_type: 'UPSERT',
      payload_json: JSON.stringify(existing),
      created_at: new Date().toISOString(),
    });

    recalculateAllAccounts(this.db);
    return existing;
  }

  public deleteTransaction(txId: string): TransactionAggregate {
    const existing = this.getRecentTransactions(1000).find((t) => t.header.id === txId);
    if (!existing) {
      throw new Error(`Transaction "${txId}" not found`);
    }

    const hlc = this.hlc.now();
    existing.header.is_deleted = true;
    existing.header.updated_hlc = hlc;

    this.db
      .prepare('UPDATE transaction_headers SET is_deleted = 1, updated_hlc = ? WHERE id = ?')
      .run(hlc, txId);

    if (existing.header.applied_voucher_id != null) {
      this.db
        .prepare("UPDATE vouchers SET status = 'AVAILABLE', used_tx_id = NULL WHERE id = ?")
        .run(existing.header.applied_voucher_id);
    }

    // 若删除的是购券流水，级联删除所购买的卡券
    const purchasedVouchers = this.db
      .prepare('SELECT id FROM vouchers WHERE purchase_tx_id = ?')
      .all(txId) as Array<{ id: number }>;
    for (const pv of purchasedVouchers) {
      this.db
        .prepare('UPDATE transaction_headers SET applied_voucher_id = NULL WHERE applied_voucher_id = ?')
        .run(pv.id);
      this.db.prepare('DELETE FROM vouchers WHERE id = ?').run(pv.id);
      this.recordOpLog({
        hlc: this.hlc.now(),
        node_id: this.nodeId,
        entity_type: 'VOUCHER',
        entity_id: String(pv.id),
        op_type: 'DELETE',
        payload_json: JSON.stringify({ id: pv.id }),
        created_at: new Date().toISOString(),
      });
    }

    this.recordOpLog({
      hlc,
      node_id: this.nodeId,
      entity_type: 'TRANSACTION',
      entity_id: txId,
      op_type: 'UPSERT',
      payload_json: JSON.stringify(existing),
      created_at: new Date().toISOString(),
    });

    recalculateAllAccounts(this.db);
    return existing;
  }

  public upsertAccount(
    account: Partial<Account> & { name: string; account_role: AccountRole }
  ): Account {
    const id = account.id || `ACC_CUSTOM_${Date.now()}`;
    const hlc = this.hlc.now();
    const existing = this.db
      .prepare('SELECT * FROM accounts WHERE id = ?')
      .get(id) as any;

    if (existing) {
      this.db
        .prepare(`
          UPDATE accounts SET
            name = ?, account_role = ?, currency = ?, credit_limit = ?,
            billing_day = ?, repayment_day = ?, fx_hold_ratio = ?, fx_cashback_rate = ?,
            fx_monthly_cap = ?, is_default_pay = ?, is_folded = ?, include_in_networth = ?,
            initial_balance = ?, market_value = ?, sort_order = ?, updated_hlc = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `)
        .run(
          account.name,
          account.account_role,
          account.currency ?? existing.currency,
          account.credit_limit ? formatCny(account.credit_limit) : existing.credit_limit,
          account.billing_day !== undefined ? account.billing_day : existing.billing_day,
          account.repayment_day !== undefined ? account.repayment_day : existing.repayment_day,
          account.fx_hold_ratio ?? existing.fx_hold_ratio,
          account.fx_cashback_rate ?? existing.fx_cashback_rate,
          account.fx_monthly_cap ? formatCny(account.fx_monthly_cap) : existing.fx_monthly_cap,
          account.is_default_pay !== undefined ? (account.is_default_pay ? 1 : 0) : existing.is_default_pay,
          account.is_folded !== undefined ? (account.is_folded ? 1 : 0) : existing.is_folded,
          account.include_in_networth !== undefined ? (account.include_in_networth ? 1 : 0) : existing.include_in_networth,
          account.initial_balance !== undefined ? formatCny(account.initial_balance) : existing.initial_balance,
          account.market_value !== undefined ? (account.market_value ? formatCny(account.market_value) : null) : existing.market_value,
          account.sort_order ?? existing.sort_order,
          hlc,
          id
        );
    } else {
      const initBal = formatCny(account.initial_balance ?? '0.00');
      this.db
        .prepare(`
          INSERT INTO accounts (
            id, name, account_role, currency, initial_balance, book_balance, frozen_amount,
            market_value, credit_limit, fx_hold_ratio, fx_cashback_rate, fx_monthly_cap,
            billing_day, repayment_day, is_default_pay, is_folded, include_in_networth, sort_order, updated_hlc
          ) VALUES (?, ?, ?, ?, ?, ?, '0.00', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          id,
          account.name,
          account.account_role,
          account.currency ?? 'CNY',
          initBal,
          initBal,
          account.market_value ? formatCny(account.market_value) : (account.account_role === 'INVESTMENT' ? '0.00' : null),
          account.credit_limit ? formatCny(account.credit_limit) : null,
          account.fx_hold_ratio ?? (account.account_role === 'DEBIT_FX' ? '1.020' : '1.000'),
          account.fx_cashback_rate ?? (account.account_role === 'DEBIT_FX' ? '0.0100' : '0.0000'),
          account.fx_monthly_cap ? formatCny(account.fx_monthly_cap) : null,
          account.billing_day ?? null,
          account.repayment_day ?? null,
          account.is_default_pay ? 1 : 0,
          account.is_folded ? 1 : 0,
          account.include_in_networth !== false ? 1 : 0,
          account.sort_order ?? 100,
          hlc
        );
    }

    if (account.is_default_pay) {
      this.db
        .prepare('UPDATE accounts SET is_default_pay = 0 WHERE id != ?')
        .run(id);
    }

    const saved = this.db
      .prepare('SELECT * FROM accounts WHERE id = ?')
      .get(id) as any;

    const mappedSaved: Account = {
      ...saved,
      initial_balance: formatCny(saved.initial_balance),
      book_balance: formatCny(saved.book_balance),
      frozen_amount: formatCny(saved.frozen_amount),
      market_value: saved.market_value != null ? formatCny(saved.market_value) : null,
      credit_limit: saved.credit_limit != null ? formatCny(saved.credit_limit) : null,
      is_default_pay: Boolean(saved.is_default_pay),
      is_folded: Boolean(saved.is_folded),
      include_in_networth: Boolean(saved.include_in_networth),
    };

    this.recordOpLog({
      hlc,
      node_id: this.nodeId,
      entity_type: 'ACCOUNT',
      entity_id: id,
      op_type: 'UPSERT',
      payload_json: JSON.stringify(mappedSaved),
      created_at: new Date().toISOString(),
    });

    recalculateAllAccounts(this.db);
    return mappedSaved;
  }

  public calibrateAccountBalance(
    accountId: string,
    targetBookBalance: string
  ): Account {
    const acc = this.db
      .prepare('SELECT * FROM accounts WHERE id = ?')
      .get(accountId) as any;
    if (!acc) {
      throw new Error(`Account "${accountId}" not found`);
    }

    const delta = toDecimal(targetBookBalance).minus(toDecimal(acc.book_balance));
    const newInitial = formatCny(toDecimal(acc.initial_balance ?? 0).plus(delta));
    const hlc = this.hlc.now();

    this.db
      .prepare('UPDATE accounts SET initial_balance = ?, updated_hlc = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(newInitial, hlc, accountId);

    recalculateAllAccounts(this.db);

    const updated = this.db
      .prepare('SELECT * FROM accounts WHERE id = ?')
      .get(accountId) as any;

    const mappedUpdated: Account = {
      ...updated,
      initial_balance: formatCny(updated.initial_balance),
      book_balance: formatCny(updated.book_balance),
      frozen_amount: formatCny(updated.frozen_amount),
      market_value: updated.market_value != null ? formatCny(updated.market_value) : null,
      credit_limit: updated.credit_limit != null ? formatCny(updated.credit_limit) : null,
      is_default_pay: Boolean(updated.is_default_pay),
      is_folded: Boolean(updated.is_folded),
      include_in_networth: Boolean(updated.include_in_networth),
    };

    this.recordOpLog({
      hlc,
      node_id: this.nodeId,
      entity_type: 'ACCOUNT',
      entity_id: accountId,
      op_type: 'UPSERT',
      payload_json: JSON.stringify(mappedUpdated),
      created_at: new Date().toISOString(),
    });

    return mappedUpdated;
  }

  public deleteAccount(accountId: string): void {
    const hasActiveTx = this.db
      .prepare('SELECT COUNT(*) as count FROM transaction_headers WHERE is_deleted = 0 AND (account_id = ? OR target_account_id = ?)')
      .get(accountId, accountId) as any;

    if (hasActiveTx?.count > 0) {
      throw new Error('账户存在关联交易流水，无法直接删除。请先清理或归档相关交易！');
    }

    this.db.prepare('DELETE FROM accounts WHERE id = ?').run(accountId);

    this.recordOpLog({
      hlc: this.hlc.now(),
      node_id: this.nodeId,
      entity_type: 'ACCOUNT',
      entity_id: accountId,
      op_type: 'DELETE',
      payload_json: JSON.stringify({ id: accountId }),
      created_at: new Date().toISOString(),
    });
  }

  public upsertBudgetPool(
    pool: Partial<BudgetPool> & { name: string; base_allocation?: string }
  ): BudgetPool {
    const id = pool.id || `POOL_CUSTOM_${Date.now()}`;
    const existing = this.db.prepare('SELECT * FROM budget_pools WHERE id = ?').get(id) as any;

    if (existing) {
      this.db
        .prepare(`
          UPDATE budget_pools SET
            name = ?, pool_type = ?, is_monthly_budget = ?, rollover_strategy = ?, description = ?, sort_order = ?
          WHERE id = ?
        `)
        .run(
          pool.name,
          pool.pool_type ?? existing.pool_type,
          pool.is_monthly_budget !== undefined ? (pool.is_monthly_budget ? 1 : 0) : existing.is_monthly_budget,
          pool.rollover_strategy ?? existing.rollover_strategy,
          pool.description !== undefined ? pool.description : existing.description,
          pool.sort_order ?? existing.sort_order,
          id
        );
    } else {
      this.db
        .prepare(`
          INSERT INTO budget_pools (id, name, pool_type, is_monthly_budget, rollover_strategy, description, sort_order)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          id,
          pool.name,
          pool.pool_type ?? 'FLEX',
          pool.is_monthly_budget !== false ? 1 : 0,
          pool.rollover_strategy ?? 'ACCUMULATE',
          pool.description ?? null,
          pool.sort_order ?? 100
        );
    }

    if ((pool.is_monthly_budget !== false) && pool.base_allocation !== undefined) {
      this.upsertMonthlyBudget({
        year_month: '2026-11',
        pool_id: id,
        base_allocation: pool.base_allocation,
      });
    }

    const saved = this.db.prepare('SELECT * FROM budget_pools WHERE id = ?').get(id) as any;

    this.recordOpLog({
      hlc: this.hlc.now(),
      node_id: this.nodeId,
      entity_type: 'BUDGET_POOL',
      entity_id: id,
      op_type: 'UPSERT',
      payload_json: JSON.stringify(saved),
      created_at: new Date().toISOString(),
    });

    return {
      ...saved,
      is_monthly_budget: Boolean(saved.is_monthly_budget),
    } as BudgetPool;
  }

  public deleteBudgetPool(poolId: string): void {
    const inCategories = this.db
      .prepare('SELECT COUNT(*) as count FROM categories WHERE default_pool_id = ?')
      .get(poolId) as any;
    const inItems = this.db
      .prepare('SELECT COUNT(*) as count FROM transaction_items ti JOIN transaction_headers th ON ti.header_id = th.id WHERE th.is_deleted = 0 AND ti.budget_pool_id = ?')
      .get(poolId) as any;

    if (inCategories?.count > 0 || inItems?.count > 0) {
      throw new Error('预算池正在被分类或交易使用，无法直接删除！请先重新分配相关分类或交易。');
    }

    this.db.prepare('DELETE FROM monthly_budgets WHERE pool_id = ?').run(poolId);
    this.db.prepare('DELETE FROM budget_pools WHERE id = ?').run(poolId);

    this.recordOpLog({
      hlc: this.hlc.now(),
      node_id: this.nodeId,
      entity_type: 'BUDGET_POOL',
      entity_id: poolId,
      op_type: 'DELETE',
      payload_json: JSON.stringify({ id: poolId }),
      created_at: new Date().toISOString(),
    });
  }

  public upsertMonthlyBudget(params: {
    year_month: string;
    pool_id: string;
    base_allocation: string;
    rollover_from_prev?: string;
    note?: string | null;
  }): MonthlyBudget {
    const existing = this.db
      .prepare('SELECT * FROM monthly_budgets WHERE year_month = ? AND pool_id = ?')
      .get(params.year_month, params.pool_id) as any;

    if (existing) {
      this.db
        .prepare(`
          UPDATE monthly_budgets SET
            base_allocation = ?,
            rollover_from_prev = ?,
            note = ?
          WHERE year_month = ? AND pool_id = ?
        `)
        .run(
          formatCny(params.base_allocation),
          params.rollover_from_prev !== undefined ? formatCny(params.rollover_from_prev) : existing.rollover_from_prev,
          params.note !== undefined ? params.note : existing.note,
          params.year_month,
          params.pool_id
        );
    } else {
      this.db
        .prepare(`
          INSERT INTO monthly_budgets (year_month, pool_id, base_allocation, rollover_from_prev, reserved_fixed, swept_to_fund, note)
          VALUES (?, ?, ?, ?, '0.00', '0.00', ?)
        `)
        .run(
          params.year_month,
          params.pool_id,
          formatCny(params.base_allocation),
          formatCny(params.rollover_from_prev ?? '0.00'),
          params.note ?? null
        );
    }

    const saved = this.db
      .prepare('SELECT * FROM monthly_budgets WHERE year_month = ? AND pool_id = ?')
      .get(params.year_month, params.pool_id) as any;

    this.recordOpLog({
      hlc: this.hlc.now(),
      node_id: this.nodeId,
      entity_type: 'MONTHLY_BUDGET',
      entity_id: `${params.year_month}:${params.pool_id}`,
      op_type: 'UPSERT',
      payload_json: JSON.stringify(saved),
      created_at: new Date().toISOString(),
    });

    return saved as MonthlyBudget;
  }

  public upsertCategory(
    cat: Partial<Category> & { name: string; default_pool_id: string; icon?: string }
  ): Category {
    const id = cat.id || `CAT_CUSTOM_${Date.now()}`;
    const existing = this.db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as any;

    if (existing) {
      this.db
        .prepare(`
          UPDATE categories SET
            name = ?, default_pool_id = ?, parent_id = ?, icon_name = ?, keywords = ?, sort_order = ?
          WHERE id = ?
        `)
        .run(
          cat.name,
          cat.default_pool_id,
          cat.parent_id !== undefined ? cat.parent_id : existing.parent_id,
          cat.icon_name ?? cat.icon ?? existing.icon_name,
          cat.keywords !== undefined ? cat.keywords : existing.keywords,
          cat.sort_order ?? existing.sort_order,
          id
        );
    } else {
      this.db
        .prepare(`
          INSERT INTO categories (id, name, default_pool_id, parent_id, icon_name, keywords, sort_order)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          id,
          cat.name,
          cat.default_pool_id,
          cat.parent_id ?? null,
          cat.icon_name ?? cat.icon ?? 'tag',
          cat.keywords ?? null,
          cat.sort_order ?? 100
        );
    }

    const saved = this.db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as any;

    this.recordOpLog({
      hlc: this.hlc.now(),
      node_id: this.nodeId,
      entity_type: 'CATEGORY',
      entity_id: id,
      op_type: 'UPSERT',
      payload_json: JSON.stringify(saved),
      created_at: new Date().toISOString(),
    });

    return saved as Category;
  }

  public deleteCategory(categoryId: string): void {
    const inUse = this.db
      .prepare('SELECT COUNT(*) as count FROM transaction_items ti JOIN transaction_headers th ON ti.header_id = th.id WHERE th.is_deleted = 0 AND ti.category_id = ?')
      .get(categoryId) as any;

    if (inUse?.count > 0) {
      throw new Error('分类已被交易流水引用，无法直接删除！');
    }

    this.db.prepare('DELETE FROM categories WHERE id = ?').run(categoryId);

    this.recordOpLog({
      hlc: this.hlc.now(),
      node_id: this.nodeId,
      entity_type: 'CATEGORY',
      entity_id: categoryId,
      op_type: 'DELETE',
      payload_json: JSON.stringify({ id: categoryId }),
      created_at: new Date().toISOString(),
    });
  }

  public upsertProjectTag(tag: Partial<ProjectTag> & { name: string }): ProjectTag {
    const id = tag.id || `TAG_CUSTOM_${Date.now()}`;
    const existing = this.db.prepare('SELECT * FROM projects_and_tags WHERE id = ? OR name = ?').get(id, tag.name) as any;

    if (existing) {
      this.db
        .prepare(`
          UPDATE projects_and_tags SET
            name = ?, tag_type = ?, target_budget = ?, linked_pool_id = ?, is_active = ?
          WHERE id = ?
        `)
        .run(
          tag.name,
          tag.tag_type ?? existing.tag_type,
          tag.target_budget ? formatCny(tag.target_budget) : existing.target_budget,
          tag.linked_pool_id !== undefined ? tag.linked_pool_id : existing.linked_pool_id,
          tag.is_active !== undefined ? (tag.is_active ? 1 : 0) : existing.is_active,
          existing.id
        );
    } else {
      this.db
        .prepare(`
          INSERT INTO projects_and_tags (id, name, tag_type, target_budget, linked_pool_id, is_active)
          VALUES (?, ?, ?, ?, ?, ?)
        `)
        .run(
          id,
          tag.name,
          tag.tag_type ?? 'PROJECT',
          tag.target_budget ? formatCny(tag.target_budget) : null,
          tag.linked_pool_id ?? null,
          tag.is_active !== false ? 1 : 0
        );
    }

    const saved = this.db.prepare('SELECT * FROM projects_and_tags WHERE id = ? OR name = ?').get(id, tag.name) as any;

    this.recordOpLog({
      hlc: this.hlc.now(),
      node_id: this.nodeId,
      entity_type: 'PROJECT_TAG',
      entity_id: saved.id,
      op_type: 'UPSERT',
      payload_json: JSON.stringify(saved),
      created_at: new Date().toISOString(),
    });

    return {
      ...saved,
      is_active: Boolean(saved.is_active),
    } as ProjectTag;
  }

  public deleteProjectTag(tagId: string): void {
    const inUse = this.db
      .prepare('SELECT COUNT(*) as count FROM transaction_items ti JOIN transaction_headers th ON ti.header_id = th.id WHERE th.is_deleted = 0 AND ti.project_tag_id = ?')
      .get(tagId) as any;

    if (inUse?.count > 0) {
      throw new Error('专项标签/心愿已被交易流水引用，无法直接删除！');
    }

    this.db.prepare('DELETE FROM projects_and_tags WHERE id = ?').run(tagId);

    this.recordOpLog({
      hlc: this.hlc.now(),
      node_id: this.nodeId,
      entity_type: 'PROJECT_TAG',
      entity_id: tagId,
      op_type: 'DELETE',
      payload_json: JSON.stringify({ id: tagId }),
      created_at: new Date().toISOString(),
    });
  }

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
      const res = this.buyVoucher({
        title: finalTitle,
        voucherType: params.voucher_type,
        faceValue: params.face_value,
        acquireCost: params.acquire_cost,
        minSpend: params.min_spend,
        accountId: params.accountId ?? 'ACC_UNION_MAIN',
      });
      return { voucher: res.voucher, tx: res.transaction };
    }

    if (params.id) {
      this.db
        .prepare(`
          UPDATE vouchers SET
            title = ?, voucher_type = ?, face_value = ?, acquire_cost = ?, min_spend = ?, status = ?, expire_date = ?
          WHERE id = ?
        `)
        .run(
          finalTitle,
          params.voucher_type,
          formatCny(params.face_value),
          formatCny(params.acquire_cost ?? '0.00'),
          formatCny(params.min_spend ?? '0.00'),
          params.status ?? 'AVAILABLE',
          params.expire_date ?? null,
          params.id
        );
      const updated = this.db.prepare('SELECT * FROM vouchers WHERE id = ?').get(params.id) as any;
      this.recordOpLog({
        hlc: this.hlc.now(),
        node_id: this.nodeId,
        entity_type: 'VOUCHER',
        entity_id: String(params.id),
        op_type: 'UPSERT',
        payload_json: JSON.stringify(updated),
        created_at: new Date().toISOString(),
      });
      return { voucher: updated as Voucher };
    }

    const info = this.db
      .prepare(`
        INSERT INTO vouchers (title, voucher_type, face_value, acquire_cost, min_spend, status, purchase_tx_id, used_tx_id, expire_date)
        VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)
      `)
      .run(
        finalTitle,
        params.voucher_type,
        formatCny(params.face_value),
        formatCny(params.acquire_cost ?? '0.00'),
        formatCny(params.min_spend ?? '0.00'),
        params.status ?? 'AVAILABLE',
        params.expire_date ?? '2026-12-31'
      );

    const inserted = this.db.prepare('SELECT * FROM vouchers WHERE id = ?').get(info.lastInsertRowid) as any;
    this.recordOpLog({
      hlc: this.hlc.now(),
      node_id: this.nodeId,
      entity_type: 'VOUCHER',
      entity_id: String(inserted.id),
      op_type: 'UPSERT',
      payload_json: JSON.stringify(inserted),
      created_at: new Date().toISOString(),
    });

    return { voucher: inserted as Voucher };
  }

  public deleteVoucher(id: number): void {
    const v = this.db.prepare('SELECT * FROM vouchers WHERE id = ?').get(id) as any;
    if (v?.purchase_tx_id) {
      const txHlc = this.hlc.now();
      this.db
        .prepare('UPDATE transaction_headers SET is_deleted = 1, updated_hlc = ? WHERE id = ?')
        .run(txHlc, v.purchase_tx_id);
      this.recordOpLog({
        hlc: txHlc,
        node_id: this.nodeId,
        entity_type: 'TRANSACTION',
        entity_id: v.purchase_tx_id,
        op_type: 'DELETE',
        payload_json: JSON.stringify({ id: v.purchase_tx_id, is_deleted: true }),
        created_at: new Date().toISOString(),
      });
    }
    this.db
      .prepare('UPDATE transaction_headers SET applied_voucher_id = NULL WHERE applied_voucher_id = ?')
      .run(id);
    this.db.prepare('DELETE FROM vouchers WHERE id = ?').run(id);

    this.recordOpLog({
      hlc: this.hlc.now(),
      node_id: this.nodeId,
      entity_type: 'VOUCHER',
      entity_id: String(id),
      op_type: 'DELETE',
      payload_json: JSON.stringify({ id }),
      created_at: new Date().toISOString(),
    });

    recalculateAllAccounts(this.db);
  }

  public upsertRecurringRule(
    rule: Partial<RecurringRule> & { title: string; amount: string; account_id?: string }
  ): RecurringRule {
    const existing = rule.id != null
      ? (this.db.prepare('SELECT * FROM recurring_rules WHERE id = ?').get(rule.id) as any)
      : null;

    if (existing && rule.id != null) {
      const ruleId = rule.id;
      const effectiveAccountId = rule.account_id ?? existing.account_id;
      this.db
        .prepare(`
          UPDATE recurring_rules SET
            title = ?, rule_type = ?, cron_cycle = ?, trigger_day = ?, currency = ?, amount = ?,
            account_id = ?, target_account_id = ?, category_id = ?, budget_pool_id = ?,
            auto_reserve_budget = ?, is_active = ?
          WHERE id = ?
        `)
        .run(
          rule.title,
          rule.rule_type ?? existing.rule_type,
          rule.cron_cycle ?? existing.cron_cycle,
          rule.trigger_day ?? existing.trigger_day,
          rule.currency ?? existing.currency,
          formatCny(rule.amount),
          effectiveAccountId,
          rule.target_account_id !== undefined ? rule.target_account_id : existing.target_account_id,
          rule.category_id !== undefined ? rule.category_id : existing.category_id,
          rule.budget_pool_id !== undefined ? rule.budget_pool_id : existing.budget_pool_id,
          rule.auto_reserve_budget !== undefined ? (rule.auto_reserve_budget ? 1 : 0) : existing.auto_reserve_budget,
          rule.is_active !== undefined ? (rule.is_active ? 1 : 0) : existing.is_active,
          ruleId
        );
      const updated = this.db.prepare('SELECT * FROM recurring_rules WHERE id = ?').get(ruleId) as any;
      this.recordOpLog({
        hlc: this.hlc.now(),
        node_id: this.nodeId,
        entity_type: 'RECURRING_RULE',
        entity_id: String(ruleId),
        op_type: 'UPSERT',
        payload_json: JSON.stringify(updated),
        created_at: new Date().toISOString(),
      });
      return { ...updated, auto_reserve_budget: Boolean(updated.auto_reserve_budget), is_active: Boolean(updated.is_active) };
    } else {
      const effectiveAccountId = rule.account_id ?? 'ACC_UNION_MAIN';
      const info = this.db
        .prepare(`
          INSERT INTO recurring_rules (
            title, rule_type, cron_cycle, trigger_day, currency, amount,
            account_id, target_account_id, category_id, budget_pool_id,
            auto_reserve_budget, is_active
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          rule.title,
          rule.rule_type ?? 'FIXED_EXPENSE',
          rule.cron_cycle ?? 'MONTHLY',
          rule.trigger_day ?? 1,
          rule.currency ?? 'CNY',
          formatCny(rule.amount),
          effectiveAccountId,
          rule.target_account_id ?? null,
          rule.category_id ?? null,
          rule.budget_pool_id ?? null,
          rule.auto_reserve_budget !== false ? 1 : 0,
          rule.is_active !== false ? 1 : 0
        );
      const inserted = this.db.prepare('SELECT * FROM recurring_rules WHERE id = ?').get(info.lastInsertRowid) as any;
      this.recordOpLog({
        hlc: this.hlc.now(),
        node_id: this.nodeId,
        entity_type: 'RECURRING_RULE',
        entity_id: String(inserted.id),
        op_type: 'UPSERT',
        payload_json: JSON.stringify(inserted),
        created_at: new Date().toISOString(),
      });
      return { ...inserted, auto_reserve_budget: Boolean(inserted.auto_reserve_budget), is_active: Boolean(inserted.is_active) };
    }
  }

  public deleteRecurringRule(id: number): void {
    this.db.prepare('DELETE FROM recurring_rules WHERE id = ?').run(id);
    this.recordOpLog({
      hlc: this.hlc.now(),
      node_id: this.nodeId,
      entity_type: 'RECURRING_RULE',
      entity_id: String(id),
      op_type: 'DELETE',
      payload_json: JSON.stringify({ id }),
      created_at: new Date().toISOString(),
    });
  }

  public executeRecurringRule(
    id: number,
    txDate?: string
  ): TransactionAggregate {
    const rule = this.db.prepare('SELECT * FROM recurring_rules WHERE id = ?').get(id) as any;
    if (!rule) {
      throw new Error(`Recurring rule "${id}" not found`);
    }

    if (rule.rule_type === 'AUTO_INVEST') {
      return this.recordManualTransaction({
        tx_type: 'TRANSFER',
        tx_date: txDate,
        account_id: rule.account_id,
        target_account_id: rule.target_account_id,
        amount: formatCny(rule.amount),
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
        amount: formatCny(rule.amount),
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
      amount: formatCny(rule.amount),
      category_id: rule.category_id ?? 'CAT_TELECOM',
      budget_pool_id: rule.budget_pool_id ?? 'POOL_FIXED',
      merchant_or_note: rule.title,
      currency: rule.currency,
    });
  }

  /**
   * 关闭底层数据库连接
   */
  public close(): void {
    this.db.close();
  }
}
