import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { describe, it, expect } from 'vitest';
import { LedgerRepository } from '../src/ledger-repository.js';
import { Decimal, roundCny, formatCny } from '@ledger/core';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: typeof DatabaseSyncType;
};

describe('Stage 4: @ledger/db SQLite Layer & LedgerRepository Integration Tests', () => {
  // --------------------------------------------------------------------------
  // 测试 1：万事达外币预授权与返现清算生命周期
  // --------------------------------------------------------------------------
  describe('1. Mastercard CN Debit FX Pre-Auth & Settlement Lifecycle', () => {
    it('should record 102% hold in PENDING_HOLD, then settle net with 1% cashback in SETTLED', () => {
      const repo = new LedgerRepository(':memory:', 'node-mc-fx-test');

      // 1. 录入外币预授权消费：Porkbun域名 $4.35 冻结31.95 #数字服务
      const holdTx = repo.recordFromDsl(
        'Porkbun域名 $4.35 冻结31.95 #数字服务',
        '2026-11-08'
      );

      expect(holdTx.header.settlement_status).toBe('PENDING_HOLD');
      expect(holdTx.header.original_currency).toBe('USD');
      expect(holdTx.header.original_amount).toBe('4.35');
      expect(holdTx.header.hold_amount_cny).toBe('31.95');
      // 预估原价 = 31.95 / 1.02 = 31.32，预估返现 = 0.31，预估暂扣预算 = 31.01
      expect(holdTx.header.total_gross).toBe('31.32');
      expect(holdTx.header.payment_discount).toBe('0.31');
      expect(holdTx.header.total_net).toBe('31.01');

      // 验证挂起态弹性预算池暂扣 31.01
      const budgetHold = repo.getMonthlyBudgetStatus('2026-11');
      const flexHold = budgetHold.pools.find((p) => p.pool_id === 'POOL_FLEX')!;
      expect(flexHold.spent_net).toBe('31.01');

      // 2. 模拟 T+2 银行正式清算入账：清算金额 31.20 元
      const settledTx = repo.settleMastercardTransaction(
        holdTx.header.id,
        '31.20',
        '2026-11-10T09:30:00Z'
      );

      expect(settledTx.header.settlement_status).toBe('SETTLED');
      expect(settledTx.header.hold_amount_cny).toBe('0.00');
      expect(settledTx.header.total_gross).toBe('31.20');
      // 真实 1% 返现 = round(31.20 * 0.01) = 0.31
      expect(settledTx.header.payment_discount).toBe('0.31');
      // 最终实际扣款净额 = 31.20 - 0.31 = 30.89
      expect(settledTx.header.total_net).toBe('30.89');
      // 最终结算汇率 = 31.20 / 4.35 = 7.172414
      expect(settledTx.header.exchange_rate).toBe('7.172414');

      // 验证预算池净支出自动修正为 30.89
      const budgetSettled = repo.getMonthlyBudgetStatus('2026-11');
      const flexSettled = budgetSettled.pools.find(
        (p) => p.pool_id === 'POOL_FLEX'
      )!;
      expect(flexSettled.spent_net).toBe('30.89');
    });
  });

  // --------------------------------------------------------------------------
  // 测试 2：有偿立减金购券入库与食堂消费核销闭环
  // --------------------------------------------------------------------------
  describe('2. Prepaid Voucher Buying and Canteen Redemption Closed-Loop', () => {
    it('should accurately carry over acquire cost (5.99) with cash (5.00) totaling 10.99 net spent, while crediting 4.01 savings', () => {
      const repo = new LedgerRepository(':memory:', 'node-voucher-test');

      // 1. 花费 5.99 元购买一张面值 10.00 元的微信立减金（门槛 10.01 元）
      const { voucher, transaction: buyTx } = repo.buyVoucher({
        title: '微信支付10元立减金',
        voucherType: 'PREPAID_COUPON',
        faceValue: '10.00',
        acquireCost: '5.99',
        minSpend: '10.01',
        txDate: '2026-11-05',
      });

      expect(voucher.status).toBe('AVAILABLE');
      expect(voucher.face_value).toBe('10.00');
      expect(voucher.acquire_cost).toBe('5.99');
      expect(buyTx.header.tx_type).toBe('VOUCHER_BUY');
      expect(buyTx.header.total_net).toBe('5.99');

      // 验证购券不占用月度餐饮预算池
      const budgetAfterBuy = repo.getMonthlyBudgetStatus('2026-11');
      const dailyAfterBuy = budgetAfterBuy.pools.find(
        (p) => p.pool_id === 'POOL_DAILY'
      )!;
      expect(dailyAfterBuy.spent_net).toBe('0.00');

      // 2. 在食堂消费原价 15.00 元，现场勾选核销该 10 元立减金（现场微信实付 5.00 元）
      const canteenTx = repo.recordFromDsl(
        '食堂 15 #饮食',
        '2026-11-06',
        voucher.id
      );

      // 验证订单三元组守恒与结转：
      // total_gross = 15.00
      // 现场付 5.00 + 购券成本 5.99 = 预算实耗净额 total_net = 10.99
      // 薅羊毛净省 total_discount = 15.00 - 10.99 = 4.01 (即 10.00 - 5.99)
      expect(canteenTx.header.total_gross).toBe('15.00');
      expect(canteenTx.header.payment_discount).toBe('4.01');
      expect(canteenTx.header.total_net).toBe('10.99');
      expect(canteenTx.header.applied_voucher_id).toBe(voucher.id);

      // 验证子明细行严格守恒：
      expect(canteenTx.items.length).toBe(1);
      expect(canteenTx.items[0].item_gross).toBe('15.00');
      expect(canteenTx.items[0].allocated_discount).toBe('4.01');
      expect(canteenTx.items[0].item_net).toBe('10.99');

      // 验证预算池与薅羊毛省钱榜：
      // 餐饮高频池 spent_net = 10.99, total_saved_discount = 4.01
      const budgetAfterSpend = repo.getMonthlyBudgetStatus('2026-11');
      const dailyAfterSpend = budgetAfterSpend.pools.find(
        (p) => p.pool_id === 'POOL_DAILY'
      )!;
      expect(dailyAfterSpend.spent_gross).toBe('15.00');
      expect(dailyAfterSpend.spent_net).toBe('10.99');
      expect(dailyAfterSpend.total_saved_discount).toBe('4.01');

      // 验证卡券状态变为 USED
      const vInDb = repo.db
        .prepare('SELECT * FROM vouchers WHERE id = ?')
        .get(voucher.id) as any;
      expect(vInDb.status).toBe('USED');
      expect(vInDb.used_tx_id).toBe(canteenTx.header.id);
    });
  });

  // --------------------------------------------------------------------------
  // 测试 3：高频池今日动态日均可用额度与跨月结余滚存
  // --------------------------------------------------------------------------
  describe('3. Dynamic Daily Remaining Budget & Month Rollover', () => {
    it('should compute remaining daily budget correctly based on current date, and execute month rollover for the 4 core pools', () => {
      const repo = new LedgerRepository(':memory:', 'node-daily-rollover-test');

      // 仅初始化四大核心预算池，且无废置池/规则
      const pools = repo.db
        .prepare('SELECT id FROM budget_pools ORDER BY sort_order ASC')
        .all() as Array<{ id: string }>;
      expect(pools.map((p) => p.id)).toEqual([
        'POOL_FIXED',
        'POOL_DAILY',
        'POOL_FLEX',
        'POOL_EMERGENCY',
      ]);
      expect(repo.getMetadata().recurringRules).toHaveLength(2);

      // 2026-11 共有 30 天。假设当前日期为 2026-11-12，本月剩余天数（含今日）= 30 - 12 + 1 = 19 天。
      // 初始高频池总额 = 650.00 元。
      // 今日剩余日均额度 = 650.00 / 19 = 34.2105... -> 34.21 元/天
      const statusDay12Before = repo.getMonthlyBudgetStatus(
        '2026-11',
        '2026-11-12'
      );
      expect(statusDay12Before.dailyPoolRemainingPerDay).toBe('34.21');

      // 在 11-12 当天消费 80 元
      repo.recordFromDsl('食堂大餐 80 #饮食', '2026-11-12');

      // 累计已用 80.00，剩余额度 = 650 - 80 = 570.00
      // 动态日均可用 = 570.00 / 19 = 30.00 元/天
      const statusDay12After = repo.getMonthlyBudgetStatus(
        '2026-11',
        '2026-11-12'
      );
      expect(statusDay12After.dailyPoolRemainingPerDay).toBe('30.00');

      // 执行跨月结转至 2026-12：
      // 四大初始预算池默认均为 ACCUMULATE：
      // POOL_DAILY (剩余 570.00): 滚入 570.00
      // POOL_FIXED (剩余 204.00): 滚入 204.00
      // POOL_FLEX (剩余 450.00): 滚入 450.00
      // POOL_EMERGENCY (剩余 196.00): 滚入 196.00
      const nextMonthPools = repo.executeMonthRollover('2026-11', '2026-12');
      const decDaily = nextMonthPools.find((p) => p.pool_id === 'POOL_DAILY')!;
      const decFixed = nextMonthPools.find((p) => p.pool_id === 'POOL_FIXED')!;
      const decFlex = nextMonthPools.find((p) => p.pool_id === 'POOL_FLEX')!;
      const decEmerg = nextMonthPools.find((p) => p.pool_id === 'POOL_EMERGENCY')!;

      expect(decDaily.rollover_from_prev).toBe('570.00');
      expect(decFixed.rollover_from_prev).toBe('204.00');
      expect(decFlex.rollover_from_prev).toBe('450.00');
      expect(decEmerg.rollover_from_prev).toBe('196.00');

      // 验证显式设为 RESET 的池子在跨月结转时仍清零
      repo.upsertBudgetPool({
        id: 'POOL_FIXED',
        name: '固定刚需与定投池',
        rollover_strategy: 'RESET',
      });
      const nextMonthAfterReset = repo.executeMonthRollover('2026-11', '2026-12');
      const decFixedReset = nextMonthAfterReset.find((p) => p.pool_id === 'POOL_FIXED')!;
      expect(decFixedReset.rollover_from_prev).toBe('0.00');
    });
  });

  // --------------------------------------------------------------------------
  // 测试 4：双节点离线因果一致性收敛与全量冷备恢复
  // --------------------------------------------------------------------------
  describe('4. Multi-Node Offline Sync Convergence & Reseed From Bundle', () => {
    it('should converge to 100% identical state regardless of message delivery order, and support complete disaster recovery via reseedFromBundle', () => {
      // 创建两个独立节点
      const repoA = new LedgerRepository(':memory:', 'node-alpha');
      const repoB = new LedgerRepository(':memory:', 'node-beta');

      // 节点 A 离线记账两笔
      repoA.recordFromDsl('华莱士 30 #饮食', '2026-11-05');
      repoA.recordFromDsl('短袖 50 #服饰', '2026-11-06');

      // 节点 B 离线记账两笔
      repoB.recordFromDsl('理发 20 #通信', '2026-11-07');
      repoB.recordFromDsl('开发板 60 #电子', '2026-11-08');

      // 互相交换操作日志（A 按反向顺序应用 B 的操作，B 正常应用 A 的操作）
      const opsA = repoA.getOpLogs();
      const opsB = repoB.getOpLogs();
      const opsBReversed = [...opsB].reverse();

      repoA.applyRemoteOpLogs(opsBReversed);
      repoB.applyRemoteOpLogs(opsA);

      // 验证双节点达到 100% 强一致性收敛！
      const budgetA = repoA.getMonthlyBudgetStatus('2026-11');
      const budgetB = repoB.getMonthlyBudgetStatus('2026-11');
      expect(budgetA.totalMonthlySpent).toBe('160.00'); // 30 + 50 + 20 + 60 = 160.00
      expect(budgetA.totalMonthlySpent).toBe(budgetB.totalMonthlySpent);
      expect(budgetA.pools).toEqual(budgetB.pools);
      expect(repoA.getRecentTransactions(50).map((t) => t.header.id)).toEqual(
        repoB.getRecentTransactions(50).map((t) => t.header.id)
      );

      // 模拟服务器炸机空库后从客户端完整快照包 100% 恢复
      const bundle = repoA.exportFullSyncBundle();
      const freshRepo = new LedgerRepository(':memory:', 'crashed-recovered-node');

      freshRepo.reseedFromBundle(bundle);

      expect(freshRepo.getMonthlyBudgetStatus('2026-11')).toEqual(budgetA);
      expect(freshRepo.getRecentTransactions(50).map((t) => t.header.id)).toEqual(
        repoA.getRecentTransactions(50).map((t) => t.header.id)
      );
    });
  });

  // --------------------------------------------------------------------------
  // 额外测试：固定资产日均成本追踪与守恒定律断言防御
  // --------------------------------------------------------------------------
  describe('5. Fixed Asset Cost Per Day & Conservation Defense', () => {
    it('should compute cost per day for iPhone 13 mini and monitor hard drive', () => {
      const repo = new LedgerRepository(':memory:', 'node-assets-test');

      // 2026-11-12 计算持有日均成本：
      // iPhone 13 mini 购于 2026-09-01，经过 72 天，净价 1150.00，当前日均 = 1150 / 72 = 15.97 元/天
      const assets = repo.getFixedAssetsWithCost('2026-11-12');
      const iphone = assets.find((a) => a.asset_name.includes('iPhone 13 mini'))!;
      const hdd = assets.find((a) => a.asset_name.includes('硬盘'))!;

      expect(iphone.daysHeld).toBe(72);
      expect(iphone.currentDailyCost).toBe('15.97');
      expect(hdd.daysHeld).toBe(42);
      expect(hdd.currentDailyCost).toBe('9.76');
    });

    it('should strictly throw error when recordTransaction violates item conservation law', () => {
      const repo = new LedgerRepository(':memory:', 'node-defense-test');

      expect(() => {
        repo.recordTransaction({
          header: {
            tx_date: '2026-11-12',
            tx_type: 'EXPENSE',
            total_gross: '100.00',
            platform_discount: '0.00',
            payment_discount: '0.00',
            total_net: '100.00',
            allocation_mode: 'SINGLE',
            original_currency: 'CNY',
            original_amount: null,
            exchange_rate: '1.000000',
            settlement_status: 'SETTLED',
            hold_amount_cny: '0.00',
            settled_at: null,
            raw_input_text: null,
            merchant_or_note: '违规单据',
          },
          items: [
            {
              id: 0,
              header_id: '',
              item_name: '假冒子项',
              category_id: 'CAT_FOOD',
              budget_pool_id: 'POOL_DAILY',
              project_tag_id: null,
              item_gross: '80.00', // 与 header.total_gross 100.00 不一致！
              allocated_discount: '0.00',
              item_net: '80.00',
              is_primary_item: true,
              raw_formula_expr: null,
            },
          ],
        });
      }).toThrow(/Conservation law violated/);
    });

    it('should preserve per-transaction fx_cashback_rate=0.0000 through hold and settlement', () => {
      const repo = new LedgerRepository(':memory:', 'node-fx-zero-test');

      const pendingTx = repo.recordManualTransaction({
        tx_type: 'EXPENSE',
        tx_date: '2026-11-12',
        amount: '10.00',
        currency: 'USD',
        merchant_or_note: 'Cloudflare',
        fx_hold_ratio: '1.020',
        fx_cashback_rate: '0.0000',
      });

      expect(pendingTx.header.settlement_status).toBe('PENDING_HOLD');
      expect(pendingTx.header.fx_cashback_rate).toBe('0.0000');
      expect(pendingTx.header.payment_discount).toBe('0.00');
      expect(pendingTx.header.total_net).toBe(pendingTx.header.total_gross);

      const settledTx = repo.settleMastercardTransaction(
        pendingTx.header.id,
        '72.50'
      );

      expect(settledTx.header.settlement_status).toBe('SETTLED');
      expect(settledTx.header.fx_cashback_rate).toBe('0.0000');
      expect(settledTx.header.total_gross).toBe('72.50');
      expect(settledTx.header.payment_discount).toBe('0.00');
      expect(settledTx.header.total_net).toBe('72.50');
      expect(settledTx.items[0].allocated_discount).toBe('0.00');
      expect(settledTx.items[0].item_net).toBe('72.50');
    });

    it('should update per-item budget pools independently on multi-item transaction without corrupting split amounts', () => {
      const repo = new LedgerRepository(':memory:', 'node-multi-item-edit');
      const created = repo.recordFromDsl('测试1 20 #日常 + 测试2 10 #弹性 = 15', '2026-11-15');
      expect(created.items).toHaveLength(2);

      repo.updateTransaction(created.header.id, {
        merchant_or_note: '测试1 + 测试2',
        item_updates: [
          { index: 0, id: created.items[0].id, budget_pool_id: 'POOL_EMERGENCY', project_tag_id: null },
          { index: 1, id: created.items[1].id, budget_pool_id: 'POOL_DAILY', project_tag_id: null },
        ],
      });

      const reloaded = repo.getRecentTransactions(50).find((t) => t.header.id === created.header.id)!;
      expect(reloaded.items).toHaveLength(2);
      expect(reloaded.items[0].item_name).toBe('测试1');
      expect(reloaded.items[0].item_net).toBe('10.00');
      expect(reloaded.items[0].budget_pool_id).toBe('POOL_EMERGENCY');
      expect(reloaded.items[1].item_name).toBe('测试2');
      expect(reloaded.items[1].item_net).toBe('5.00');
      expect(reloaded.items[1].budget_pool_id).toBe('POOL_DAILY');
    });
  });

  // =========================================================================
  // Test 6: Legacy Schema In-Place Migration
  // =========================================================================
  describe('6. Legacy Schema In-Place Migration', () => {
    it('should migrate legacy schema database with accounts, REPAY_COUPON, AUTO_INVEST, POOL_FUND/POOL_ASSET in-place preserving rows and server_epoch_id', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-migration-'));
      const tmpDbPath = path.join(tmpDir, 'legacy.db');

      try {
        const legacyDb = new DatabaseSync(tmpDbPath);
        legacyDb.exec(`
          PRAGMA foreign_keys = ON;
          CREATE TABLE accounts (
            id VARCHAR(32) PRIMARY KEY,
            name VARCHAR(64) NOT NULL,
            account_role VARCHAR(16) NOT NULL,
            currency VARCHAR(8) NOT NULL DEFAULT 'CNY',
            book_balance NUMERIC(12, 2) NOT NULL DEFAULT 0.00
          );
          CREATE TABLE budget_pools (
            id VARCHAR(32) PRIMARY KEY,
            name VARCHAR(64) NOT NULL,
            pool_type VARCHAR(24) NOT NULL,
            is_monthly_budget BOOLEAN NOT NULL DEFAULT 1,
            rollover_strategy VARCHAR(24) NOT NULL DEFAULT 'ACCUMULATE',
            description TEXT,
            sort_order SMALLINT NOT NULL DEFAULT 100
          );
          CREATE TABLE monthly_budgets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            year_month CHAR(7) NOT NULL,
            pool_id VARCHAR(32) NOT NULL REFERENCES budget_pools(id),
            base_allocation NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
            rollover_from_prev NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
            reserved_fixed NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
            swept_to_fund NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
            note TEXT,
            UNIQUE (year_month, pool_id)
          );
          CREATE TABLE categories (
            id VARCHAR(32) PRIMARY KEY,
            parent_id VARCHAR(32) REFERENCES categories(id),
            name VARCHAR(64) NOT NULL,
            default_pool_id VARCHAR(32) NOT NULL REFERENCES budget_pools(id),
            icon_name VARCHAR(32),
            keywords TEXT,
            sort_order SMALLINT NOT NULL DEFAULT 100
          );
          CREATE TABLE projects_and_tags (
            id VARCHAR(32) PRIMARY KEY,
            name VARCHAR(64) NOT NULL UNIQUE,
            tag_type VARCHAR(24) NOT NULL CHECK (tag_type IN ('PROJECT', 'SCENE', 'STOCK_CONSUME')),
            target_budget NUMERIC(10, 2) DEFAULT NULL,
            linked_pool_id VARCHAR(32) REFERENCES budget_pools(id),
            is_active BOOLEAN NOT NULL DEFAULT 1,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
          );
          CREATE TABLE vouchers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title VARCHAR(128) NOT NULL,
            voucher_type VARCHAR(24) NOT NULL CHECK (voucher_type IN ('PREPAID_COUPON', 'FREE_COUPON', 'REPAY_COUPON')),
            face_value NUMERIC(10, 2) NOT NULL,
            acquire_cost NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
            min_spend NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
            status VARCHAR(16) NOT NULL DEFAULT 'AVAILABLE',
            purchase_tx_id VARCHAR(36) DEFAULT NULL,
            used_tx_id VARCHAR(36) DEFAULT NULL,
            expire_date DATE DEFAULT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
          );
          CREATE TABLE transaction_headers (
            id VARCHAR(36) PRIMARY KEY,
            tx_date DATE NOT NULL,
            tx_timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            tx_type VARCHAR(24) NOT NULL CHECK (tx_type IN ('EXPENSE', 'INCOME', 'TRANSFER', 'VOUCHER_BUY', 'VOUCHER_EXPIRE')),
            account_id VARCHAR(32) REFERENCES accounts(id),
            target_account_id VARCHAR(32) REFERENCES accounts(id),
            total_gross NUMERIC(12, 2) NOT NULL,
            platform_discount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
            payment_discount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
            total_net NUMERIC(12, 2) NOT NULL,
            allocation_mode VARCHAR(20) NOT NULL DEFAULT 'PROPORTIONAL',
            original_currency VARCHAR(8) NOT NULL DEFAULT 'CNY',
            original_amount NUMERIC(12, 2) DEFAULT NULL,
            exchange_rate NUMERIC(12, 6) DEFAULT 1.000000,
            settlement_status VARCHAR(20) NOT NULL DEFAULT 'SETTLED',
            hold_amount_cny NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
            settled_at TIMESTAMP DEFAULT NULL,
            raw_input_text TEXT,
            merchant_or_note TEXT,
            applied_voucher_id INTEGER DEFAULT NULL REFERENCES vouchers(id),
            is_deleted INTEGER NOT NULL DEFAULT 0,
            updated_hlc VARCHAR(64) DEFAULT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
          );
          CREATE TABLE transaction_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            header_id VARCHAR(36) NOT NULL REFERENCES transaction_headers(id) ON DELETE CASCADE,
            item_name VARCHAR(128) NOT NULL,
            category_id VARCHAR(32) NOT NULL REFERENCES categories(id),
            budget_pool_id VARCHAR(32) NOT NULL REFERENCES budget_pools(id),
            project_tag_id VARCHAR(32) REFERENCES projects_and_tags(id),
            item_gross NUMERIC(12, 2) NOT NULL,
            allocated_discount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
            item_net NUMERIC(12, 2) NOT NULL,
            is_primary_item BOOLEAN NOT NULL DEFAULT 0,
            raw_formula_expr VARCHAR(64) DEFAULT NULL
          );
          CREATE TABLE fixed_assets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            asset_name VARCHAR(128) NOT NULL,
            purchase_item_id INT REFERENCES transaction_items(id),
            purchase_date DATE NOT NULL,
            purchase_net_cost NUMERIC(10, 2) NOT NULL,
            target_daily_cost NUMERIC(8, 2) DEFAULT 2.00,
            status VARCHAR(16) NOT NULL DEFAULT 'IN_USE',
            resale_date DATE DEFAULT NULL,
            resale_recovery NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
            note TEXT
          );
          CREATE TABLE recurring_rules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title VARCHAR(64) NOT NULL,
            rule_type VARCHAR(24) NOT NULL CHECK (rule_type IN ('FIXED_EXPENSE', 'FX_SUBSCRIPTION', 'AUTO_INVEST')),
            cron_cycle VARCHAR(16) NOT NULL,
            trigger_day SMALLINT NOT NULL,
            currency VARCHAR(8) NOT NULL DEFAULT 'CNY',
            amount NUMERIC(10, 2) NOT NULL,
            account_id VARCHAR(32) REFERENCES accounts(id),
            target_account_id VARCHAR(32) REFERENCES accounts(id),
            category_id VARCHAR(32) REFERENCES categories(id),
            budget_pool_id VARCHAR(32) REFERENCES budget_pools(id),
            auto_reserve_budget BOOLEAN NOT NULL DEFAULT 1,
            is_active BOOLEAN NOT NULL DEFAULT 1
          );
          CREATE TABLE sync_oplog (
            hlc VARCHAR(64) PRIMARY KEY,
            node_id VARCHAR(64) NOT NULL,
            entity_type VARCHAR(32) NOT NULL,
            entity_id VARCHAR(64) NOT NULL,
            op_type VARCHAR(16) NOT NULL,
            payload_json TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
          );
          CREATE TABLE sync_meta (
            key VARCHAR(64) PRIMARY KEY,
            value TEXT NOT NULL
          );
          CREATE TABLE sync_conflicts (
            id VARCHAR(128) PRIMARY KEY,
            conflict_type VARCHAR(32) NOT NULL,
            entity_id VARCHAR(64) NOT NULL,
            winner_hlc VARCHAR(64) NOT NULL,
            loser_hlc VARCHAR(64) NOT NULL,
            winner_summary TEXT NOT NULL,
            loser_summary TEXT NOT NULL,
            loser_payload_json TEXT NOT NULL,
            status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
          );
          CREATE VIEW v_account_dashboard AS SELECT id, name, book_balance FROM accounts;

          INSERT INTO accounts (id, name, account_role, book_balance) VALUES
            ('ACC_UNION_MAIN', '银联卡', 'DEBIT_MAIN', 5000.00),
            ('ACC_HUABEI', '花呗', 'CREDIT', -100.00);
          INSERT INTO budget_pools (id, name, pool_type, is_monthly_budget, rollover_strategy, sort_order) VALUES
            ('POOL_FIXED', '刚性固定', 'FIXED', 1, 'ACCUMULATE', 1),
            ('POOL_DAILY', '日常餐饮', 'DAILY', 1, 'ACCUMULATE', 2),
            ('POOL_FLEX', '机动灵活', 'FLEX', 1, 'ACCUMULATE', 3),
            ('POOL_EMERGENCY', '紧急备用', 'EMERGENCY', 1, 'ACCUMULATE', 4),
            ('POOL_FUND', '旧基金池', 'SINKING_FUND', 0, 'ACCUMULATE', 5),
            ('POOL_ASSET', '旧大额池', 'CAPITAL_ASSET', 0, 'ACCUMULATE', 6);
          INSERT INTO monthly_budgets (year_month, pool_id, base_allocation) VALUES
            ('2026-11', 'POOL_FUND', 0.00),
            ('2026-11', 'POOL_ASSET', 0.00);
          INSERT INTO categories (id, name, default_pool_id) VALUES
            ('CAT_FOOD', '饮食', 'POOL_DAILY'),
            ('CAT_EXAM_CERT', '考证教育', 'POOL_FUND');
          INSERT INTO projects_and_tags (id, name, tag_type, linked_pool_id, target_budget) VALUES
            ('TAG_JLPT_N2', 'JLPT N2', 'PROJECT', 'POOL_FUND', 600.00);
          INSERT INTO vouchers (id, title, voucher_type, face_value, acquire_cost, min_spend, status) VALUES
            (1, '旧还款券', 'REPAY_COUPON', 5.00, 0.00, 50.00, 'AVAILABLE');
          INSERT INTO transaction_headers (id, tx_date, tx_type, account_id, total_gross, total_net, merchant_or_note) VALUES
            ('tx_legacy_expense', '2026-11-10', 'EXPENSE', 'ACC_UNION_MAIN', 30.00, 30.00, '历史午餐'),
            ('tx_legacy_transfer', '2026-11-10', 'TRANSFER', 'ACC_UNION_MAIN', 100.00, 100.00, '历史还款');
          INSERT INTO transaction_items (header_id, item_name, category_id, budget_pool_id, item_gross, allocated_discount, item_net, is_primary_item) VALUES
            ('tx_legacy_expense', '午餐', 'CAT_FOOD', 'POOL_DAILY', 30.00, 0.00, 30.00, 1);
          INSERT INTO recurring_rules (id, title, rule_type, cron_cycle, trigger_day, amount, account_id, budget_pool_id) VALUES
            (1, '房租', 'FIXED_EXPENSE', 'MONTHLY', 1, 500.00, 'ACC_UNION_MAIN', 'POOL_FIXED'),
            (2, '定投基金', 'AUTO_INVEST', 'MONTHLY', 10, 300.00, 'ACC_UNION_MAIN', 'POOL_FUND');
          INSERT INTO sync_oplog (hlc, node_id, entity_type, entity_id, op_type, payload_json) VALUES
            ('000000000001000-0000-n1', 'n1', 'ACCOUNT', 'ACC_UNION_MAIN', 'UPSERT', '{}'),
            ('000000000001001-0000-n1', 'n1', 'TRANSACTION', 'tx_legacy_expense', 'UPSERT', '{}');
          INSERT INTO sync_meta (key, value) VALUES
            ('server_epoch_id', 'epoch_legacy_preserved_999');
        `);
        legacyDb.close();

        const repo = new LedgerRepository(tmpDbPath, 'migration-test-node');
        try {
          const tables = repo.db
            .prepare("SELECT name, type FROM sqlite_master WHERE name IN ('accounts', 'v_account_dashboard')")
            .all();
          expect(tables).toHaveLength(0);

          const txCols = (repo.db.prepare('PRAGMA table_info(transaction_headers)').all() as Array<{ name: string }>).map(
            (c) => c.name
          );
          expect(txCols).not.toContain('account_id');
          expect(txCols).not.toContain('target_account_id');

          const ruleCols = (repo.db.prepare('PRAGMA table_info(recurring_rules)').all() as Array<{ name: string }>).map(
            (c) => c.name
          );
          expect(ruleCols).not.toContain('account_id');
          expect(ruleCols).not.toContain('target_account_id');

          const txs = repo.db.prepare('SELECT id, merchant_or_note FROM transaction_headers').all() as Array<{
            id: string;
            merchant_or_note: string;
          }>;
          expect(txs).toHaveLength(1);
          expect(txs[0].id).toBe('tx_legacy_expense');
          expect(txs[0].merchant_or_note).toBe('历史午餐');

          const vouchers = repo.db.prepare('SELECT id, voucher_type FROM vouchers WHERE id = 1').get() as {
            id: number;
            voucher_type: string;
          };
          expect(vouchers.voucher_type).toBe('FREE_COUPON');

          const rules = repo.db.prepare('SELECT id, rule_type FROM recurring_rules').all() as Array<{
            id: number;
            rule_type: string;
          }>;
          expect(rules.some((r) => r.rule_type === 'AUTO_INVEST')).toBe(false);
          expect(rules.some((r) => r.id === 1 && r.rule_type === 'FIXED_EXPENSE')).toBe(true);

          const pools = repo.db.prepare('SELECT id FROM budget_pools').all() as Array<{ id: string }>;
          expect(pools.map((p) => p.id).sort()).toEqual([
            'POOL_DAILY',
            'POOL_EMERGENCY',
            'POOL_FIXED',
            'POOL_FLEX',
          ]);

          const tag = repo.db
            .prepare("SELECT linked_pool_id FROM projects_and_tags WHERE id = 'TAG_JLPT_N2'")
            .get() as { linked_pool_id: string };
          expect(tag.linked_pool_id).toBe('POOL_FLEX');

          const oplogs = repo.db.prepare('SELECT entity_type, entity_id FROM sync_oplog').all() as Array<{
            entity_type: string;
            entity_id: string;
          }>;
          expect(oplogs.some((o) => o.entity_type === 'ACCOUNT')).toBe(false);
          expect(oplogs.some((o) => o.entity_id === 'tx_legacy_expense')).toBe(true);

          const epoch = repo.db
            .prepare("SELECT value FROM sync_meta WHERE key = 'server_epoch_id'")
            .get() as { value: string };
          expect(epoch.value).toBe('epoch_legacy_preserved_999');

          const fkErrors = repo.db.prepare('PRAGMA foreign_key_check').all();
          expect(fkErrors).toHaveLength(0);
        } finally {
          repo.db.close();
        }
      } finally {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
        } catch {
          // Windows/sandbox temp dir handle cleanup fallback
        }
      }
    });
  });
});
