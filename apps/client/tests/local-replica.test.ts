import { describe, it, expect, beforeEach } from 'vitest';
import { LocalLedgerEngine, LOCAL_STORAGE_KEY } from '../src/sync/local-replica';
import { formatCny, generateVoucherTitle } from '@ledger/core';

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

      for (const pid of ['POOL_FIXED', 'POOL_DAILY', 'POOL_FLEX', 'POOL_EMERGENCY']) {
        const pool = engine.state.budgetPools.find((p) => p.id === pid);
        expect(pool?.rollover_strategy).toBe('ACCUMULATE');
      }

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

  describe('6. 二期 Stage 8：纯净账本与全生命周期 CRUD 管理测试', () => {
    it('resetToCleanState() 应产生全 0 余额账户、0 卡券、0 固定资产与 0 交易流水', () => {
      engine.resetToCleanState();

      // 验证账户数量为 8，且初始余额、账面余额、冻结金额全为 0.00
      expect(engine.state.accounts.length).toBe(8);
      for (const acc of engine.state.accounts) {
        expect(acc.initial_balance).toBe('0.00');
        expect(acc.book_balance).toBe('0.00');
        expect(acc.frozen_amount).toBe('0.00');
        if (acc.account_role === 'INVESTMENT') {
          expect(acc.market_value).toBe('0.00');
        }
      }

      // 花呗账户没有默认的 -120.00 负债
      const huabei = engine.state.accounts.find((a) => a.id === 'ACC_HUABEI');
      expect(huabei?.book_balance).toBe('0.00');

      // 验证卡券、固定资产、专项项目与交易流水全部为空数组
      expect(engine.state.vouchers).toEqual([]);
      expect(engine.state.fixedAssets).toEqual([]);
      expect(engine.state.projectTags).toEqual([]);
      expect(engine.state.transactions).toEqual([]);
      expect(engine.state.recurringRules).toEqual([]);

      // 验证仅 4 个月度常规预算池 is_monthly_budget 为 true
      const monthlyPools = engine.state.budgetPools.filter((p) => p.is_monthly_budget);
      expect(monthlyPools.length).toBe(4);
      expect(monthlyPools.map((p) => p.id)).toEqual([
        'POOL_FIXED',
        'POOL_DAILY',
        'POOL_FLEX',
        'POOL_EMERGENCY',
      ]);
      for (const pool of monthlyPools) {
        expect(pool.rollover_strategy).toBe('ACCUMULATE');
      }
      // 验证已清理废置的 POOL_FUND 与 POOL_ASSET，仅保留 4 个月度常规预算池
      expect(engine.state.budgetPools.length).toBe(4);
      expect(engine.state.budgetPools.find((p) => p.id === 'POOL_FUND')).toBeUndefined();
      expect(engine.state.budgetPools.find((p) => p.id === 'POOL_ASSET')).toBeUndefined();
    });

    it('recordManualTransaction() 能在无 DSL 情况下准确录入支出、收入与转账', () => {
      engine.resetToCleanState();
      // 初始化借记卡本金为 1000 元
      engine.calibrateAccountBalance('ACC_UNION_MAIN', '1000.00');

      // 1. 录入支出 EXPENSE
      const expenseTx = engine.recordManualTransaction({
        tx_type: 'EXPENSE',
        tx_date: '2026-11-12',
        account_id: 'ACC_UNION_MAIN',
        amount: '45.00',
        discount: '5.00',
        category_id: 'CAT_FOOD',
        merchant_or_note: '老乡鸡午餐',
      });

      expect(expenseTx.header.total_gross).toBe('45.00');
      expect(expenseTx.header.payment_discount).toBe('5.00');
      expect(expenseTx.header.total_net).toBe('40.00');
      expect(expenseTx.items.length).toBe(1);
      expect(expenseTx.items[0].item_gross).toBe('45.00');
      expect(expenseTx.items[0].item_net).toBe('40.00');

      // 验证扣款账户余额：1000 - 40 = 960.00
      const unionAfterExpense = engine.state.accounts.find((a) => a.id === 'ACC_UNION_MAIN');
      expect(unionAfterExpense?.book_balance).toBe('960.00');

      // 验证 POOL_DAILY 预算消耗
      const status1 = engine.getMonthlyBudgetStatus('2026-11');
      const dailyRow = status1.find((s) => s.pool_id === 'POOL_DAILY');
      expect(dailyRow?.spent_net).toBe('40.00');

      // 2. 录入收入 INCOME
      const incomeTx = engine.recordManualTransaction({
        tx_type: 'INCOME',
        tx_date: '2026-11-12',
        account_id: 'ACC_UNION_MAIN',
        amount: '2000.00',
        merchant_or_note: '兼职家教课酬',
      });
      expect(incomeTx.header.total_net).toBe('2000.00');

      // 验证账户余额：960 + 2000 = 2960.00
      const unionAfterIncome = engine.state.accounts.find((a) => a.id === 'ACC_UNION_MAIN');
      expect(unionAfterIncome?.book_balance).toBe('2960.00');

      // 3. 录入内部转账 TRANSFER (充值饭卡)
      const transferTx = engine.recordManualTransaction({
        tx_type: 'TRANSFER',
        tx_date: '2026-11-12',
        account_id: 'ACC_UNION_MAIN',
        target_account_id: 'ACC_CAMPUS_CARD',
        amount: '100.00',
        merchant_or_note: '银联转账充值校园饭卡',
      });
      expect(transferTx.header.total_gross).toBe('100.00');
      expect(transferTx.header.total_net).toBe('100.00');

      // 验证银联卡扣减 100，饭卡增加 100
      const unionAfterTransfer = engine.state.accounts.find((a) => a.id === 'ACC_UNION_MAIN');
      const campusCard = engine.state.accounts.find((a) => a.id === 'ACC_CAMPUS_CARD');
      expect(unionAfterTransfer?.book_balance).toBe('2860.00');
      expect(campusCard?.book_balance).toBe('100.00');
    });

    it('updateTransaction() 与 deleteTransaction() 能精确重算余额并自动回退已核销优惠券', () => {
      engine.resetToCleanState();
      engine.calibrateAccountBalance('ACC_UNION_MAIN', '500.00');

      // 1. 创建一张立减金
      const { voucher } = engine.upsertVoucher({
        title: '外卖专享立减金',
        voucher_type: 'FREE_COUPON',
        face_value: '10.00',
        acquire_cost: '0.00',
        min_spend: '30.00',
      });
      expect(voucher.status).toBe('AVAILABLE');

      // 2. 录入交易并核销立减金
      const tx = engine.recordManualTransaction({
        tx_type: 'EXPENSE',
        tx_date: '2026-11-12',
        account_id: 'ACC_UNION_MAIN',
        amount: '35.00',
        category_id: 'CAT_FOOD',
        merchant_or_note: '达美乐比萨',
        applied_voucher_id: voucher.id,
      });

      expect(tx.header.total_gross).toBe('35.00');
      expect(tx.header.payment_discount).toBe('10.00');
      expect(tx.header.total_net).toBe('25.00');

      // 卡券状态变为 USED
      const usedVoucher = engine.state.vouchers.find((v) => v.id === voucher.id);
      expect(usedVoucher?.status).toBe('USED');
      expect(usedVoucher?.used_tx_id).toBe(tx.header.id);

      // 银联卡扣减实付 25.00: 500 - 25 = 475.00
      let union = engine.state.accounts.find((a) => a.id === 'ACC_UNION_MAIN');
      expect(union?.book_balance).toBe('475.00');

      // 3. 编辑交易：修改原价为 40.00，实付变为 30.00
      const updated = engine.updateTransaction(tx.header.id, {
        total_gross: '40.00',
        merchant_or_note: '达美乐大比萨+可乐',
      });
      expect(updated.header.total_gross).toBe('40.00');
      expect(updated.header.total_net).toBe('30.00');
      expect(updated.header.merchant_or_note).toBe('达美乐大比萨+可乐');

      union = engine.state.accounts.find((a) => a.id === 'ACC_UNION_MAIN');
      expect(union?.book_balance).toBe('470.00'); // 500 - 30 = 470.00

      // 4. 删除交易 deleteTransaction()
      const deleted = engine.deleteTransaction(tx.header.id);
      expect(deleted.header.is_deleted).toBe(true);

      // 验证余额恢复为 500.00
      union = engine.state.accounts.find((a) => a.id === 'ACC_UNION_MAIN');
      expect(union?.book_balance).toBe('500.00');

      // 验证卡券自动恢复为 AVAILABLE，且 used_tx_id 清空
      const restoredVoucher = engine.state.vouchers.find((v) => v.id === voucher.id);
      expect(restoredVoucher?.status).toBe('AVAILABLE');
      expect(restoredVoucher?.used_tx_id).toBeNull();
    });

    it('upsertAccount() 与 calibrateAccountBalance() 能精准校准账面余额与默认支付卡', () => {
      engine.resetToCleanState();

      // 1. 创建新自定义账户
      const customAcc = engine.upsertAccount({
        name: '招商银行储蓄卡(新卡)',
        account_role: 'DEBIT_MAIN',
        initial_balance: '123.45',
        is_default_pay: true,
      });

      expect(customAcc.id).toBeDefined();
      expect(customAcc.book_balance).toBe('123.45');
      expect(customAcc.is_default_pay).toBe(true);

      // 验证原默认卡花呗的 is_default_pay 被排他性清空
      const huabei = engine.state.accounts.find((a) => a.id === 'ACC_HUABEI');
      expect(huabei?.is_default_pay).toBe(false);

      // 2. 模拟真实世界账户平账校准 calibrateAccountBalance
      const calibrated = engine.calibrateAccountBalance(customAcc.id, '1000.00');
      expect(calibrated.book_balance).toBe('1000.00');
      expect(calibrated.initial_balance).toBe('1000.00');

      // 产生一笔支出 50.00，余额变为 950.00
      engine.recordManualTransaction({
        tx_type: 'EXPENSE',
        account_id: customAcc.id,
        amount: '50.00',
        merchant_or_note: '超市购物',
      });
      expect(engine.state.accounts.find((a) => a.id === customAcc.id)?.book_balance).toBe('950.00');

      // 再次平账校准至 1200.00（初始本金应自动吸收增量 250.00 变为 1250.00，重算后恰好等于 1200.00）
      engine.calibrateAccountBalance(customAcc.id, '1200.00');
      expect(engine.state.accounts.find((a) => a.id === customAcc.id)?.book_balance).toBe('1200.00');

      // 3. 验证删除有关联流水的账户会抛出友好的中文错误
      expect(() => engine.deleteAccount(customAcc.id)).toThrow(
        '账户存在关联交易流水，无法直接删除。请先清理或归档相关交易！'
      );

      // 4. 清理流水后再删除
      engine.deleteTransaction(engine.state.transactions[0].header.id);
      engine.deleteAccount(customAcc.id);
      expect(engine.state.accounts.find((a) => a.id === customAcc.id)).toBeUndefined();
    });

    it('upsertBudgetPool()、upsertMonthlyBudget()、upsertCategory()、upsertProjectTag()、upsertVoucher()与 executeRecurringRule() 全功能正常', () => {
      engine.resetToCleanState();
      engine.calibrateAccountBalance('ACC_UNION_MAIN', '3000.00');

      // 1. upsertBudgetPool() & upsertMonthlyBudget()
      const newPool = engine.upsertBudgetPool({
        name: '数码极客折腾池',
        pool_type: 'FLEX',
        is_monthly_budget: true,
        base_allocation: '350.00',
        description: '单片机、树莓派与传感器',
      });
      expect(newPool.id).toBeDefined();
      const mb = engine.state.monthlyBudgets.find(
        (b) => b.pool_id === newPool.id && b.year_month === '2026-11'
      );
      expect(mb?.base_allocation).toBe('350.00');

      // 2. upsertCategory()
      const newCat = engine.upsertCategory({
        name: '嵌入式开发套件',
        default_pool_id: newPool.id,
      });
      expect(newCat.id).toBeDefined();
      expect(newCat.default_pool_id).toBe(newPool.id);

      // 3. upsertProjectTag() 心愿目标
      const wishGoal = engine.upsertProjectTag({
        name: '心愿单：树莓派5代集群搭建',
        tag_type: 'PROJECT',
        target_budget: '1500.00',
        linked_pool_id: newPool.id,
      });
      expect(wishGoal.id).toBeDefined();
      expect(wishGoal.target_budget).toBe('1500.00');

      // 4. upsertVoucher() (有偿与免费)
      // 有偿购券 (5.00 买 10.00)
      const paidRes = engine.upsertVoucher({
        title: '某团外卖10元立减券',
        voucher_type: 'PREPAID_COUPON',
        face_value: '10.00',
        acquire_cost: '5.00',
        min_spend: '10.01',
        accountId: 'ACC_UNION_MAIN',
      });
      expect(paidRes.voucher.acquire_cost).toBe('5.00');
      expect(paidRes.tx).toBeDefined();
      expect(paidRes.tx?.header.tx_type).toBe('VOUCHER_BUY');
      // 银联卡扣减 5.00: 3000 - 5 = 2995.00
      expect(engine.state.accounts.find((a) => a.id === 'ACC_UNION_MAIN')?.book_balance).toBe('2995.00');

      // 免费领券 (0 元领券)
      const freeRes = engine.upsertVoucher({
        title: '免费领立减3元',
        voucher_type: 'FREE_COUPON',
        face_value: '3.00',
        acquire_cost: '0.00',
        min_spend: '20.00',
      });
      expect(freeRes.voucher.acquire_cost).toBe('0.00');
      expect(freeRes.tx).toBeUndefined();

      // 5. upsertRecurringRule() 与 executeRecurringRule()
      const rule = engine.upsertRecurringRule({
        title: '每月固网宽带费',
        rule_type: 'FIXED_EXPENSE',
        amount: '60.00',
        account_id: 'ACC_UNION_MAIN',
        budget_pool_id: 'POOL_FIXED',
      });
      expect(rule.id).toBeDefined();

      const executedTx = engine.executeRecurringRule(rule.id, '2026-11-12');
      expect(executedTx.header.total_gross).toBe('60.00');
      expect(executedTx.header.merchant_or_note).toBe('每月固网宽带费');
      expect(engine.state.accounts.find((a) => a.id === 'ACC_UNION_MAIN')?.book_balance).toBe('2935.00');
    });
  });

  // ==========================================================================
  // Stage 11: Phase 3 Logic Fixes & UX Simplification
  // ==========================================================================
  describe('Stage 11: Phase 3 Logic Fixes & UX Simplification', () => {
    it('recordManualTransaction with JPY 720 should convert to CNY ~34 and not add 720 to budget pool', () => {
      const engine = new LocalLedgerEngine('test-stage11-fx');
      engine.resetToSeed();

      const initialPoolStatus = engine.getMonthlyBudgetStatus('2026-11');
      const initialDailySpent = Number(
        initialPoolStatus.find((p) => p.pool_id === 'POOL_DAILY')?.spent_net ?? 0
      );

      const tx = engine.recordManualTransaction({
        tx_type: 'EXPENSE',
        account_id: 'ACC_MC_DEBIT_A',
        amount: '720',
        currency: 'JPY',
        merchant_or_note: 'Gemini Pro会员',
        budget_pool_id: 'POOL_DAILY',
      });

      expect(tx.header.original_currency).toBe('JPY');
      expect(tx.header.original_amount).toBe('720.00');
      expect(tx.header.exchange_rate).toBe('0.048000');
      // 720 * 0.048 * 1.02 = 35.2512 -> 35.25
      expect(tx.header.hold_amount_cny).toBe('35.25');
      // base = 35.25 / 1.02 = 34.56, cashback = 0.35, net = 34.21
      expect(tx.header.total_gross).toBe('34.56');
      expect(tx.header.payment_discount).toBe('0.35');
      expect(tx.header.total_net).toBe('34.21');
      expect(tx.items[0].item_net).toBe('34.21');

      // Check account frozen amount: increased by 35.25, NOT 734.40
      const mcAcc = engine.state.accounts.find((a) => a.id === 'ACC_MC_DEBIT_A');
      expect(mcAcc?.frozen_amount).toBe('35.25');

      // Check budget pool: spent increased by 34.21, NEVER 720.00!
      const afterPoolStatus = engine.getMonthlyBudgetStatus('2026-11');
      const afterDailySpent = Number(
        afterPoolStatus.find((p) => p.pool_id === 'POOL_DAILY')?.spent_net ?? 0
      );
      expect((afterDailySpent - initialDailySpent).toFixed(2)).toBe('34.21');
    });

    it('an expense with project_tag_id should only deduct from project and NEVER from any monthly budget pool', () => {
      const engine = new LocalLedgerEngine('test-stage11-mutex');
      engine.resetToSeed();

      // Create a wish goal / project tag
      const project = engine.upsertProjectTag({
        name: '去天津考试',
        target_budget: '500.00',
        tag_type: 'PROJECT',
      });

      const initialStatuses = engine.getMonthlyBudgetStatus('2026-11');
      const initialTotalSpent = initialStatuses.reduce(
        (sum, s) => sum + Number(s.spent_net),
        0
      );

      // Record an expense with project_tag_id
      const tx = engine.recordManualTransaction({
        tx_type: 'EXPENSE',
        account_id: 'ACC_UNION_MAIN',
        amount: '114.00',
        merchant_or_note: '火车票',
        budget_pool_id: 'POOL_DAILY', // even if a pool was internally linked/passed
        project_tag_id: project.id,
      });

      expect(tx.items[0].project_tag_id).toBe(project.id);

      // Monthly budget status must NOT deduct this 114.00 from POOL_DAILY or any monthly pool!
      const afterStatuses = engine.getMonthlyBudgetStatus('2026-11');
      const afterTotalSpent = afterStatuses.reduce(
        (sum, s) => sum + Number(s.spent_net),
        0
      );
      expect(afterTotalSpent).toBe(initialTotalSpent);

      const dailyRow = afterStatuses.find((s) => s.pool_id === 'POOL_DAILY');
      const initialDailyRow = initialStatuses.find((s) => s.pool_id === 'POOL_DAILY');
      expect(dailyRow?.spent_net).toBe(initialDailyRow?.spent_net);

      // But project tracking should reflect the 114.00 spent
      const relatedTxs = engine.state.transactions.filter(
        (t) => !t.header.is_deleted && t.items.some((it) => it.project_tag_id === project.id)
      );
      expect(relatedTxs).toHaveLength(1);
      expect(relatedTxs[0].items[0].item_net).toBe('114.00');
    });

    it('should auto-repair existing bugged PENDING_HOLD foreign transaction on recalculateAllBalances', () => {
      const engine = new LocalLedgerEngine('test-stage11-repair');
      engine.resetToSeed();

      // Inject a bugged transaction from the old version
      const buggedTx = {
        header: {
          id: 'tx_old_bugged_01',
          tx_date: '2026-11-12',
          tx_timestamp: new Date().toISOString(),
          tx_type: 'EXPENSE' as const,
          account_id: 'ACC_MC_DEBIT_A',
          target_account_id: null,
          total_gross: '720.00',
          platform_discount: '0.00',
          payment_discount: '0.00',
          total_net: '720.00', // Bug: raw JPY directly in total_net
          allocation_mode: 'SINGLE' as const,
          original_currency: 'JPY',
          original_amount: '720.00',
          exchange_rate: null, // Bug: exchange_rate was null
          settlement_status: 'PENDING_HOLD' as const,
          hold_amount_cny: '734.40',
          settled_at: null,
          raw_input_text: '手动录入：Gemini Pro 720',
          merchant_or_note: 'Gemini Pro',
          applied_voucher_id: null,
          is_deleted: false,
          updated_hlc: engine.hlc.now(),
          created_at: new Date().toISOString(),
        },
        items: [
          {
            id: 1,
            header_id: 'tx_old_bugged_01',
            item_name: 'Gemini Pro',
            category_id: 'CAT_DIGITAL_SUB',
            budget_pool_id: 'POOL_FLEX',
            project_tag_id: null,
            item_gross: '720.00',
            allocated_discount: '0.00',
            item_net: '720.00',
            is_primary_item: true,
            raw_formula_expr: null,
          },
        ],
        appliedVoucherId: null,
      };

      engine.state.transactions.unshift(buggedTx);

      // Trigger recalculation
      engine.recalculateAllBalances();

      // Verify the transaction was auto-repaired
      expect(buggedTx.header.exchange_rate).toBe('0.048000');
      expect(buggedTx.header.hold_amount_cny).toBe('35.25');
      expect(buggedTx.header.total_gross).toBe('34.56');
      expect(buggedTx.header.payment_discount).toBe('0.35');
      expect(buggedTx.header.total_net).toBe('34.21');
      expect(buggedTx.items[0].item_net).toBe('34.21');

      // Check account frozen amount
      const mcAcc = engine.state.accounts.find((a) => a.id === 'ACC_MC_DEBIT_A');
      expect(mcAcc?.frozen_amount).toBe('35.25');
    });
  });

  describe('Stage 12: Voucher min_spend, Type Validation & TRANSFER with REPAY_COUPON', () => {
    it('Voucher min_spend 验证：消费金额小于门槛时抛出异常，达到或超过门槛时成功录入', () => {
      const { voucher } = engine.upsertVoucher({
        title: '满50减5优惠券',
        voucher_type: 'FREE_COUPON',
        face_value: '5.00',
        acquire_cost: '0.00',
        min_spend: '50.00',
      });

      // 1. 30.00 < 50.00 应抛出门槛未达异常
      expect(() => {
        engine.recordManualTransaction({
          tx_type: 'EXPENSE',
          account_id: 'ACC_UNION_MAIN',
          amount: '30.00',
          merchant_or_note: '超市购物',
          applied_voucher_id: voucher.id,
        });
      }).toThrow('未达到优惠券「满50减5优惠券」的最低使用门槛（需满 ¥50.00，当前金额 ¥30.00）');

      // 2. 50.00 >= 50.00 应成功录入且抵扣 5.00
      const tx = engine.recordManualTransaction({
        tx_type: 'EXPENSE',
        account_id: 'ACC_UNION_MAIN',
        amount: '50.00',
        merchant_or_note: '超市大采购',
        applied_voucher_id: voucher.id,
      });

      expect(tx.header.total_gross).toBe('50.00');
      expect(tx.header.payment_discount).toBe('5.00');
      expect(tx.header.total_net).toBe('45.00');
      expect(engine.state.vouchers.find((v) => v.id === voucher.id)?.status).toBe('USED');
    });

    it('TRANSFER 交易使用 REPAY_COUPON：扣减面值，实付扣除，并标记券为 USED', () => {
      const { voucher } = engine.upsertVoucher({
        title: '满50减5还款券',
        voucher_type: 'REPAY_COUPON',
        face_value: '5.00',
        acquire_cost: '0.00',
        min_spend: '50.00',
      });

      // 尝试在 EXPENSE 中使用 REPAY_COUPON 应抛出异常
      expect(() => {
        engine.recordManualTransaction({
          tx_type: 'EXPENSE',
          account_id: 'ACC_UNION_MAIN',
          amount: '60.00',
          merchant_or_note: '普通消费',
          applied_voucher_id: voucher.id,
        });
      }).toThrow('还款专用券仅限在「转账/还款」中使用');

      // 在 TRANSFER 中使用且金额低于门槛应抛出异常
      expect(() => {
        engine.recordManualTransaction({
          tx_type: 'TRANSFER',
          account_id: 'ACC_UNION_MAIN',
          target_account_id: 'ACC_HUABEI',
          amount: '40.00',
          merchant_or_note: '花呗还款',
          applied_voucher_id: voucher.id,
        });
      }).toThrow('未达到优惠券「满50减5还款券」的最低使用门槛（需满 ¥50.00，当前金额 ¥40.00）');

      // 正常还款 100.00，使用 5 元还款券
      const initialUnionBal = engine.state.accounts.find((a) => a.id === 'ACC_UNION_MAIN')?.book_balance;
      const initialHuabeiBal = engine.state.accounts.find((a) => a.id === 'ACC_HUABEI')?.book_balance;

      const tx = engine.recordManualTransaction({
        tx_type: 'TRANSFER',
        account_id: 'ACC_UNION_MAIN',
        target_account_id: 'ACC_HUABEI',
        amount: '100.00',
        merchant_or_note: '还花呗',
        applied_voucher_id: voucher.id,
      });

      expect(tx.header.total_gross).toBe('100.00');
      expect(tx.header.payment_discount).toBe('5.00');
      expect(tx.header.total_net).toBe('95.00');
      expect(engine.state.vouchers.find((v) => v.id === voucher.id)?.status).toBe('USED');

      // 验证全账本余额重算：转出账户扣 95.00，目标账户还款入账 100.00
      const union = engine.state.accounts.find((a) => a.id === 'ACC_UNION_MAIN');
      const huabei = engine.state.accounts.find((a) => a.id === 'ACC_HUABEI');
      expect(union?.book_balance).toBe(formatCny(Number(initialUnionBal) - 95));
      expect(huabei?.book_balance).toBe(formatCny(Number(initialHuabeiBal) + 100));
    });

    it('generateVoucherTitle 能够根据类型与门槛正确自动生成卡券名称', () => {
      // REPAY_COUPON
      expect(generateVoucherTitle('REPAY_COUPON', '5.00', '50.00')).toBe('满50减5还款券');
      expect(generateVoucherTitle('REPAY_COUPON', '10.00', '0.00')).toBe('10元无门槛还款券');
      // PREPAID_COUPON
      expect(generateVoucherTitle('PREPAID_COUPON', '10.00', '30.00')).toBe('满30减10立减金');
      expect(generateVoucherTitle('PREPAID_COUPON', '10.00', '0.00')).toBe('10元无门槛立减金');
      // FREE_COUPON
      expect(generateVoucherTitle('FREE_COUPON', '20.00', '100.00')).toBe('满100减20优惠券');
      expect(generateVoucherTitle('FREE_COUPON', '5.00', '0.00')).toBe('5元无门槛优惠券');
    });

    it('upsertVoucher/buyVoucher 在未传 title 时能自动生成卡券名称', () => {
      const { voucher: v1 } = engine.upsertVoucher({
        voucher_type: 'PREPAID_COUPON',
        face_value: '10.00',
        acquire_cost: '0.00',
        min_spend: '30.00',
      });
      expect(v1.title).toBe('满30减10立减金');

      const { voucher: v2 } = engine.buyVoucher({
        voucher_type: 'PREPAID_COUPON',
        face_value: '20.00',
        acquire_cost: '15.00',
        min_spend: '50.00',
        accountId: 'ACC_UNION_MAIN',
      });
      expect(v2.title).toBe('满50减20立减金');
    });

    it('buyVoucher 创建的 VOUCHER_BUY 流水 total_net 为 acquire_cost，删除该流水自动级联删除卡券并还原账户余额', () => {
      const initialUnion = engine.state.accounts.find((a) => a.id === 'ACC_UNION_MAIN');
      const initialBalance = Number(initialUnion?.book_balance || 0);

      // 1. 购入一张面值 10.00 元，成本 5.99 元的立减金
      const { voucher, tx } = engine.buyVoucher({
        title: '美团外卖10元立减券',
        voucher_type: 'PREPAID_COUPON',
        face_value: '10.00',
        acquire_cost: '5.99',
        min_spend: '10.01',
        accountId: 'ACC_UNION_MAIN',
      });

      // 验证 VOUCHER_BUY 流水账单字段：实付与票面金额一致，不提前虚构折扣
      expect(tx.header.tx_type).toBe('VOUCHER_BUY');
      expect(tx.header.total_gross).toBe('5.99');
      expect(tx.header.platform_discount).toBe('0.00');
      expect(tx.header.payment_discount).toBe('0.00');
      expect(tx.header.total_net).toBe('5.99');

      // 验证卡券在卡包中
      expect(engine.state.vouchers.some((v) => v.id === voucher.id)).toBe(true);

      // 验证扣除现金成本 5.99
      const afterBuyUnion = engine.state.accounts.find((a) => a.id === 'ACC_UNION_MAIN');
      expect(Number(afterBuyUnion?.book_balance)).toBeCloseTo(initialBalance - 5.99, 2);

      // 2. 删除该 VOUCHER_BUY 交易流水
      engine.deleteTransaction(tx.header.id);

      // 验证卡券自动从卡包中级联删除
      expect(engine.state.vouchers.some((v) => v.id === voucher.id)).toBe(false);

      // 验证账户余额恢复如初
      const afterDeleteUnion = engine.state.accounts.find((a) => a.id === 'ACC_UNION_MAIN');
      expect(Number(afterDeleteUnion?.book_balance)).toBeCloseTo(initialBalance, 2);
    });
  });

  describe('9. JSON 备份导入导出与废置池清理', () => {
    it('exportFullSyncBundle + importFullSyncBundle 应完整恢复流水、预算池与优惠券，并过滤未引用的废置池', () => {
      engine.resetToCleanState();
      engine.recordManualTransaction({
        tx_type: 'EXPENSE',
        tx_date: '2026-11-15',
        account_id: 'ACC_UNION_MAIN',
        amount: '28.50',
        budget_pool_id: 'POOL_DAILY',
        merchant_or_note: '晚餐备份测试',
      });
      engine.upsertVoucher({
        voucher_type: 'FREE_COUPON',
        face_value: '5.00',
        acquire_cost: '0.00',
        min_spend: '20.00',
      });

      const exported = engine.exportFullSyncBundle();
      // 模拟旧备份中含有未被引用的废置池
      exported.budgetPools = [
        ...(exported.budgetPools || []),
        {
          id: 'POOL_FUND',
          name: '年度专项考证基金池',
          pool_type: 'SINKING_FUND',
          is_monthly_budget: false,
          rollover_strategy: 'ACCUMULATE',
          description: '旧版考证专项池',
          sort_order: 50,
        },
        {
          id: 'POOL_ASSET',
          name: '数码大件固定资产库',
          pool_type: 'CAPITAL_ASSET',
          is_monthly_budget: false,
          rollover_strategy: 'ACCUMULATE',
          description: '旧版资产池',
          sort_order: 60,
        },
      ];

      // 重置为空白账本后导入备份
      engine.resetToCleanState();
      expect(engine.state.transactions.length).toBe(0);
      expect(engine.state.vouchers.length).toBe(0);

      const summary = engine.importFullSyncBundle(exported);
      expect(summary.transactionsCount).toBe(1);
      expect(summary.poolsCount).toBe(4);
      expect(summary.vouchersCount).toBe(1);

      expect(engine.state.transactions[0].header.merchant_or_note).toBe('晚餐备份测试');
      expect(engine.state.vouchers.length).toBe(1);
      expect(engine.state.budgetPools.find((p) => p.id === 'POOL_FUND')).toBeUndefined();
      expect(engine.state.budgetPools.find((p) => p.id === 'POOL_ASSET')).toBeUndefined();
      expect(engine.state.pendingSyncOps.length).toBe(engine.state.oplogs.length);
    });

    it('importFullSyncBundle 传入无效对象时应抛出清晰错误提示', () => {
      expect(() => engine.importFullSyncBundle({})).toThrow(/缺少账本核心数据/);
    });
  });
});
