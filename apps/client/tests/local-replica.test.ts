import { describe, it, expect, beforeEach } from 'vitest';
import { LocalLedgerEngine, LOCAL_STORAGE_KEY } from '../src/sync/local-replica';
import { formatCny } from '@ledger/core';

describe('Stage 6: LocalLedgerEngine (纯前端本地优先账本副本引擎)', () => {
  let engine: LocalLedgerEngine;

  beforeEach(() => {
    // 重置内存存储与初始化纯净种子
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(LOCAL_STORAGE_KEY);
    }
    engine = new LocalLedgerEngine('test-client-node');
    engine.resetToSeed();
  });

  describe('1. 完整种子状态初始化', () => {
    it('应包含 PRD 规定的 8 个账户与正确初始余额', () => {
      expect(engine.state.accounts.length).toBe(8);

      const union = engine.state.accounts.find((a) => a.id === 'ACC_UNION_MAIN');
      expect(union?.book_balance).toBe('3000.00');

      const mcA = engine.state.accounts.find((a) => a.id === 'ACC_MC_DEBIT_A');
      expect(mcA?.book_balance).toBe('500.00');
      expect(mcA?.fx_hold_ratio).toBe('1.020');
      expect(mcA?.fx_cashback_rate).toBe('0.0100');

      const huabei = engine.state.accounts.find((a) => a.id === 'ACC_HUABEI');
      expect(huabei?.book_balance).toBe('-120.00');

      const etf = engine.state.accounts.find((a) => a.id === 'ACC_ALIPAY_ETF');
      expect(etf?.book_balance).toBe('600.00');
      expect(etf?.market_value).toBe('600.00');

      const dormant = engine.state.accounts.find((a) => a.id === 'ACC_DORMANT_01');
      expect(dormant?.is_folded).toBe(true);
    });

    it('应包含 6 个初始预算池与 2026-11 月度预算', () => {
      expect(engine.state.budgetPools.length).toBe(6);
      expect(engine.state.monthlyBudgets.length).toBe(6);

      const dailyPool = engine.state.budgetPools.find((p) => p.id === 'POOL_DAILY');
      expect(dailyPool?.rollover_strategy).toBe('SWEEP_TO_FUND');

      const dailyBudget = engine.state.monthlyBudgets.find(
        (b) => b.pool_id === 'POOL_DAILY' && b.year_month === '2026-11'
      );
      expect(dailyBudget?.base_allocation).toBe('650.00');
    });

    it('应包含 2 件初始固定资产与 2 张立减金', () => {
      expect(engine.state.fixedAssets.length).toBe(2);
      expect(engine.state.vouchers.length).toBe(2);
      expect(engine.state.vouchers[0].title).toBe('微信支付10元立减金');
      expect(engine.state.vouchers[0].status).toBe('AVAILABLE');
    });
  });

  describe('2. 纯前端离线 DSL 记账与实时分摊计算 (场景 1 & 场景 2)', () => {
    it('能解析并记账算式自含立减流 (场景 1)', () => {
      const rawDsl = '咸蛋黄拌面 16.8-0.15 + 饭卡充值 20-1.08*3 #饮食';
      const preview = engine.previewDsl(rawDsl);

      expect(preview.parsed.items.length).toBe(2);
      expect(preview.parsed.items[0].item_gross).toBe('16.80');
      expect(preview.parsed.items[0].item_net).toBe('16.65');
      expect(preview.parsed.items[1].item_gross).toBe('20.00');
      expect(preview.parsed.items[1].item_net).toBe('16.76');
      expect(preview.parsed.total_net).toBe('33.41');

      // 本地立即执行记账
      const tx = engine.recordFromDsl(rawDsl, '2026-11-12');
      expect(tx.header.total_net).toBe('33.41');
      expect(engine.state.transactions.length).toBe(1);
      expect(engine.state.oplogs.length).toBe(1);
      expect(engine.state.pendingSyncOps.length).toBe(1);

      // 验证扣款账户（默认花呗）余额由 -120.00 变为 -153.41
      const huabei = engine.state.accounts.find((a) => a.id === 'ACC_HUABEI');
      expect(huabei?.book_balance).toBe('-153.41');

      // 验证高频生活池预算被消耗
      const status = engine.getMonthlyBudgetStatus('2026-11');
      const dailyRow = status.find((s) => s.pool_id === 'POOL_DAILY');
      expect(dailyRow?.spent_net).toBe('33.41');
      expect(dailyRow?.remaining_budget).toBe('616.59');
    });

    it('能执行跨品类信用卡满减等比分摊与尾差吸收 (场景 2)', () => {
      const rawDsl = '牛奶 28 #饮食 + 晾衣架 12 #日用 + 排针 15 #电子 = 50 @招行信用卡';
      const tx = engine.recordFromDsl(rawDsl, '2026-11-12');

      expect(tx.header.account_id).toBe('ACC_CC_MAIN');
      expect(tx.header.total_gross).toBe('55.00');
      expect(tx.header.total_net).toBe('50.00');
      expect(tx.header.payment_discount).toBe('5.00');

      // 验证三项子明细分摊求和守恒 50.00
      const sumItemsNet = tx.items.reduce((s, it) => s + Number(it.item_net), 0);
      expect(sumItemsNet).toBe(50.00);

      // 验证招行信用卡当前欠款变为 -50.00
      const cc = engine.state.accounts.find((a) => a.id === 'ACC_CC_MAIN');
      expect(cc?.book_balance).toBe('-50.00');
    });
  });

  describe('3. 万事达外币预授权 102% 挂起与清算全生命周期 (场景 3)', () => {
    it('交易当下 102% 预授权挂起，冻结可用额度且账面余额不扣减', () => {
      const dsl = 'Porkbun域名 $4.35 冻结31.95 #数字服务 @万事达A';
      const preview = engine.previewDsl(dsl);
      expect(preview.should_wake_fx_account).toBe(true);

      const tx = engine.recordFromDsl(dsl, '2026-11-12');
      expect(tx.header.settlement_status).toBe('PENDING_HOLD');
      expect(tx.header.hold_amount_cny).toBe('31.95');

      // 万事达 A：原账面 500.00，预授权挂起时不扣 book_balance，仅占用 frozen 31.95，可用为 468.05
      const dashboard = engine.getAccountDashboard();
      const mcA = dashboard.find((a) => a.id === 'ACC_MC_DEBIT_A');
      expect(mcA?.book_balance).toBe('500.00');
      expect(mcA?.frozen_amount).toBe('31.95');
      expect(mcA?.available_balance).toBe('468.05');

      // 存在 1 笔待清算预警
      expect(engine.getPendingFxTransactions().length).toBe(1);
    });

    it('T+1/T+2 正式清算锁定：释放 102% 冻结、扣减实付、享受 1% 返现', () => {
      const dsl = 'Porkbun域名 $4.35 冻结31.95 #数字服务 @万事达A';
      const tx = engine.recordFromDsl(dsl, '2026-11-12');

      // 银行正式清算入账 31.20 元
      const settled = engine.settleMastercardPending(tx.header.id, '31.20');
      expect(settled.header.settlement_status).toBe('SETTLED');
      expect(settled.header.hold_amount_cny).toBe('0.00');
      expect(settled.header.total_gross).toBe('31.20');
      expect(settled.header.payment_discount).toBe('0.31'); // 1% 返现
      expect(settled.header.total_net).toBe('30.89'); // 31.20 - 0.31

      // 验证万事达 A 账户余额：
      // frozen 归零；实付扣减 30.89 => 500.00 - 30.89 = 469.11
      const dashboard = engine.getAccountDashboard();
      const mcA = dashboard.find((a) => a.id === 'ACC_MC_DEBIT_A');
      expect(mcA?.frozen_amount).toBe('0.00');
      expect(mcA?.book_balance).toBe('469.11');
      expect(mcA?.available_balance).toBe('469.11');

      // 待清算列表应清空
      expect(engine.getPendingFxTransactions().length).toBe(0);
    });
  });

  describe('4. 虚拟卡包购券与叠加核销', () => {
    it('能够购买立减金入库并正确扣除购券本金', () => {
      const res = engine.buyVoucher({
        title: '美团5元立减券',
        voucher_type: 'PREPAID_COUPON',
        face_value: '5.00',
        acquire_cost: '2.99',
        min_spend: '5.01',
        accountId: 'ACC_UNION_MAIN',
      });

      expect(res.voucher.title).toBe('美团5元立减券');
      expect(res.voucher.status).toBe('AVAILABLE');
      expect(engine.state.vouchers.length).toBe(3);

      // 验证扣款账户 ACC_UNION_MAIN 扣除成本 2.99 (3000.00 - 2.99 = 2997.01)
      const union = engine.state.accounts.find((a) => a.id === 'ACC_UNION_MAIN');
      expect(union?.book_balance).toBe('2997.01');
    });

    it('使用卡券记账时自动结转成本并标记 USED', () => {
      // 使用默认第 1 张卡券（面值 10 元，成本 5.99）
      const dsl = '塔斯汀汉堡 25 #饮食 @主力银联卡';
      const tx = engine.recordFromDsl(dsl, '2026-11-12', 1);

      // 验证卡券状态
      const v = engine.state.vouchers.find((it) => it.id === 1);
      expect(v?.status).toBe('USED');
      expect(v?.used_tx_id).toBe(tx.header.id);

      // 实付净额应结转购券成本 5.99：
      // 原价 25，用券后微信实付 15.00，加上购券成本 5.99 = 20.99
      expect(tx.header.total_net).toBe('20.99');
      expect(tx.header.payment_discount).toBe('4.01'); // 10.00 - 5.99 净省 4.01

      // 银联卡扣减实付 15.00 (购券成本 5.99 在购券时已扣，此处出资 15.00): 3000 - 15 = 2985.00
      const union = engine.state.accounts.find((a) => a.id === 'ACC_UNION_MAIN');
      expect(union?.book_balance).toBe('2985.00');
    });
  });

  describe('5. 高频生活池结余划转与固定资产回血', () => {
    it('能够将生活池结余一键划入考证专项基金池 (SWEEP_TO_FUND)', () => {
      // 产生少量生活消费 50 元
      engine.recordFromDsl('食堂大餐 50 #饮食 @主力银联卡', '2026-11-12');

      // POOL_DAILY 原 650.00，已用 50.00，剩余 600.00
      const sweepRes = engine.sweepDailyToFund('2026-11');
      expect(sweepRes.sweptAmount).toBe('600.00');

      // 划转后，POOL_DAILY 剩余结余应归零
      const statuses = engine.getMonthlyBudgetStatus('2026-11');
      const dailyRow = statuses.find((s) => s.pool_id === 'POOL_DAILY');
      expect(dailyRow?.remaining_budget).toBe('0.00');

      // POOL_FUND (原 800) 增加 600 滚存 => 1400.00
      const fundRow = statuses.find((s) => s.pool_id === 'POOL_FUND');
      expect(fundRow?.total_available_budget).toBe('1400.00');
    });

    it('登记二手回血后能大幅摊薄固定资产持有日均成本', () => {
      const assetsBefore = engine.getFixedAssetsWithCost('2026-11-12');
      const iphoneBefore = assetsBefore.find((a) => a.id === 1);
      expect(iphoneBefore).toBeDefined();

      // 登记转售回血 800 元
      engine.recordAssetResale(1, '800.00');

      const assetsAfter = engine.getFixedAssetsWithCost('2026-11-12');
      const iphoneAfter = assetsAfter.find((a) => a.id === 1);
      expect(iphoneAfter?.status).toBe('SOLD');
      expect(iphoneAfter?.resale_recovery).toBe('800.00');
      // 净成本由 1150 骤降为 350，日均成本显著降低
      expect(Number(iphoneAfter?.currentDailyCost)).toBeLessThan(
        Number(iphoneBefore?.currentDailyCost)
      );
    });
  });

  describe('6. 分布式并发冲突模拟与仲裁 & 全量恢复包导出', () => {
    it('能够模拟并发冲突并成功仲裁解决', () => {
      engine.recordFromDsl('咸蛋黄拌面 16.8 #饮食');
      const conflict = engine.simulateConcurrentConflict();

      expect(conflict).toBeDefined();
      expect(conflict.status).toBe('PENDING');
      expect(engine.state.conflicts.length).toBeGreaterThanOrEqual(1);

      // 执行仲裁：采纳 USE_LOSER
      const resolved = engine.resolveConflict(conflict.id, 'USE_LOSER');
      expect(resolved.status).toBe('RESOLVED');
    });

    it('能够导出符合格式的 FullSyncBundle 用于空库灾备反向恢复', () => {
      const bundle = engine.exportFullSyncBundle();
      expect(bundle.nodeId).toBe('test-client-node');
      expect(bundle.accounts.length).toBe(8);
      expect(bundle.vouchers.length).toBeGreaterThanOrEqual(2);
      expect(bundle.monthlyBudgets.length).toBe(6);
      expect(Array.isArray(bundle.oplogs)).toBe(true);
    });
  });
});
