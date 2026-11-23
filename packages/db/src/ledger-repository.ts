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
  getLocalTodayDateStr,
  BudgetPool,
  PoolType,
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
  SyncConflict,
  HybridLogicalClock,
  mergeOpLogEntries,
  parseQuickInputDsl,
  allocateSplitDiscounts,
  processMastercardFxLifecycle,
  DEFAULT_FX_RATES,
  SplitItemInput,
  type FullSyncBundle,
} from '@ledger/core';
import { SCHEMA_SQL, SEED_SQL } from './schema.js';

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
  }

  /**
   * 对已存在的老 SQLite 数据库执行安全原地迁移：
   * 1. 补齐新增列 (fx_cashback_rate)
   * 2. 原地重建移除账户与卡包外键及字段 (accounts / vouchers / applied_voucher_id / VOUCHER_BUY / VOUCHER_EXPIRE / AUTO_INVEST)
   * 3. 清理历史遗留表与同步记录，同时完整保留已有用户收支数据与 sync_meta.server_epoch_id
   */
  private ensureSchemaMigrations(): void {
    const txCols = this.db
      .prepare('PRAGMA table_info(transaction_headers)')
      .all() as Array<{ name: string }>;
    if (!txCols.some((c) => c.name === 'fx_cashback_rate')) {
      this.db.exec(
        'ALTER TABLE transaction_headers ADD COLUMN fx_cashback_rate NUMERIC(5, 4) DEFAULT NULL;'
      );
    }

    const hasLegacyAccountColsInTx = txCols.some(
      (c) => c.name === 'account_id' || c.name === 'target_account_id'
    );
    const hasAppliedVoucherColInTx = txCols.some(
      (c) => c.name === 'applied_voucher_id'
    );
    const txHeaderMaster = this.db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'transaction_headers'")
      .get() as { sql: string } | undefined;
    const hasLegacyTxTypeConstraint = Boolean(
      txHeaderMaster?.sql?.includes('VOUCHER_BUY') ||
        txHeaderMaster?.sql?.includes('VOUCHER_EXPIRE') ||
        txHeaderMaster?.sql?.includes('TRANSFER')
    );
    const ruleCols = this.db
      .prepare('PRAGMA table_info(recurring_rules)')
      .all() as Array<{ name: string }>;
    const hasLegacyAccountColsInRules = ruleCols.some(
      (c) => c.name === 'account_id' || c.name === 'target_account_id'
    );
    const hasVouchersTable = Boolean(
      this.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'vouchers'")
        .get()
    );
    const hasVoucherOps = Boolean(
      this.db
        .prepare("SELECT 1 FROM sync_oplog WHERE entity_type = 'VOUCHER' LIMIT 1")
        .get()
    );
    const hasVoucherConflicts = Boolean(
      this.db
        .prepare("SELECT 1 FROM sync_conflicts WHERE conflict_type = 'VOUCHER_DOUBLE_SPEND' LIMIT 1")
        .get()
    );
    const hasAccountsTable = Boolean(
      this.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'accounts'")
        .get()
    );
    const hasAccountDashboardView = Boolean(
      this.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'view' AND name = 'v_account_dashboard'")
        .get()
    );
    const hasFixedAssetsTable = Boolean(
      this.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'fixed_assets'")
        .get()
    );
    const hasFixedAssetOps = Boolean(
      this.db
        .prepare("SELECT 1 FROM sync_oplog WHERE entity_type = 'FIXED_ASSET' LIMIT 1")
        .get()
    );
    const budgetPoolMaster = this.db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'budget_pools'")
      .get() as { sql: string } | undefined;
    const hasLegacyCapitalAssetPoolConstraint = Boolean(
      budgetPoolMaster?.sql?.includes('CAPITAL_ASSET')
    );
    const hasDeprecatedPools = Boolean(
      this.db
        .prepare("SELECT 1 FROM budget_pools WHERE id IN ('POOL_FUND', 'POOL_ASSET') LIMIT 1")
        .get()
    );
    const ptCols = this.db
      .prepare('PRAGMA table_info(projects_and_tags)')
      .all() as Array<{ name: string }>;
    const hasLinkedPoolColInPt = ptCols.some((c) => c.name === 'linked_pool_id');
    const hasPtStartDate = ptCols.some((c) => c.name === 'start_date');
    const hasPtEndDate = ptCols.some((c) => c.name === 'end_date');

    if (
      !hasLegacyAccountColsInTx &&
      !hasAppliedVoucherColInTx &&
      !hasLegacyTxTypeConstraint &&
      !hasLegacyAccountColsInRules &&
      !hasVouchersTable &&
      !hasVoucherOps &&
      !hasVoucherConflicts &&
      !hasAccountsTable &&
      !hasAccountDashboardView &&
      !hasFixedAssetsTable &&
      !hasFixedAssetOps &&
      !hasLegacyCapitalAssetPoolConstraint &&
      !hasDeprecatedPools &&
      !hasLinkedPoolColInPt &&
      hasPtStartDate &&
      hasPtEndDate
    ) {
      return;
    }

    this.db.exec('PRAGMA foreign_keys = OFF;');
    try {
      this.db.exec('BEGIN IMMEDIATE;');
      try {
        this.db.exec('DROP VIEW IF EXISTS v_account_dashboard;');
        this.db.exec('DROP INDEX IF EXISTS idx_tx_headers_account;');

        if (hasLegacyAccountColsInTx || hasAppliedVoucherColInTx || hasLegacyTxTypeConstraint) {
          this.db.exec('DROP VIEW IF EXISTS v_monthly_budget_status;');
          this.db.exec(`
            CREATE TABLE transaction_headers_new (
                id                  VARCHAR(36) PRIMARY KEY,
                tx_date             DATE NOT NULL,
                tx_timestamp        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                tx_type             VARCHAR(24) NOT NULL CHECK (tx_type IN (
                                        'EXPENSE',
                                        'INCOME'
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
                                        'PENDING_HOLD',
                                        'SETTLED',
                                        'REFUNDED'
                                    )),
                hold_amount_cny     NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
                fx_cashback_rate    NUMERIC(5, 4) DEFAULT NULL,
                settled_at          TIMESTAMP DEFAULT NULL,
                raw_input_text      TEXT,
                merchant_or_note    TEXT,
                is_deleted          INTEGER NOT NULL DEFAULT 0,
                updated_hlc         VARCHAR(64) DEFAULT NULL,
                created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            INSERT INTO transaction_headers_new (
                id, tx_date, tx_timestamp, tx_type,
                total_gross, platform_discount, payment_discount, total_net,
                allocation_mode, original_currency, original_amount, exchange_rate,
                settlement_status, hold_amount_cny, fx_cashback_rate, settled_at,
                raw_input_text, merchant_or_note,
                is_deleted, updated_hlc, created_at
            )
            SELECT
                id, tx_date, tx_timestamp, tx_type,
                total_gross, platform_discount, payment_discount, total_net,
                allocation_mode, original_currency, original_amount, exchange_rate,
                settlement_status, hold_amount_cny, fx_cashback_rate, settled_at,
                raw_input_text, merchant_or_note,
                COALESCE(is_deleted, 0), updated_hlc, created_at
            FROM transaction_headers
            WHERE tx_type IN ('EXPENSE', 'INCOME');

            DROP TABLE transaction_headers;
            ALTER TABLE transaction_headers_new RENAME TO transaction_headers;
            DELETE FROM transaction_items WHERE header_id NOT IN (SELECT id FROM transaction_headers);
            CREATE INDEX IF NOT EXISTS idx_tx_headers_date ON transaction_headers(tx_date);
            CREATE INDEX IF NOT EXISTS idx_tx_headers_status ON transaction_headers(settlement_status);
          `);
        }

        if (hasLegacyAccountColsInRules) {
          this.db.exec("DELETE FROM recurring_rules WHERE rule_type = 'AUTO_INVEST';");
          this.db.exec(`
            CREATE TABLE recurring_rules_new (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                title               VARCHAR(64) NOT NULL,
                rule_type           VARCHAR(24) NOT NULL CHECK (rule_type IN (
                                        'FIXED_EXPENSE',
                                        'FX_SUBSCRIPTION'
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

            INSERT INTO recurring_rules_new (
                id, title, rule_type, cron_cycle, trigger_day, currency, amount,
                category_id, budget_pool_id, auto_reserve_budget, is_active
            )
            SELECT
                id, title, rule_type, cron_cycle, trigger_day, currency, amount,
                category_id, budget_pool_id, auto_reserve_budget, is_active
            FROM recurring_rules;

            DROP TABLE recurring_rules;
            ALTER TABLE recurring_rules_new RENAME TO recurring_rules;
          `);
        }

        this.db.exec('DROP TABLE IF EXISTS vouchers;');
        this.db.exec("DELETE FROM sync_oplog WHERE entity_type = 'VOUCHER';");
        this.db.exec("DELETE FROM sync_conflicts WHERE conflict_type = 'VOUCHER_DOUBLE_SPEND';");

        if (hasLinkedPoolColInPt) {
          const startExpr = hasPtStartDate ? 'start_date' : 'NULL';
          const endExpr = hasPtEndDate ? 'end_date' : 'NULL';
          this.db.exec(`
            CREATE TABLE projects_and_tags_new (
                id                  VARCHAR(32) PRIMARY KEY,
                name                VARCHAR(64) NOT NULL UNIQUE,
                tag_type            VARCHAR(24) NOT NULL CHECK (tag_type IN (
                                        'PROJECT',
                                        'SCENE',
                                        'STOCK_CONSUME'
                                    )),
                target_budget       NUMERIC(10, 2) DEFAULT NULL,
                start_date          DATE DEFAULT NULL,
                end_date            DATE DEFAULT NULL,
                is_active           BOOLEAN NOT NULL DEFAULT 1,
                created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            INSERT INTO projects_and_tags_new (
                id, name, tag_type, target_budget, start_date, end_date, is_active, created_at
            )
            SELECT
                id, name, tag_type, target_budget, ${startExpr}, ${endExpr}, is_active, created_at
            FROM projects_and_tags;

            DROP TABLE projects_and_tags;
            ALTER TABLE projects_and_tags_new RENAME TO projects_and_tags;
          `);
        } else {
          if (!hasPtStartDate) {
            this.db.exec('ALTER TABLE projects_and_tags ADD COLUMN start_date DATE DEFAULT NULL;');
          }
          if (!hasPtEndDate) {
            this.db.exec('ALTER TABLE projects_and_tags ADD COLUMN end_date DATE DEFAULT NULL;');
          }
        }

        this.db.exec('DROP TABLE IF EXISTS fixed_assets;');
        this.db.exec("DELETE FROM sync_oplog WHERE entity_type = 'FIXED_ASSET';");
        this.db.exec('DROP TABLE IF EXISTS accounts;');
        this.db.exec("DELETE FROM sync_oplog WHERE entity_type = 'ACCOUNT';");

        if (hasLegacyCapitalAssetPoolConstraint) {
          this.db.exec('DROP VIEW IF EXISTS v_monthly_budget_status;');
          this.db.exec(`
            CREATE TABLE budget_pools_new (
                id                  VARCHAR(32) PRIMARY KEY,
                name                VARCHAR(64) NOT NULL,
                pool_type           VARCHAR(24) NOT NULL CHECK (pool_type IN (
                                        'FIXED',
                                        'DAILY',
                                        'FLEX',
                                        'EMERGENCY',
                                        'SINKING_FUND'
                                    )),
                is_monthly_budget   BOOLEAN NOT NULL DEFAULT 1,
                rollover_strategy   VARCHAR(24) NOT NULL DEFAULT 'ACCUMULATE' CHECK (rollover_strategy IN (
                                        'ACCUMULATE',
                                        'RESET',
                                        'SWEEP_TO_FUND'
                                    )),
                description         TEXT,
                sort_order          SMALLINT NOT NULL DEFAULT 100
            );

            INSERT INTO budget_pools_new (
                id, name, pool_type, is_monthly_budget, rollover_strategy, description, sort_order
            )
            SELECT
                id,
                name,
                CASE WHEN pool_type = 'CAPITAL_ASSET' THEN 'FLEX' ELSE pool_type END,
                is_monthly_budget,
                rollover_strategy,
                description,
                sort_order
            FROM budget_pools;

            DROP TABLE budget_pools;
            ALTER TABLE budget_pools_new RENAME TO budget_pools;
          `);
        }

        // 清理未被引用的废置预算池 (POOL_FUND / POOL_ASSET)
        this.db.exec(`
          UPDATE categories SET default_pool_id = 'POOL_FLEX' WHERE default_pool_id IN ('POOL_FUND', 'POOL_ASSET');
        `);
        const refItems = (
          this.db
            .prepare("SELECT COUNT(*) AS cnt FROM transaction_items WHERE budget_pool_id IN ('POOL_FUND', 'POOL_ASSET')")
            .get() as { cnt: number }
        ).cnt;
        const refRules = (
          this.db
            .prepare("SELECT COUNT(*) AS cnt FROM recurring_rules WHERE budget_pool_id IN ('POOL_FUND', 'POOL_ASSET')")
            .get() as { cnt: number }
        ).cnt;

        if (refItems === 0 && refRules === 0) {
          this.db.exec(`
            DELETE FROM monthly_budgets WHERE pool_id IN ('POOL_FUND', 'POOL_ASSET');
            DELETE FROM budget_pools WHERE id IN ('POOL_FUND', 'POOL_ASSET');
            DELETE FROM sync_oplog WHERE entity_type = 'BUDGET_POOL' AND entity_id IN ('POOL_FUND', 'POOL_ASSET');
            DELETE FROM sync_oplog WHERE entity_type = 'MONTHLY_BUDGET' AND (entity_id LIKE '%:POOL_FUND' OR entity_id LIKE '%:POOL_ASSET');
          `);
        }

        // 重建视图以防止重建 transaction_headers 后视图丢失或失效
        this.db.exec(`
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
        `);

        const fkErrors = this.db.prepare('PRAGMA foreign_key_check').all();
        if (fkErrors.length > 0) {
          throw new Error(
            `Schema migration foreign key check failed: ${JSON.stringify(fkErrors)}`
          );
        }

        this.db.exec('COMMIT;');
      } catch (err) {
        this.db.exec('ROLLBACK;');
        throw err;
      }
    } finally {
      this.db.exec('PRAGMA foreign_keys = ON;');
    }
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
    const { header, items } = aggregate;

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

    // 1. 写入主表 transaction_headers
    this.db
      .prepare(
        `
      INSERT INTO transaction_headers (
        id, tx_date, tx_timestamp, tx_type,
        total_gross, platform_discount, payment_discount, total_net,
        allocation_mode, original_currency, original_amount, exchange_rate,
        settlement_status, hold_amount_cny, fx_cashback_rate, settled_at, raw_input_text,
        merchant_or_note, is_deleted, updated_hlc
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        txId,
        header.tx_date,
        txTimestamp,
        header.tx_type,
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
        fx_cashback_rate:
          header.fx_cashback_rate != null && header.fx_cashback_rate !== ''
            ? Number(header.fx_cashback_rate).toFixed(4)
            : null,
        exchange_rate: header.exchange_rate
          ? formatRate(header.exchange_rate)
          : '1.000000',
        is_deleted: false,
        updated_hlc: hlc,
      },
      items: insertedItems,
    };

    // 3. 写入同步变更日志
    this.recordOpLog({
      hlc,
      node_id: this.nodeId,
      entity_type: 'TRANSACTION',
      entity_id: txId,
      op_type: 'UPSERT',
      payload_json: JSON.stringify(finalAggregate),
      created_at: new Date().toISOString(),
    });

    return finalAggregate;
  }

  /**
   * 从极速记账算式 DSL 录入交易（支持跨品类凑单与外币预授权）
   */
  public recordFromDsl(
    rawText: string,
    txDate?: string
  ): TransactionAggregate {
    const categories = this.db
      .prepare('SELECT * FROM categories')
      .all() as unknown as Category[];
    const budgetPools = (
      this.db
        .prepare('SELECT * FROM budget_pools ORDER BY sort_order ASC')
        .all() as any[]
    ).map((p) => ({
      ...p,
      is_monthly_budget: Boolean(p.is_monthly_budget),
    })) as BudgetPool[];
    const projectTags = (
      this.db
        .prepare('SELECT * FROM projects_and_tags')
        .all() as any[]
    ).map((t) => ({
      ...t,
      target_budget: t.target_budget != null ? formatCny(t.target_budget) : null,
      is_active: Boolean(t.is_active),
    })) as ProjectTag[];

    const parsed = parseQuickInputDsl(rawText, {
      categories,
      projectTags,
      budgetPools,
      txDate,
    });

    return this.recordTransaction({
      header: {
        tx_date: txDate ?? getLocalTodayDateStr(),
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
        settled_at:
          parsed.settlement_status === 'SETTLED'
            ? new Date().toISOString()
            : null,
        raw_input_text: parsed.raw_input_text,
        merchant_or_note: parsed.merchant_or_note,
      },
      items: parsed.items.map((it) => ({
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
        platform_discount: formatCny(header.platform_discount ?? 0),
        original_amount:
          header.original_amount != null ? formatCny(header.original_amount) : null,
        is_deleted: Boolean(header.is_deleted),
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
      items: updatedItems.map((it) => ({
        ...it,
        is_primary_item: Boolean(it.is_primary_item),
        item_gross: formatCny(it.item_gross),
        allocated_discount: formatCny(it.allocated_discount),
        item_net: formatCny(it.item_net),
      })),
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

    return finalAggregate;
  }

  /**
   * 月末结余滚存执行引擎
   */
  public executeMonthRollover(
    fromYearMonth: string,
    toYearMonth: string
  ): MonthlyBudgetStatusRow[] {
    const fromStatus = this.getMonthlyBudgetStatus(fromYearMonth);
    const pools = this.db
      .prepare('SELECT * FROM budget_pools ORDER BY sort_order ASC')
      .all() as unknown as BudgetPool[];

    for (const pool of pools) {
      let rollover = '0.00';
      const fromRow = fromStatus.pools.find((p) => p.pool_id === pool.id);

      if (pool.rollover_strategy === 'RESET') {
        rollover = '0.00';
      } else if (pool.rollover_strategy === 'ACCUMULATE') {
        rollover = formatCny(toDecimal(fromRow?.remaining_budget ?? 0));
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

      const updatedBudget = this.db
        .prepare(
          'SELECT * FROM monthly_budgets WHERE year_month = ? AND pool_id = ?'
        )
        .get(toYearMonth, pool.id) as any;
      if (updatedBudget) {
        this.recordOpLog({
          hlc: this.hlc.now(),
          node_id: this.nodeId,
          entity_type: 'MONTHLY_BUDGET',
          entity_id: `${toYearMonth}:${pool.id}`,
          op_type: 'UPSERT',
          payload_json: JSON.stringify(updatedBudget),
          created_at: new Date().toISOString(),
        });
      }
    }

    return this.getMonthlyBudgetStatus(toYearMonth).pools;
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

    const filteredIncomingOps: SyncOpLogEntry[] = [];
    for (const op of incomingOps) {
      const entityType = op.entity_type as string;
      if (
        entityType === 'VOUCHER' ||
        entityType === 'ACCOUNT' ||
        entityType === 'FIXED_ASSET'
      ) {
        continue;
      }
      if (entityType === 'TRANSACTION') {
        try {
          const parsedPayload = JSON.parse(op.payload_json);
          const h = parsedPayload?.header ?? parsedPayload;
          if (
            h?.tx_type != null &&
            h.tx_type !== 'EXPENSE' &&
            h.tx_type !== 'INCOME'
          ) {
            continue;
          }
          if (
            (h && 'applied_voucher_id' in h) ||
            (parsedPayload && 'appliedVoucherId' in parsedPayload)
          ) {
            if (h) delete h.applied_voucher_id;
            if (parsedPayload && 'appliedVoucherId' in parsedPayload) {
              delete parsedPayload.appliedVoucherId;
            }
            filteredIncomingOps.push({
              ...op,
              payload_json: JSON.stringify(parsedPayload),
            });
            continue;
          }
        } catch {
          // Keep op as-is if JSON parse fails
        }
      }
      filteredIncomingOps.push(op);
    }

    if (filteredIncomingOps.length === 0) {
      return { appliedCount: incomingOps.length, conflicts: [] };
    }

    const existingOps = this.getOpLogs();
    const { winningEntities, detectedConflicts } = mergeOpLogEntries(
      existingOps,
      filteredIncomingOps
    );
    const cleanConflicts = detectedConflicts.filter(
      (c) => (c.conflict_type as string) !== 'VOUCHER_DOUBLE_SPEND'
    );

    // 1. 批量保存所有新操作入 sync_oplog
    const insertOpStmt = this.db.prepare(`
      INSERT OR IGNORE INTO sync_oplog (hlc, node_id, entity_type, entity_id, op_type, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const op of filteredIncomingOps) {
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
    for (const c of cleanConflicts) {
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
    // BUDGET_POOL (1) -> CATEGORY (2) -> PROJECT_TAG (3) -> MONTHLY_BUDGET/BUDGET (6) -> RECURRING_RULE (7) -> TRANSACTION (9)
    const entityOrder: Record<string, number> = {
      BUDGET_POOL: 1,
      CATEGORY: 2,
      PROJECT_TAG: 3,
      MONTHLY_BUDGET: 6,
      BUDGET: 6,
      RECURRING_RULE: 7,
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
                id, name, tag_type, target_budget, start_date, end_date, is_active
              ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
              payload.id || winningOp.entity_id,
              payload.name,
              payload.tag_type,
              payload.target_budget != null ? formatCny(payload.target_budget) : null,
              payload.start_date ?? null,
              payload.end_date ?? null,
              payload.is_active ? 1 : 0
            );
          }
        } else if ((winningOp.entity_type as string) === 'ACCOUNT') {
          // 账户体系已彻底移除，兼容忽略历史遗留的 ACCOUNT 同步日志
          continue;
        } else if ((winningOp.entity_type as string) === 'VOUCHER') {
          // 卡包功能已彻底移除，兼容忽略历史遗留的 VOUCHER 同步日志
          continue;
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
            if (payload.rule_type === 'AUTO_INVEST') {
              continue;
            }
            this.db.prepare(`
              INSERT OR REPLACE INTO recurring_rules (
                id, title, rule_type, cron_cycle, trigger_day, currency, amount,
                category_id, budget_pool_id, auto_reserve_budget, is_active
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              payload.id || Number(winningOp.entity_id),
              payload.title,
              payload.rule_type,
              payload.cron_cycle,
              payload.trigger_day,
              payload.currency ?? 'CNY',
              formatCny(payload.amount),
              payload.category_id ?? null,
              payload.budget_pool_id ?? null,
              payload.auto_reserve_budget ? 1 : 0,
              payload.is_active ? 1 : 0
            );
          }
        } else if ((winningOp.entity_type as string) === 'FIXED_ASSET') {
          // 固定资产功能已移除，兼容忽略历史同步日志
          continue;
        } else if (winningOp.entity_type === 'TRANSACTION') {
          const header = payload.header ?? payload;
          const items = payload.items ?? [];

          if (winningOp.op_type === 'DELETE' || header.is_deleted) {
            this.db
              .prepare(
                'UPDATE transaction_headers SET is_deleted = 1, updated_hlc = ? WHERE id = ?'
              )
              .run(winningOp.hlc, header.id || winningOp.entity_id);
          } else {
            if (header.tx_type !== 'EXPENSE' && header.tx_type !== 'INCOME') {
              continue;
            }
            this.db
              .prepare(
                `
              INSERT INTO transaction_headers (
                id, tx_date, tx_timestamp, tx_type,
                total_gross, platform_discount, payment_discount, total_net,
                allocation_mode, original_currency, original_amount, exchange_rate,
                settlement_status, hold_amount_cny, fx_cashback_rate, settled_at, raw_input_text,
                merchant_or_note, is_deleted, updated_hlc
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                tx_date=excluded.tx_date,
                tx_timestamp=excluded.tx_timestamp,
                tx_type=excluded.tx_type,
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
                is_deleted=excluded.is_deleted,
                updated_hlc=excluded.updated_hlc
            `
              )
              .run(
                header.id,
                header.tx_date,
                header.tx_timestamp,
                header.tx_type,
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
          }
        }
      }
    } finally {
      this.db.exec('PRAGMA foreign_keys = ON;');
    }

    // 推进本地混合逻辑时钟
    for (const op of filteredIncomingOps) {
      this.hlc.receive(op.hlc);
    }

    return { appliedCount: incomingOps.length, conflicts: cleanConflicts };
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
    const oplogs = this.getOpLogs();
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

    return {
      nodeId: this.nodeId,
      exportedAt: new Date().toISOString(),
      budgetPools,
      categories,
      projectTags,
      recurringRules,
      oplogs,
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
        DELETE FROM monthly_budgets;
        DELETE FROM recurring_rules;
        DELETE FROM projects_and_tags;
        DELETE FROM categories;
        DELETE FROM budget_pools;
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
          if (p.id === 'POOL_FUND' || p.id === 'POOL_ASSET') {
            continue;
          }
          const safePoolType =
            (p.pool_type as string) === 'CAPITAL_ASSET'
              ? 'FLEX'
              : p.pool_type;
          stmt.run(
            p.id,
            p.name,
            safePoolType,
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
          const safePoolId =
            c.default_pool_id === 'POOL_FUND' || c.default_pool_id === 'POOL_ASSET'
              ? 'POOL_FLEX'
              : c.default_pool_id;
          stmt.run(
            c.id,
            c.parent_id ?? null,
            c.name,
            safePoolId,
            c.icon_name ?? null,
            c.keywords ?? null,
            c.sort_order ?? 100
          );
        }
      }

      // 4. 还原项目与标签
      if (bundle.projectTags && bundle.projectTags.length > 0) {
        const stmt = this.db.prepare(`
          INSERT OR REPLACE INTO projects_and_tags (id, name, tag_type, target_budget, start_date, end_date, is_active)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const t of bundle.projectTags) {
          stmt.run(
            t.id,
            t.name,
            t.tag_type,
            t.target_budget != null ? formatCny(t.target_budget) : null,
            t.start_date ?? null,
            t.end_date ?? null,
            t.is_active ? 1 : 0
          );
        }
      }

      // 5. 还原月度预算
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
          if (b.pool_id === 'POOL_FUND' || b.pool_id === 'POOL_ASSET') {
            continue;
          }
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

      // 6. 还原周期性规则
      if (bundle.recurringRules && bundle.recurringRules.length > 0) {
        const stmt = this.db.prepare(`
          INSERT OR REPLACE INTO recurring_rules (
            id, title, rule_type, cron_cycle, trigger_day, currency, amount,
            category_id, budget_pool_id, auto_reserve_budget, is_active
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const r of bundle.recurringRules) {
          if ((r.rule_type as string) === 'AUTO_INVEST') {
            continue;
          }
          const safeRulePoolId =
            r.budget_pool_id === 'POOL_FUND' || r.budget_pool_id === 'POOL_ASSET'
              ? 'POOL_FLEX'
              : (r.budget_pool_id ?? null);
          stmt.run(
            r.id,
            r.title,
            r.rule_type,
            r.cron_cycle,
            r.trigger_day,
            r.currency ?? 'CNY',
            formatCny(r.amount),
            r.category_id ?? null,
            safeRulePoolId,
            r.auto_reserve_budget ? 1 : 0,
            r.is_active ? 1 : 0
          );
        }
      }

      // 7. 重放全部操作变更日志
      this.applyRemoteOpLogs(bundle.oplogs ?? []);
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
          original_amount:
            h.original_amount != null ? formatCny(h.original_amount) : null,
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
    tx_type: 'EXPENSE' | 'INCOME';
    tx_date?: string;
    amount: string;
    discount?: string;
    category_id?: string;
    budget_pool_id?: string;
    project_tag_id?: string | null;
    merchant_or_note: string;
    currency?: string;
    hold_amount_cny?: string;
    fx_hold_ratio?: string;
    fx_cashback_rate?: string;
  }): TransactionAggregate {
    const effectiveDate = params.tx_date ?? getLocalTodayDateStr();
    const currency = params.currency ?? 'CNY';
    const isFx = currency !== 'CNY';

    let totalGross = formatCny(params.amount);
    let paymentDiscount = formatCny(params.discount ?? '0.00');
    const platformDiscount = '0.00';
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
    const settlementStatus: 'PENDING_HOLD' | 'SETTLED' = isFx
      ? 'PENDING_HOLD'
      : 'SETTLED';
    let holdAmountCny = '0.00';
    let fxCashbackRateToStore: string | null = null;
    let fxExchangeRate: string | null = null;

    if (params.tx_type === 'EXPENSE') {
      const catId = params.category_id ?? 'CAT_FOOD';
      const cat = this.db
        .prepare('SELECT * FROM categories WHERE id = ?')
        .get(catId) as any;
      const poolId = params.budget_pool_id ?? (cat?.default_pool_id ?? 'POOL_DAILY');

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

      if (isFx) {
        const refRate = DEFAULT_FX_RATES[currency] ?? '7.200000';
        const holdRatio =
          params.fx_hold_ratio !== undefined && params.fx_hold_ratio !== ''
            ? params.fx_hold_ratio
            : '1.020';
        const cashbackRate =
          params.fx_cashback_rate !== undefined && params.fx_cashback_rate !== ''
            ? params.fx_cashback_rate
            : '0.0100';
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
        fxExchangeRate = fxRes.exchange_rate;
        if (items.length > 0) {
          items[0].item_gross = fxRes.total_gross;
          items[0].allocated_discount = fxRes.payment_discount;
          items[0].item_net = fxRes.total_net;
        }
      }
    } else if (params.tx_type === 'INCOME') {
      paymentDiscount = '0.00';
      totalNet = totalGross;
    }

    return this.recordTransaction({
      header: {
        tx_date: effectiveDate,
        tx_type: params.tx_type,
        total_gross: totalGross,
        platform_discount: platformDiscount,
        payment_discount: paymentDiscount,
        total_net: totalNet,
        allocation_mode: 'SINGLE',
        original_currency: currency,
        original_amount: isFx ? formatCny(params.amount) : null,
        exchange_rate: isFx ? (fxExchangeRate ?? '1.000000') : '1.000000',
        settlement_status: settlementStatus,
        hold_amount_cny: holdAmountCny,
        fx_cashback_rate: fxCashbackRateToStore,
        settled_at: settlementStatus === 'SETTLED' ? new Date().toISOString() : null,
        raw_input_text: `手动录入：${params.merchant_or_note} ${params.amount}`,
        merchant_or_note: params.merchant_or_note,
      },
      items: items.map((it) => ({
        id: 0,
        header_id: '',
        ...it,
        raw_formula_expr: it.raw_formula_expr ?? null,
      })),
    });
  }

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
    const existing = this.getRecentTransactions(1000).find((t) => t.header.id === txId);
    if (!existing) {
      throw new Error(`Transaction "${txId}" not found`);
    }

    const h = existing.header;
    const prevGross = h.total_gross;
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

    const hlc = this.hlc.now();
    h.updated_hlc = hlc;

    this.db
      .prepare(`
        UPDATE transaction_headers SET
          tx_date = ?, total_gross = ?,
          payment_discount = ?, total_net = ?, merchant_or_note = ?, updated_hlc = ?
        WHERE id = ?
      `)
      .run(
        h.tx_date,
        h.total_gross,
        h.payment_discount,
        h.total_net,
        h.merchant_or_note,
        hlc,
        txId
      );

    if (existing.items.length === 1) {
      const primary = existing.items[0];
      const itemPatch = patch.item_updates?.find(
        (u) =>
          (u.index !== undefined && u.index === 0) ||
          (u.id !== undefined && u.id !== 0 && u.id === primary.id)
      );
      if (itemPatch?.item_name !== undefined) {
        primary.item_name = itemPatch.item_name;
      } else if (patch.merchant_or_note !== undefined) {
        primary.item_name = patch.merchant_or_note;
      }
      if (patch.total_gross !== undefined) primary.item_gross = h.total_gross;
      if (patch.payment_discount !== undefined) primary.allocated_discount = h.payment_discount;
      primary.item_net = h.total_net;
      if (itemPatch?.category_id !== undefined) {
        primary.category_id = itemPatch.category_id;
      } else if (patch.category_id !== undefined) {
        primary.category_id = patch.category_id;
      }
      if (itemPatch?.budget_pool_id !== undefined) {
        primary.budget_pool_id = itemPatch.budget_pool_id;
      } else if (patch.budget_pool_id !== undefined) {
        primary.budget_pool_id = patch.budget_pool_id;
      }
      if (itemPatch?.project_tag_id !== undefined) {
        primary.project_tag_id = itemPatch.project_tag_id;
      } else if (patch.project_tag_id !== undefined) {
        primary.project_tag_id = patch.project_tag_id;
      }
    } else if (existing.items.length > 1) {
      existing.items.forEach((item, idx) => {
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
          scaledGrosses = existing.items.map((it) =>
            roundCny(toDecimal(it.item_gross).div(oldGrossDec).times(newGrossDec))
          );
          const sumScaled = scaledGrosses.reduce((a, b) => a.plus(b), new Decimal(0));
          const diff = newGrossDec.minus(sumScaled);
          if (!diff.isZero() && scaledGrosses.length > 0) {
            scaledGrosses[0] = roundCny(scaledGrosses[0].plus(diff));
          }
        } else {
          scaledGrosses = existing.items.map((it) => toDecimal(it.item_gross));
        }

        const splitInputs: SplitItemInput[] = existing.items.map((it, idx) => ({
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
        existing.items.forEach((it, idx) => {
          const res = allocated[idx];
          if (res) {
            it.item_gross = res.gross;
            it.allocated_discount = res.allocated_discount;
            it.item_net = res.net;
          }
        });
      }
    }

    if (existing.items.length > 0) {
      const updateItemStmt = this.db.prepare(`
        UPDATE transaction_items SET
          item_name = ?, item_gross = ?, allocated_discount = ?, item_net = ?,
          category_id = ?, budget_pool_id = ?, project_tag_id = ?
        WHERE id = ?
      `);
      for (const item of existing.items) {
        updateItemStmt.run(
          item.item_name,
          item.item_gross,
          item.allocated_discount,
          item.item_net,
          item.category_id,
          item.budget_pool_id,
          item.project_tag_id ?? null,
          item.id
        );
      }
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

    this.recordOpLog({
      hlc,
      node_id: this.nodeId,
      entity_type: 'TRANSACTION',
      entity_id: txId,
      op_type: 'UPSERT',
      payload_json: JSON.stringify(existing),
      created_at: new Date().toISOString(),
    });

    return existing;
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
            name = ?, tag_type = ?, target_budget = ?, start_date = ?, end_date = ?, is_active = ?
          WHERE id = ?
        `)
        .run(
          tag.name,
          tag.tag_type ?? existing.tag_type,
          tag.target_budget !== undefined
            ? (tag.target_budget ? formatCny(tag.target_budget) : null)
            : existing.target_budget,
          tag.start_date !== undefined ? tag.start_date : existing.start_date,
          tag.end_date !== undefined ? tag.end_date : existing.end_date,
          tag.is_active !== undefined ? (tag.is_active ? 1 : 0) : existing.is_active,
          existing.id
        );
    } else {
      this.db
        .prepare(`
          INSERT INTO projects_and_tags (id, name, tag_type, target_budget, start_date, end_date, is_active)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          id,
          tag.name,
          tag.tag_type ?? 'PROJECT',
          tag.target_budget ? formatCny(tag.target_budget) : null,
          tag.start_date ?? null,
          tag.end_date ?? null,
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

  public upsertRecurringRule(
    rule: Partial<RecurringRule> & { title: string; amount: string }
  ): RecurringRule {
    const existing = rule.id != null
      ? (this.db.prepare('SELECT * FROM recurring_rules WHERE id = ?').get(rule.id) as any)
      : null;

    if (existing && rule.id != null) {
      const ruleId = rule.id;
      this.db
        .prepare(`
          UPDATE recurring_rules SET
            title = ?, rule_type = ?, cron_cycle = ?, trigger_day = ?, currency = ?, amount = ?,
            category_id = ?, budget_pool_id = ?,
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
      const info = this.db
        .prepare(`
          INSERT INTO recurring_rules (
            title, rule_type, cron_cycle, trigger_day, currency, amount,
            category_id, budget_pool_id,
            auto_reserve_budget, is_active
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          rule.title,
          rule.rule_type ?? 'FIXED_EXPENSE',
          rule.cron_cycle ?? 'MONTHLY',
          rule.trigger_day ?? 1,
          rule.currency ?? 'CNY',
          formatCny(rule.amount),
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

    if (rule.rule_type === 'FX_SUBSCRIPTION') {
      return this.recordManualTransaction({
        tx_type: 'EXPENSE',
        tx_date: txDate,
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
