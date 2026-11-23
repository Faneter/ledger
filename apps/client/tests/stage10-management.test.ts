import { describe, it, expect, beforeEach } from 'vitest';
import { LocalLedgerEngine, LOCAL_STORAGE_KEY } from '../src/sync/local-replica';

describe('Stage 10: Management Operations & Clean Seed State Tests', () => {
  let engine: LocalLedgerEngine;

  beforeEach(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(LOCAL_STORAGE_KEY);
    }
    engine = new LocalLedgerEngine('test-client-node');
  });

  describe('1. 纯净初始账本与演示数据加载切换', () => {
    it('resetToCleanState 应该重置为 0 交易流水与 0 规则', () => {
      engine.resetToCleanState();

      expect(engine.state.transactions.length).toBe(0);
      expect(engine.state.projectTags.length).toBe(0);
      expect(engine.state.recurringRules.length).toBe(0);

      // 保留常规 4 大月度预算池
      expect(engine.state.budgetPools.length).toBe(4);
      const monthlyPools = engine.state.budgetPools.filter((p) => p.is_monthly_budget);
      expect(monthlyPools.length).toBe(4);
    });

    it('loadDemoData 应该载入 PRD 标杆测试样例与预设周期规则', () => {
      engine.resetToCleanState();
      engine.loadDemoData();

      expect(engine.state.recurringRules.length).toBe(2);
    });

    it('exportFullSyncBundle 能正常导出完整 JSON 备份包', () => {
      const bundle = engine.exportFullSyncBundle();
      expect(bundle.nodeId).toBe(engine.state.nodeId);
      expect(bundle.monthlyBudgets.length).toBe(engine.state.monthlyBudgets.length);
      expect(Array.isArray(bundle.oplogs)).toBe(true);
    });
  });

  describe('2. 资金池、分类与心愿单管理操作', () => {
    beforeEach(() => {
      engine.resetToCleanState();
    });

    it('新增与编辑月度资金池 (upsertBudgetPool + upsertMonthlyBudget)', () => {
      const newPool = engine.upsertBudgetPool({
        id: 'POOL_PET',
        name: '猫咪宠物专池',
        pool_type: 'FLEX',
        is_monthly_budget: true,
        rollover_strategy: 'RESET',
        description: '猫粮与驱虫支出',
      });

      expect(newPool.name).toBe('猫咪宠物专池');
      expect(engine.state.budgetPools.some((p) => p.id === 'POOL_PET')).toBe(true);

      engine.upsertMonthlyBudget({
        year_month: '2026-11',
        pool_id: 'POOL_PET',
        base_allocation: '200.00',
      });

      const mb = engine.state.monthlyBudgets.find(
        (b) => b.pool_id === 'POOL_PET' && b.year_month === '2026-11'
      );
      expect(mb?.base_allocation).toBe('200.00');
    });

    it('心愿单立项与删除操作 (upsertProjectTag + deleteProjectTag)', () => {
      const tag = engine.upsertProjectTag({
        id: 'TAG_EXAM_2026',
        name: '考公报考基金',
        tag_type: 'PROJECT',
        target_budget: '450.00',
        start_date: '2026-11-01',
        end_date: '2026-12-31',
      });

      expect(tag.name).toBe('考公报考基金');
      expect(engine.state.projectTags.length).toBe(1);

      engine.deleteProjectTag('TAG_EXAM_2026');
      expect(engine.state.projectTags.length).toBe(0);
    });

    it('收支分类管理 (upsertCategory + deleteCategory)', () => {
      const cat = engine.upsertCategory({
        id: 'CAT_PET_FOOD',
        name: '宠物食品',
        default_pool_id: 'POOL_DAILY',
        icon: '🐱',
        keywords: '猫粮,冻干,猫罐头',
      });

      expect(cat.name).toBe('宠物食品');
      expect(cat.keywords).toBe('猫粮,冻干,猫罐头');

      engine.deleteCategory('CAT_PET_FOOD');
      expect(engine.state.categories.some((c) => c.id === 'CAT_PET_FOOD')).toBe(false);
    });
  });

  describe('3. 周期规则管理操作', () => {
    beforeEach(() => {
      engine.resetToCleanState();
    });

    it('周期性规则执行记账 (upsertRecurringRule + executeRecurringRule)', () => {
      const rule = engine.upsertRecurringRule({
        title: '测试宽带月租',
        rule_type: 'FIXED_EXPENSE',
        cron_cycle: 'MONTHLY',
        trigger_day: 1,
        currency: 'CNY',
        amount: '30.00',
        budget_pool_id: 'POOL_FIXED',
      });

      expect(rule.title).toBe('测试宽带月租');
      expect(engine.state.recurringRules.length).toBe(1);

      // 立即触发周期记账
      const tx = engine.executeRecurringRule(rule.id, '2026-11-01');
      expect(tx.header.total_net).toBe('30.00');
      expect(engine.state.transactions.length).toBe(1);
    });
  });
});
