import { describe, it, expect } from 'vitest';
import { LedgerRepository } from '../src/ledger-repository.js';
import { Decimal, roundCny, formatCny } from '@ledger/core';

describe('Stage 4: @ledger/db SQLite Layer & LedgerRepository Integration Tests', () => {
  // --------------------------------------------------------------------------
  // 测试 1：TRANSFER 隔离定律与指数基金浮动盈亏
  // --------------------------------------------------------------------------
  describe('1. TRANSFER Isolation Law & Investment Unrealized PnL', () => {
    it('should NOT deduct monthly budget pools when executing transfers (repay credit, recharge card, ETF invest), while correctly accumulating cost basis and unrealized PnL', () => {
      const repo = new LedgerRepository(':memory:', 'node-transfer-test');

      // 初始化各账户本金
      repo.setAccountInitialBalance('ACC_UNION_MAIN', '2000.00');
      repo.setAccountInitialBalance('ACC_HUABEI', '-500.00'); // 花呗待还负债 500 元
      repo.setAccountInitialBalance('ACC_CAMPUS_CARD', '0.00');
      repo.setAccountInitialBalance('ACC_ALIPAY_ETF', '0.00');

      // 1. 偿还花呗：使用 5 元还款券（券 ID 2）
      // 银联卡实际出资 495.00，花呗负债冲销 500.00
      const repayTx = repo.recordFromDsl(
        '还款 @花呗 500 - 还款券 5 从 @主力银联卡',
        '2026-11-02',
        2
      );
      expect(repayTx.header.tx_type).toBe('TRANSFER');
      expect(repayTx.header.total_gross).toBe('500.00');
      expect(repayTx.header.payment_discount).toBe('5.00');
      expect(repayTx.header.total_net).toBe('495.00');

      // 2. 充值校园饭卡 100 元
      const rechargeTx = repo.recordFromDsl(
        '转账 @校园饭卡 100 从 @主力银联卡',
        '2026-11-03'
      );
      expect(rechargeTx.header.tx_type).toBe('TRANSFER');
      expect(rechargeTx.header.total_net).toBe('100.00');

      // 3. 支付宝指数基金定投 60 元
      const investTx = repo.recordFromDsl(
        '转账 @支付宝指数基金定投 60 从 @主力银联卡',
        '2026-11-04'
      );
      expect(investTx.header.tx_type).toBe('TRANSFER');
      expect(investTx.header.total_gross).toBe('60.00');
      expect(investTx.header.total_net).toBe('60.00');

      // 验证账户看板：银联卡余额 = 2000 - 495 - 100 - 60 = 1345.00
      // 花呗余额 = -500 + 500 = 0.00
      // 饭卡余额 = 0 + 100 = 100.00
      // 指数基金本金 = 0 + 60 = 60.00
      const dashboard1 = repo.getAccountDashboard();
      const unionAcc = dashboard1.find((a) => a.id === 'ACC_UNION_MAIN')!;
      const huabeiAcc = dashboard1.find((a) => a.id === 'ACC_HUABEI')!;
      const campusAcc = dashboard1.find((a) => a.id === 'ACC_CAMPUS_CARD')!;
      const etfAcc = dashboard1.find((a) => a.id === 'ACC_ALIPAY_ETF')!;

      expect(unionAcc.book_balance).toBe('1345.00');
      expect(huabeiAcc.book_balance).toBe('0.00');
      expect(campusAcc.book_balance).toBe('100.00');
      expect(etfAcc.book_balance).toBe('60.00');
      expect(etfAcc.unrealized_pnl).toBe('0.00'); // 尚未更新市值

      // 月底手动更新指数基金市值为 65.00 元（浮盈 5.00 元）
      const updatedEtf = repo.updateInvestmentMarketValue(
        'ACC_ALIPAY_ETF',
        '65.00'
      );
      expect(updatedEtf.market_value).toBe('65.00');
      expect(updatedEtf.unrealized_pnl).toBe('5.00');

      // 严格验证 PRD 1.2「收支与转账隔离原则」：
      // 内部转账绝不二次扣减常规消费预算，常规月度池 spent_net 严格为 "0.00"！
      const budgetStatus = repo.getMonthlyBudgetStatus('2026-11');
      const regularPools = budgetStatus.pools.filter((p) =>
        ['POOL_FIXED', 'POOL_DAILY', 'POOL_FLEX', 'POOL_EMERGENCY'].includes(
          p.pool_id
        )
      );

      for (const pool of regularPools) {
        expect(pool.spent_net).toBe('0.00');
        expect(pool.spent_gross).toBe('0.00');
      }
      expect(budgetStatus.totalMonthlySpent).toBe('0.00');
    });
  });

  // --------------------------------------------------------------------------
  // 测试 2：万事达外币预授权双轨余额流转
  // --------------------------------------------------------------------------
  describe('2. Mastercard CN Debit FX Dual-Track Balance & Lifecycle', () => {
    it('should maintain book_balance unchanged and freeze 102% in PENDING_HOLD, then release freeze and deduct settled net with 1% cashback in SETTLED', () => {
      const repo = new LedgerRepository(':memory:', 'node-mc-fx-test');

      // 设置万事达借记卡 A 初始余额 200.00
      repo.setAccountInitialBalance('ACC_MC_DEBIT_A', '200.00');

      // 1. 录入外币预授权消费：Porkbun域名 $4.35 冻结31.95 #数字服务 @万事达A
      const holdTx = repo.recordFromDsl(
        'Porkbun域名 $4.35 冻结31.95 #数字服务 @万事达A',
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

      // 验证挂起态账户双轨余额：
      // book_balance 保持 200.00 不变，frozen_amount = 31.95，available_balance = 200 - 31.95 = 168.05
      const dashboardHold = repo.getAccountDashboard();
      const mcHold = dashboardHold.find((a) => a.id === 'ACC_MC_DEBIT_A')!;
      expect(mcHold.book_balance).toBe('200.00');
      expect(mcHold.frozen_amount).toBe('31.95');
      expect(mcHold.available_balance).toBe('168.05');

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

      // 验证清算后账户状态：
      // frozen_amount 彻底释放为 0.00，book_balance = 200.00 - 30.89 = 169.11，available_balance = 169.11
      const dashboardSettled = repo.getAccountDashboard();
      const mcSettled = dashboardSettled.find((a) => a.id === 'ACC_MC_DEBIT_A')!;
      expect(mcSettled.frozen_amount).toBe('0.00');
      expect(mcSettled.book_balance).toBe('169.11');
      expect(mcSettled.available_balance).toBe('169.11');

      // 验证预算池净支出自动修正为 30.89
      const budgetSettled = repo.getMonthlyBudgetStatus('2026-11');
      const flexSettled = budgetSettled.pools.find(
        (p) => p.pool_id === 'POOL_FLEX'
      )!;
      expect(flexSettled.spent_net).toBe('30.89');
    });
  });

  // --------------------------------------------------------------------------
  // 测试 3：有偿立减金购券入库与食堂消费核销闭环
  // --------------------------------------------------------------------------
  describe('3. Prepaid Voucher Buying and Canteen Redemption Closed-Loop', () => {
    it('should accurately carry over acquire cost (5.99) with cash (5.00) totaling 10.99 net spent, while crediting 4.01 savings', () => {
      const repo = new LedgerRepository(':memory:', 'node-voucher-test');

      // 设置银联卡初始余额 500.00
      repo.setAccountInitialBalance('ACC_UNION_MAIN', '500.00');

      // 1. 花费 5.99 元购买一张面值 10.00 元的微信立减金（门槛 10.01 元）
      const { voucher } = repo.buyVoucher({
        accountId: 'ACC_UNION_MAIN',
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

      // 验证购券后银联卡账户已扣款 5.99 元：500.00 - 5.99 = 494.01
      const dashAfterBuy = repo.getAccountDashboard();
      const unionAfterBuy = dashAfterBuy.find(
        (a) => a.id === 'ACC_UNION_MAIN'
      )!;
      expect(unionAfterBuy.book_balance).toBe('494.01');

      // 验证购券不占用月度餐饮预算池
      const budgetAfterBuy = repo.getMonthlyBudgetStatus('2026-11');
      const dailyAfterBuy = budgetAfterBuy.pools.find(
        (p) => p.pool_id === 'POOL_DAILY'
      )!;
      expect(dailyAfterBuy.spent_net).toBe('0.00');

      // 2. 在食堂消费原价 15.00 元，现场勾选核销该 10 元立减金（现场微信实付 5.00 元）
      const canteenTx = repo.recordFromDsl(
        '食堂 15 #饮食 @主力银联卡',
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

      // 验证账户余额闭环：
      // 购券扣 5.99，本次食堂现场扣 5.00，累计共扣 10.99，账户最终余额 = 500.00 - 10.99 = 489.01！
      const dashAfterSpend = repo.getAccountDashboard();
      const unionAfterSpend = dashAfterSpend.find(
        (a) => a.id === 'ACC_UNION_MAIN'
      )!;
      expect(unionAfterSpend.book_balance).toBe('489.01');

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
  // 测试 4：高频池今日动态日均可用额度与月末一键归集 (SWEEP_TO_FUND)
  // --------------------------------------------------------------------------
  describe('4. Dynamic Daily Remaining Budget & Sweep to Sinking Fund', () => {
    it('should compute remaining daily budget correctly based on current date, and sweep positive balance into POOL_FUND', () => {
      const repo = new LedgerRepository(':memory:', 'node-daily-sweep-test');

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

      // 假设月末结算，饮食池最终结余 570.00 元，执行一键划入「年度专项基金池 (POOL_FUND)」
      const sweepResult = repo.sweepDailyPoolToSinkingFund('2026-11');
      expect(sweepResult.sweptAmount).toBe('570.00');
      expect(sweepResult.dailyPoolRemaining).toBe('0.00');
      // 原专项基金初始 800.00，归集后总可用 = 800 + 570 = 1370.00
      expect(sweepResult.fundPoolTotal).toBe('1370.00');

      // 验证归集后 11 月看板状态：高频生活池剩余清零，专项基金池水位上涨
      const statusAfterSweep = repo.getMonthlyBudgetStatus('2026-11');
      const dailyPoolAfter = statusAfterSweep.pools.find(
        (p) => p.pool_id === 'POOL_DAILY'
      )!;
      const fundPoolAfter = statusAfterSweep.pools.find(
        (p) => p.pool_id === 'POOL_FUND'
      )!;

      expect(dailyPoolAfter.remaining_budget).toBe('0.00');
      expect(fundPoolAfter.total_available_budget).toBe('1370.00');

      // 执行跨月结转至 2026-12：
      // POOL_DAILY (已全额划转清零，剩余 0.00): 滚入 0.00
      // POOL_FIXED (默认 ACCUMULATE，剩余 204.00): 滚入 204.00
      // POOL_FLEX (ACCUMULATE，剩余 450.00): 滚入 450.00
      const nextMonthPools = repo.executeMonthRollover('2026-11', '2026-12');
      const decDaily = nextMonthPools.find((p) => p.pool_id === 'POOL_DAILY')!;
      const decFixed = nextMonthPools.find((p) => p.pool_id === 'POOL_FIXED')!;
      const decFlex = nextMonthPools.find((p) => p.pool_id === 'POOL_FLEX')!;

      expect(decDaily.rollover_from_prev).toBe('0.00');
      expect(decFixed.rollover_from_prev).toBe('204.00');
      expect(decFlex.rollover_from_prev).toBe('450.00');

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
  // 测试 5：双节点离线因果一致性收敛与全量冷备恢复
  // --------------------------------------------------------------------------
  describe('5. Multi-Node Offline Sync Convergence & Reseed From Bundle', () => {
    it('should converge to 100% identical state regardless of message delivery order, and support complete disaster recovery via reseedFromBundle', () => {
      // 创建两个独立节点
      const repoA = new LedgerRepository(':memory:', 'node-alpha');
      const repoB = new LedgerRepository(':memory:', 'node-beta');

      repoA.setAccountInitialBalance('ACC_UNION_MAIN', '1000.00');
      repoB.setAccountInitialBalance('ACC_UNION_MAIN', '1000.00');

      // 节点 A 离线记账两笔
      repoA.recordFromDsl('华莱士 30 #饮食 @主力银联卡', '2026-11-05');
      repoA.recordFromDsl('短袖 50 #服饰 @主力银联卡', '2026-11-06');

      // 节点 B 离线记账两笔
      repoB.recordFromDsl('理发 20 #通信 @主力银联卡', '2026-11-07');
      repoB.recordFromDsl('开发板 60 #电子 @主力银联卡', '2026-11-08');

      // 互相交换操作日志（A 按反向顺序应用 B 的操作，B 正常应用 A 的操作）
      const opsA = repoA.getOpLogs();
      const opsB = repoB.getOpLogs();
      const opsBReversed = [...opsB].reverse();

      repoA.applyRemoteOpLogs(opsBReversed);
      repoB.applyRemoteOpLogs(opsA);

      // 验证双节点达到 100% 强一致性收敛！
      const dashA = repoA.getAccountDashboard();
      const dashB = repoB.getAccountDashboard();
      expect(dashA).toEqual(dashB);

      const budgetA = repoA.getMonthlyBudgetStatus('2026-11');
      const budgetB = repoB.getMonthlyBudgetStatus('2026-11');
      expect(budgetA.totalMonthlySpent).toBe('160.00'); // 30 + 50 + 20 + 60 = 160.00
      expect(budgetA.totalMonthlySpent).toBe(budgetB.totalMonthlySpent);
      expect(budgetA.pools).toEqual(budgetB.pools);

      // 模拟服务器炸机空库后从客户端完整快照包 100% 恢复
      const bundle = repoA.exportFullSyncBundle();
      const freshRepo = new LedgerRepository(':memory:', 'crashed-recovered-node');

      freshRepo.reseedFromBundle(bundle);

      expect(freshRepo.getAccountDashboard()).toEqual(dashA);
      expect(freshRepo.getMonthlyBudgetStatus('2026-11')).toEqual(budgetA);
    });
  });

  // --------------------------------------------------------------------------
  // 额外测试：固定资产日均成本追踪与守恒定律断言防御
  // --------------------------------------------------------------------------
  describe('6. Fixed Asset Cost Per Day & Conservation Defense', () => {
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
            account_id: 'ACC_UNION_MAIN',
            target_account_id: null,
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
  });
});
