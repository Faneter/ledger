import { describe, it, expect } from 'vitest';
import {
  evaluateMathFormula,
  parseQuickInputDsl,
  DEFAULT_CATEGORIES,
  DEFAULT_ACCOUNTS,
  DEFAULT_PROJECT_TAGS,
} from '../src/dsl-parser.js';

describe('Stage 3: Quick-Parse Input DSL Compiler (极速公式与自然语言解析器)', () => {
  // ==========================================================================
  // 1. 种子字典常量校验 (PRD 12.1 ~ 12.4)
  // ==========================================================================
  describe('Seed Constants (PRD 12.1 ~ 12.4 对齐校验)', () => {
    it('DEFAULT_CATEGORIES should cover all 14 categories with correct pools and keywords', () => {
      expect(DEFAULT_CATEGORIES).toHaveLength(14);

      const food = DEFAULT_CATEGORIES.find((c) => c.id === 'CAT_FOOD');
      expect(food).toBeDefined();
      expect(food?.name).toBe('餐饮零食与水饮');
      expect(food?.default_pool_id).toBe('POOL_DAILY');
      expect(food?.keywords).toContain('塔斯汀');
      expect(food?.keywords).toContain('华莱士');

      const asset = DEFAULT_CATEGORIES.find((c) => c.id === 'CAT_MAJOR_ASSET');
      expect(asset).toBeDefined();
      expect(asset?.default_pool_id).toBe('POOL_ASSET');

      const exam = DEFAULT_CATEGORIES.find((c) => c.id === 'CAT_EXAM_CERT');
      expect(exam).toBeDefined();
      expect(exam?.default_pool_id).toBe('POOL_FUND');
    });

    it('DEFAULT_ACCOUNTS should cover all 8 accounts with ACC_HUABEI as default pay', () => {
      expect(DEFAULT_ACCOUNTS).toHaveLength(8);

      const huabei = DEFAULT_ACCOUNTS.find((a) => a.id === 'ACC_HUABEI');
      expect(huabei?.is_default_pay).toBe(true);
      expect(huabei?.account_role).toBe('CREDIT');

      const cc = DEFAULT_ACCOUNTS.find((a) => a.id === 'ACC_CC_MAIN');
      expect(cc?.name).toBe('主力信用卡');

      const mcA = DEFAULT_ACCOUNTS.find((a) => a.id === 'ACC_MC_DEBIT_A');
      expect(mcA?.account_role).toBe('DEBIT_FX');

      const dormant = DEFAULT_ACCOUNTS.find((a) => a.id === 'ACC_DORMANT_01');
      expect(dormant?.account_role).toBe('DORMANT');
    });

    it('DEFAULT_PROJECT_TAGS should cover the 3 PRD project tags', () => {
      expect(DEFAULT_PROJECT_TAGS).toHaveLength(3);

      const jlpt = DEFAULT_PROJECT_TAGS.find((t) => t.id === 'TAG_JLPT_N2');
      expect(jlpt?.name).toBe('JLPT_N2考试专项');
      expect(jlpt?.target_budget).toBe('800.00');
      expect(jlpt?.linked_pool_id).toBe('POOL_FUND');

      const mcu = DEFAULT_PROJECT_TAGS.find((t) => t.id === 'TAG_MCU_LAB');
      expect(mcu?.linked_pool_id).toBe('POOL_FLEX');
    });
  });

  // ==========================================================================
  // 2. 安全算术表达式求值器 (evaluateMathFormula)
  // ==========================================================================
  describe('evaluateMathFormula (安全算术表达式求值器)', () => {
    it('should evaluate plain numbers and pure multiplications without discounts', () => {
      expect(evaluateMathFormula('28')).toEqual({
        gross: '28.00',
        discount: '0.00',
        net: '28.00',
      });

      expect(evaluateMathFormula('18.5')).toEqual({
        gross: '18.50',
        discount: '0.00',
        net: '18.50',
      });

      expect(evaluateMathFormula('3.5*2')).toEqual({
        gross: '7.00',
        discount: '0.00',
        net: '7.00',
      });

      expect(evaluateMathFormula('100 / 4')).toEqual({
        gross: '25.00',
        discount: '0.00',
        net: '25.00',
      });

      expect(evaluateMathFormula('10 + 5')).toEqual({
        gross: '15.00',
        discount: '0.00',
        net: '15.00',
      });
    });

    it('should split gross, discount, and net for subtraction formulas like 16.8-0.15 and 20-1.08*3', () => {
      expect(evaluateMathFormula('16.8-0.15')).toEqual({
        gross: '16.80',
        discount: '0.15',
        net: '16.65',
      });

      expect(evaluateMathFormula('20-1.08*3')).toEqual({
        gross: '20.00',
        discount: '3.24',
        net: '16.76',
      });

      expect(evaluateMathFormula('50 - 5 - 3')).toEqual({
        gross: '50.00',
        discount: '8.00',
        net: '42.00',
      });
    });

    it('should correctly handle parentheses in formulas', () => {
      expect(evaluateMathFormula('(10 + 5) * 2')).toEqual({
        gross: '30.00',
        discount: '0.00',
        net: '30.00',
      });

      expect(evaluateMathFormula('50 - (5 + 3)')).toEqual({
        gross: '50.00',
        discount: '8.00',
        net: '42.00',
      });

      expect(evaluateMathFormula('20 - (1.08 * 3)')).toEqual({
        gross: '20.00',
        discount: '3.24',
        net: '16.76',
      });
    });

    it('should protect against division by zero', () => {
      expect(() => evaluateMathFormula('10 / 0')).toThrow('Division by zero');
      expect(() => evaluateMathFormula('10 / (5 - 5)')).toThrow(
        'Division by zero'
      );
    });

    it('should throw on empty or invalid syntax', () => {
      expect(() => evaluateMathFormula('')).toThrow('Empty arithmetic expression');
      expect(() => evaluateMathFormula('   ')).toThrow(
        'Empty arithmetic expression'
      );
      expect(() => evaluateMathFormula('10 +')).toThrow();
      expect(() => evaluateMathFormula('((10)')).toThrow();
    });
  });

  // ==========================================================================
  // 3. PRD 模块 5 四大标准场景逐字段断言测试
  // ==========================================================================
  describe('PRD Module 5 Standard Scenarios (四大标准场景解析)', () => {
    // ------------------------------------------------------------------------
    // 场景 1：单分类多笔合并含立减
    // 示例：咸蛋黄拌面 16.8-0.15 + 饭卡充值 20-1.08*3 #饮食
    // ------------------------------------------------------------------------
    it('Scenario 1: Single Category Multi-item with Instant Reductions', () => {
      const input = '咸蛋黄拌面 16.8-0.15 + 饭卡充值 20-1.08*3 #饮食';
      const result = parseQuickInputDsl(input);

      expect(result.tx_type).toBe('EXPENSE');
      expect(result.account_id).toBe('ACC_HUABEI'); // 默认支付账户
      expect(result.target_account_id).toBeNull();
      expect(result.total_gross).toBe('36.80');
      expect(result.platform_discount).toBe('3.39');
      expect(result.payment_discount).toBe('0.00');
      expect(result.total_net).toBe('33.41');
      expect(result.allocation_mode).toBe('MANUAL');
      expect(result.original_currency).toBe('CNY');
      expect(result.original_amount).toBeNull();
      expect(result.exchange_rate).toBe('1.000000');
      expect(result.settlement_status).toBe('SETTLED');
      expect(result.hold_amount_cny).toBe('0.00');
      expect(result.should_wake_fx_account).toBe(false);
      expect(result.raw_input_text).toBe(input);
      expect(result.merchant_or_note).toBe('咸蛋黄拌面 + 饭卡充值');

      expect(result.items).toHaveLength(2);

      // 子明细 1: 咸蛋黄拌面
      const item1 = result.items[0];
      expect(item1.item_name).toBe('咸蛋黄拌面');
      expect(item1.category_id).toBe('CAT_FOOD');
      expect(item1.budget_pool_id).toBe('POOL_DAILY');
      expect(item1.project_tag_id).toBeNull();
      expect(item1.item_gross).toBe('16.80');
      expect(item1.allocated_discount).toBe('0.15');
      expect(item1.item_net).toBe('16.65');
      expect(item1.is_primary_item).toBe(false);
      expect(item1.raw_formula_expr).toBe('16.8-0.15');

      // 子明细 2: 饭卡充值
      const item2 = result.items[1];
      expect(item2.item_name).toBe('饭卡充值');
      expect(item2.category_id).toBe('CAT_FOOD');
      expect(item2.budget_pool_id).toBe('POOL_DAILY');
      expect(item2.project_tag_id).toBeNull();
      expect(item2.item_gross).toBe('20.00');
      expect(item2.allocated_discount).toBe('3.24');
      expect(item2.item_net).toBe('16.76');
      expect(item2.is_primary_item).toBe(false);
      expect(item2.raw_formula_expr).toBe('20-1.08*3');

      // 财务守恒定律校验
      const sumGross = (
        parseFloat(item1.item_gross) + parseFloat(item2.item_gross)
      ).toFixed(2);
      const sumDiscount = (
        parseFloat(item1.allocated_discount) +
        parseFloat(item2.allocated_discount)
      ).toFixed(2);
      const sumNet = (
        parseFloat(item1.item_net) + parseFloat(item2.item_net)
      ).toFixed(2);

      expect(sumGross).toBe(result.total_gross);
      expect(sumDiscount).toBe(
        (
          parseFloat(result.platform_discount) +
          parseFloat(result.payment_discount)
        ).toFixed(2)
      );
      expect(sumNet).toBe(result.total_net);
    });

    // ------------------------------------------------------------------------
    // 场景 2：跨品类凑单信用卡满减
    // 示例：牛奶 28 #饮食 + 晾衣架 12 #日用 + 排针 15 #电子 = 50 @招行信用卡
    // ------------------------------------------------------------------------
    it('Scenario 2: Cross-Category Order Pooling with Credit Card Full Reduction', () => {
      const input =
        '牛奶 28 #饮食 + 晾衣架 12 #日用 + 排针 15 #电子 = 50 @招行信用卡';
      const result = parseQuickInputDsl(input);

      expect(result.tx_type).toBe('EXPENSE');
      expect(result.account_id).toBe('ACC_CC_MAIN');
      expect(result.target_account_id).toBeNull();
      expect(result.total_gross).toBe('55.00');
      expect(result.platform_discount).toBe('0.00');
      expect(result.payment_discount).toBe('5.00');
      expect(result.total_net).toBe('50.00');
      expect(result.allocation_mode).toBe('PROPORTIONAL');
      expect(result.original_currency).toBe('CNY');
      expect(result.original_amount).toBeNull();
      expect(result.exchange_rate).toBe('1.000000');
      expect(result.settlement_status).toBe('SETTLED');
      expect(result.hold_amount_cny).toBe('0.00');
      expect(result.should_wake_fx_account).toBe(false);
      expect(result.raw_input_text).toBe(input);
      expect(result.merchant_or_note).toBe('牛奶 + 晾衣架 + 排针');

      expect(result.items).toHaveLength(3);

      // 子明细 1: 牛奶
      const milk = result.items[0];
      expect(milk.item_name).toBe('牛奶');
      expect(milk.category_id).toBe('CAT_FOOD');
      expect(milk.budget_pool_id).toBe('POOL_DAILY');
      expect(milk.item_gross).toBe('28.00');
      expect(milk.allocated_discount).toBe('2.55');
      expect(milk.item_net).toBe('25.45');
      expect(milk.raw_formula_expr).toBe('28');

      // 子明细 2: 晾衣架
      const hanger = result.items[1];
      expect(hanger.item_name).toBe('晾衣架');
      expect(hanger.category_id).toBe('CAT_DAILY_GOODS');
      expect(hanger.budget_pool_id).toBe('POOL_FLEX');
      expect(hanger.item_gross).toBe('12.00');
      expect(hanger.allocated_discount).toBe('1.09');
      expect(hanger.item_net).toBe('10.91');
      expect(hanger.raw_formula_expr).toBe('12');

      // 子明细 3: 排针 (最后一项吸收四舍五入 0.01 尾差)
      const pin = result.items[2];
      expect(pin.item_name).toBe('排针');
      expect(pin.category_id).toBe('CAT_EE_DEV');
      expect(pin.budget_pool_id).toBe('POOL_FLEX');
      expect(pin.item_gross).toBe('15.00');
      expect(pin.allocated_discount).toBe('1.36');
      expect(pin.item_net).toBe('13.64');
      expect(pin.raw_formula_expr).toBe('15');

      // 财务守恒定律严格成立
      const totalNetSum = (
        parseFloat(milk.item_net) +
        parseFloat(hanger.item_net) +
        parseFloat(pin.item_net)
      ).toFixed(2);
      expect(totalNetSum).toBe('50.00');
    });

    // ------------------------------------------------------------------------
    // 场景 3：万事达外币预授权消费
    // 示例：Porkbun域名 $4.35 冻结31.95 #数字服务 @万事达A
    // ------------------------------------------------------------------------
    it('Scenario 3: Mastercard Foreign Currency Pre-authorization Expense', () => {
      const input = 'Porkbun域名 $4.35 冻结31.95 #数字服务 @万事达A';
      const result = parseQuickInputDsl(input);

      expect(result.tx_type).toBe('EXPENSE');
      expect(result.account_id).toBe('ACC_MC_DEBIT_A');
      expect(result.target_account_id).toBeNull();
      expect(result.original_currency).toBe('USD');
      expect(result.original_amount).toBe('4.35');
      expect(result.hold_amount_cny).toBe('31.95');
      expect(result.settlement_status).toBe('PENDING_HOLD');
      expect(result.should_wake_fx_account).toBe(true);

      // processMastercardFxLifecycle 计算值
      expect(result.total_gross).toBe('31.32');
      expect(result.payment_discount).toBe('0.31');
      expect(result.platform_discount).toBe('0.00');
      expect(result.total_net).toBe('31.01');
      expect(result.exchange_rate).toBe('7.200000');
      expect(result.allocation_mode).toBe('SINGLE');
      expect(result.raw_input_text).toBe(input);
      expect(result.merchant_or_note).toBe('Porkbun域名');

      expect(result.items).toHaveLength(1);
      const item = result.items[0];
      expect(item.item_name).toBe('Porkbun域名');
      expect(item.category_id).toBe('CAT_DIGITAL_SUB');
      expect(item.budget_pool_id).toBe('POOL_FLEX');
      expect(item.project_tag_id).toBeNull();
      expect(item.item_gross).toBe('31.32');
      expect(item.allocated_discount).toBe('0.31');
      expect(item.item_net).toBe('31.01');
      expect(item.is_primary_item).toBe(true);
      expect(item.raw_formula_expr).toBe('$4.35');
    });

    // ------------------------------------------------------------------------
    // 场景 4：信用卡/花呗用券还款
    // 示例：还款 @花呗 500 - 还款券 5 从 @主力银联卡
    // ------------------------------------------------------------------------
    it('Scenario 4: Credit Account Repayment with Voucher Discount', () => {
      const input = '还款 @花呗 500 - 还款券 5 从 @主力银联卡';
      const result = parseQuickInputDsl(input);

      expect(result.tx_type).toBe('TRANSFER');
      expect(result.account_id).toBe('ACC_UNION_MAIN'); // 扣款来源账户
      expect(result.target_account_id).toBe('ACC_HUABEI'); // 还款目标账户
      expect(result.total_gross).toBe('500.00'); // 冲销负债原额
      expect(result.payment_discount).toBe('5.00'); // 还款券优惠
      expect(result.platform_discount).toBe('0.00');
      expect(result.total_net).toBe('495.00'); // 实际银行卡扣款
      expect(result.allocation_mode).toBe('SINGLE');
      expect(result.original_currency).toBe('CNY');
      expect(result.original_amount).toBeNull();
      expect(result.exchange_rate).toBe('1.000000');
      expect(result.settlement_status).toBe('SETTLED');
      expect(result.hold_amount_cny).toBe('0.00');
      expect(result.should_wake_fx_account).toBe(false);
      expect(result.items).toHaveLength(0);
      expect(result.raw_input_text).toBe(input);
      expect(result.merchant_or_note).toContain('花呗');
    });
  });

  // ==========================================================================
  // 4. 扩展与通用智能解析功能测试
  // ==========================================================================
  describe('General Extensions & Smart Categorization', () => {
    it('should auto-categorize food items by keywords without explicit #tag', () => {
      const resBurger = parseQuickInputDsl('塔斯汀汉堡 18.5');
      expect(resBurger.items[0].category_id).toBe('CAT_FOOD');
      expect(resBurger.items[0].budget_pool_id).toBe('POOL_DAILY');
      expect(resBurger.total_net).toBe('18.50');
      expect(resBurger.account_id).toBe('ACC_HUABEI');

      const resWallace = parseQuickInputDsl('华莱士 19.9');
      expect(resWallace.items[0].category_id).toBe('CAT_FOOD');
      expect(resWallace.items[0].budget_pool_id).toBe('POOL_DAILY');
      expect(resWallace.total_net).toBe('19.90');

      const resWash = parseQuickInputDsl('洗衣液 29.9');
      expect(resWash.items[0].category_id).toBe('CAT_CLEAN');
      expect(resWash.items[0].budget_pool_id).toBe('POOL_DAILY');

      const resTelecom = parseQuickInputDsl('移动话费 50');
      expect(resTelecom.items[0].category_id).toBe('CAT_TELECOM');
      expect(resTelecom.items[0].budget_pool_id).toBe('POOL_FIXED');

      const resTraffic = parseQuickInputDsl('打车 25');
      expect(resTraffic.items[0].category_id).toBe('CAT_TRAFFIC');
      expect(resTraffic.items[0].budget_pool_id).toBe('POOL_FLEX');
    });

    it('should recognize #JLPT_N2考试 and associate with POOL_FUND and CAT_EXAM_CERT', () => {
      const result = parseQuickInputDsl('报名费 800 #JLPT_N2考试');

      expect(result.items).toHaveLength(1);
      const item = result.items[0];
      expect(item.project_tag_id).toBe('TAG_JLPT_N2');
      expect(item.category_id).toBe('CAT_EXAM_CERT');
      expect(item.budget_pool_id).toBe('POOL_FUND');
      expect(item.item_gross).toBe('800.00');
      expect(item.item_net).toBe('800.00');
    });

    it('should wake FX account when foreign currency symbol or JPY is present', () => {
      const resJpy = parseQuickInputDsl('任天堂游戏 JPY 6500 @万事达B');
      expect(resJpy.should_wake_fx_account).toBe(true);
      expect(resJpy.original_currency).toBe('JPY');
      expect(resJpy.original_amount).toBe('6500');
      expect(resJpy.account_id).toBe('ACC_MC_DEBIT_B');

      const resSteam = parseQuickInputDsl('Steam游戏 $19.99 @万事达A');
      expect(resSteam.should_wake_fx_account).toBe(true);
      expect(resSteam.original_currency).toBe('USD');
      expect(resSteam.original_amount).toBe('19.99');
      expect(resSteam.account_id).toBe('ACC_MC_DEBIT_A');

      // 未显式写 @账户 时，检测到外币自动唤醒并选中首个 DEBIT_FX 账户
      const resAutoFx = parseQuickInputDsl('Cloudflare域名 $10.44 冻结76.50');
      expect(resAutoFx.should_wake_fx_account).toBe(true);
      expect(resAutoFx.account_id).toBe('ACC_MC_DEBIT_A');
    });

    it('should support *primary item marker in DSL split order (PRIMARY_ITEM mode)', () => {
      const res = parseQuickInputDsl('*MSPM0开发板 98 #电子 + 凑单零食 3 #饮食 = 91');
      expect(res.allocation_mode).toBe('PRIMARY_ITEM');
      expect(res.items[0].item_net).toBe('88.00');
      expect(res.items[0].allocated_discount).toBe('10.00');
      expect(res.items[1].item_net).toBe('3.00');
      expect(res.items[1].allocated_discount).toBe('0.00');
    });

    it('should support custom categories, accounts, and project tags from context', () => {
      const customAccount = {
        id: 'ACC_CUSTOM_WALLET',
        name: '数字人民币钱包',
        account_role: 'DEBIT_MAIN' as const,
        is_default_pay: true,
      };

      const customCategory = {
        id: 'CAT_CUSTOM_BOOK',
        parent_id: null,
        name: '二手工科二手书',
        default_pool_id: 'POOL_FLEX',
        icon_name: null,
        keywords: '微积分,模电,数电',
        sort_order: 99,
      };

      const result = parseQuickInputDsl('数电课本 15 @数字人民币钱包', {
        accounts: [customAccount],
        categories: [customCategory],
      });

      expect(result.account_id).toBe('ACC_CUSTOM_WALLET');
      expect(result.items[0].category_id).toBe('CAT_CUSTOM_BOOK');
      expect(result.items[0].budget_pool_id).toBe('POOL_FLEX');
      expect(result.total_net).toBe('15.00');
    });

    it('should auto-convert foreign currency without explicit hold amount using DEFAULT_FX_RATES', () => {
      const res = parseQuickInputDsl('Gemini会员 JPY 720');
      expect(res.original_currency).toBe('JPY');
      expect(res.original_amount).toBe('720');
      expect(res.settlement_status).toBe('PENDING_HOLD');
      // 720 * 0.048 * 1.02 = 35.2512 -> 35.25 hold CNY
      expect(res.hold_amount_cny).toBe('35.25');
      // base = 35.25 / 1.02 = 34.56, cashback = 34.56 * 0.01 = 0.35, net = 34.21
      expect(res.total_gross).toBe('34.56');
      expect(res.payment_discount).toBe('0.35');
      expect(res.total_net).toBe('34.21');
      expect(res.items[0].item_net).toBe('34.21');
    });

    it('should route budget_pool_id when #pool_name is provided in DSL', () => {
      const customPools = [
        {
          id: 'POOL_CUSTOM_SNACK',
          name: '零食下午茶池',
          pool_type: 'DAILY' as const,
          is_monthly_budget: true,
          rollover_strategy: 'RESET' as const,
          description: null,
          sort_order: 1,
        },
      ];

      const res = parseQuickInputDsl('奶茶 15 #零食下午茶池', {
        budgetPools: customPools,
      });

      expect(res.items[0].budget_pool_id).toBe('POOL_CUSTOM_SNACK');
    });

    it('should respect fxConfig defaultCashbackRate 0.0000 in FX DSL parsing', () => {
      const res = parseQuickInputDsl('Porkbun域名 $10.00', {
        fxConfig: { defaultHoldRatio: '1.020', defaultCashbackRate: '0.0000' },
      });

      expect(res.original_currency).toBe('USD');
      expect(res.fx_cashback_rate).toBe('0.0000');
      expect(res.payment_discount).toBe('0.00');
      expect(res.total_net).toBe(res.total_gross);
      expect(res.items[0].allocated_discount).toBe('0.00');
      expect(res.items[0].item_net).toBe(res.total_gross);
    });
  });
});
