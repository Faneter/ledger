import { describe, it, expect } from 'vitest';
import {
  allocateSplitDiscounts,
  computeOrderAllocation,
} from '../src/allocation.js';
import { processMastercardFxLifecycle } from '../src/mastercard-fx.js';
import {
  HybridLogicalClock,
  mergeOpLogEntries,
} from '../src/hlc-sync.js';
import {
  SplitItemInput,
  SyncOpLogEntry,
  TransactionAggregate,
  TransactionHeader,
} from '../src/types.js';
import { sumCny, formatCny } from '../src/money.js';

describe('Stage 2: Core Financial Engines & Distributed HLC Synchronization', () => {
  // ==========================================================================
  // 1. 跨品类凑单满减分摊引擎 (Split & Discount Allocation Engine)
  // ==========================================================================
  describe('allocateSplitDiscounts', () => {
    it('should return empty array when items is empty', () => {
      const res = allocateSplitDiscounts([], '100.00');
      expect(res).toEqual([]);
    });

    it('should calculate PRD example: Milk 28 + Hanger 12 + Pin header 15 = 50', () => {
      // PRD 模块 5 算例：原价合计 55.00，实付 50.00，平台优惠 5.00
      const items: SplitItemInput[] = [
        { name: '牛奶', gross: '28.00', category_id: 'CAT_FOOD' },
        { name: '晾衣架', gross: '12.00', category_id: 'CAT_DAILY_GOODS' },
        { name: '排针', gross: '15.00', category_id: 'CAT_EE_DEV' },
      ];

      const results = allocateSplitDiscounts(items, '50.00', 'PROPORTIONAL');

      // 验证子项分摊值（牛奶: 25.45, 晾衣架: 10.91, 排针: 13.64）
      expect(results[0].allocated_discount).toBe('2.55');
      expect(results[0].net).toBe('25.45');

      expect(results[1].allocated_discount).toBe('1.09');
      expect(results[1].net).toBe('10.91');

      expect(results[2].allocated_discount).toBe('1.36');
      expect(results[2].net).toBe('13.64');

      // 验证守恒定律：sum(net) === 50.00, sum(allocated_discount) === 5.00
      const netSum = sumCny(results.map((r) => r.net));
      expect(formatCny(netSum)).toBe('50.00');

      const discSum = sumCny(results.map((r) => r.allocated_discount));
      expect(formatCny(discSum)).toBe('5.00');
    });

    it('should absorb 0.01 tail difference on the last item: 3 items of 10.00 each, net paid 20.00', () => {
      // 3 个 10 元商品，实付 20 元（总优惠 10 元）
      // 10 / 30 * 10 = 3.3333... -> 前两项 3.33，第三项必须为 3.34 吸收尾差
      const items: SplitItemInput[] = [
        { name: '商品A', gross: '10.00', category_id: 'CAT_DAILY_GOODS' },
        { name: '商品B', gross: '10.00', category_id: 'CAT_DAILY_GOODS' },
        { name: '商品C', gross: '10.00', category_id: 'CAT_DAILY_GOODS' },
      ];

      const results = allocateSplitDiscounts(items, '20.00', 'PROPORTIONAL');

      expect(results[0].allocated_discount).toBe('3.33');
      expect(results[0].net).toBe('6.67');

      expect(results[1].allocated_discount).toBe('3.33');
      expect(results[1].net).toBe('6.67');

      expect(results[2].allocated_discount).toBe('3.34');
      expect(results[2].net).toBe('6.66');

      const netSum = sumCny(results.map((r) => r.net));
      expect(formatCny(netSum)).toBe('20.00');

      const discSum = sumCny(results.map((r) => r.allocated_discount));
      expect(formatCny(discSum)).toBe('10.00');
    });

    it('should handle PRIMARY_ITEM mode: primary item gets all discounts', () => {
      // PRD 3.2: 98元单片机开发板(主) + 3元零食，满100减10元，实付91元
      const items: SplitItemInput[] = [
        {
          name: 'MSPM0开发板',
          gross: '98.00',
          category_id: 'CAT_EE_DEV',
          is_primary: true,
        },
        {
          name: '凑单零食',
          gross: '3.00',
          category_id: 'CAT_FOOD',
          is_primary: false,
        },
      ];

      const results = allocateSplitDiscounts(items, '91.00', 'PRIMARY_ITEM');

      expect(results[0].allocated_discount).toBe('10.00');
      expect(results[0].net).toBe('88.00');

      expect(results[1].allocated_discount).toBe('0.00');
      expect(results[1].net).toBe('3.00');

      const netSum = sumCny(results.map((r) => r.net));
      expect(formatCny(netSum)).toBe('91.00');
    });

    it('should handle PRIMARY_ITEM mode defaulting to index 0 if no item is marked primary', () => {
      const items: SplitItemInput[] = [
        { name: '书本', gross: '50.00', category_id: 'CAT_STUDY_PRINT' },
        { name: '文具', gross: '20.00', category_id: 'CAT_STUDY_PRINT' },
      ];

      const results = allocateSplitDiscounts(items, '60.00', 'PRIMARY_ITEM');

      expect(results[0].allocated_discount).toBe('10.00');
      expect(results[0].net).toBe('40.00');

      expect(results[1].allocated_discount).toBe('0.00');
      expect(results[1].net).toBe('20.00');

      const netSum = sumCny(results.map((r) => r.net));
      expect(formatCny(netSum)).toBe('60.00');
    });

    it('should handle SINGLE mode with single or multiple items', () => {
      const singleItem: SplitItemInput[] = [
        { name: '话费充值', gross: '86.00', category_id: 'CAT_TELECOM' },
      ];
      const resSingle = allocateSplitDiscounts(singleItem, '80.00', 'SINGLE');
      expect(resSingle[0].allocated_discount).toBe('6.00');
      expect(resSingle[0].net).toBe('80.00');

      const multiItems: SplitItemInput[] = [
        { name: '商品A', gross: '50.00', category_id: 'CAT_FOOD' },
        { name: '商品B', gross: '20.00', category_id: 'CAT_FOOD' },
      ];
      const resMulti = allocateSplitDiscounts(multiItems, '60.00', 'SINGLE');
      expect(resMulti[0].allocated_discount).toBe('10.00');
      expect(resMulti[0].net).toBe('40.00');
      expect(resMulti[1].allocated_discount).toBe('0.00');
      expect(resMulti[1].net).toBe('20.00');
    });

    it('should handle MANUAL mode: accept valid nets and reject violating conservation law', () => {
      const items: SplitItemInput[] = [
        { name: '商品1', gross: '30.00', category_id: 'CAT_FOOD' },
        { name: '商品2', gross: '20.00', category_id: 'CAT_CLEAN' },
      ];

      // 合法手动分配：实付 40.00，分配 22.00 与 18.00 (和为 40.00)
      const validResults = allocateSplitDiscounts(
        items,
        '40.00',
        'MANUAL',
        ['22.00', '18.00']
      );
      expect(validResults[0].net).toBe('22.00');
      expect(validResults[0].allocated_discount).toBe('8.00');
      expect(validResults[1].net).toBe('18.00');
      expect(validResults[1].allocated_discount).toBe('2.00');

      // 违法守恒校验报错：手动指定和为 43.00 != 40.00
      expect(() => {
        allocateSplitDiscounts(items, '40.00', 'MANUAL', ['25.00', '18.00']);
      }).toThrow(/conservation law/i);

      // 数组长度不匹配报错
      expect(() => {
        allocateSplitDiscounts(items, '40.00', 'MANUAL', ['40.00']);
      }).toThrow(/matching items length/i);
    });

    it('should handle zero or negative discount correctly', () => {
      const items: SplitItemInput[] = [
        { name: '原价商品1', gross: '15.00', category_id: 'CAT_FOOD' },
        { name: '原价商品2', gross: '25.00', category_id: 'CAT_FOOD' },
      ];

      // 无折扣 (实付 === 原价)
      const zeroDiscResults = allocateSplitDiscounts(items, '40.00');
      expect(zeroDiscResults[0].allocated_discount).toBe('0.00');
      expect(zeroDiscResults[0].net).toBe('15.00');
      expect(zeroDiscResults[1].allocated_discount).toBe('0.00');
      expect(zeroDiscResults[1].net).toBe('25.00');

      // 溢价实付 (实付 42.00 > 原价 40.00，如跑腿费/包装费)
      const surchargeResults = allocateSplitDiscounts(items, '42.00');
      expect(surchargeResults[0].allocated_discount).toBe('0.00');
      expect(surchargeResults[0].net).toBe('15.00');
      expect(surchargeResults[1].allocated_discount).toBe('-2.00');
      expect(surchargeResults[1].net).toBe('27.00');
      expect(sumCny(surchargeResults.map((r) => r.net)).toString()).toBe('42');
    });
  });

  // ==========================================================================
  // 2. 整单实付分摊结果聚合计算 (computeOrderAllocation)
  // ==========================================================================
  describe('computeOrderAllocation', () => {
    it('should compute complete order allocation result with cashActuallyPaid', () => {
      const items: SplitItemInput[] = [
        { name: '午餐', gross: '15.00', category_id: 'CAT_FOOD' },
      ];
      const comp = computeOrderAllocation(items, '10.99', 'SINGLE');

      expect(comp.total_gross).toBe('15.00');
      expect(comp.cash_paid).toBe('10.99');
      expect(comp.total_net).toBe('10.99');
      expect(comp.total_discount).toBe('4.01');
      expect(comp.items.length).toBe(1);
      expect(comp.items[0].net).toBe('10.99');
      expect(comp.items[0].allocated_discount).toBe('4.01');
    });
  });

  // ==========================================================================
  // 3. 万事网联外币借记卡状态机计算 (Mastercard FX Lifecycle)
  // ==========================================================================
  describe('processMastercardFxLifecycle', () => {
    it('should calculate PRD example: $4.35 Porkbun domain hold 31.95 CNY -> settled 31.32 CNY', () => {
      // 阶段 1：交易挂起态 PENDING_HOLD (未清算)
      const holdRes = processMastercardFxLifecycle({
        foreignAmount: '4.35',
        holdAmountCny: '31.95',
        settledAmountCny: null,
      });

      expect(holdRes.status).toBe('PENDING_HOLD');
      expect(holdRes.hold_amount_cny).toBe('31.95');
      // 31.95 / 1.02 = 31.3235... -> 31.32
      expect(holdRes.total_gross).toBe('31.32');
      // 31.32 * 0.01 = 0.3132 -> 0.31 返现
      expect(holdRes.payment_discount).toBe('0.31');
      // 31.32 - 0.31 = 31.01 暂扣预算
      expect(holdRes.total_net).toBe('31.01');
      // 31.32 / 4.35 = 7.200000 汇率
      expect(holdRes.exchange_rate).toBe('7.200000');

      // 阶段 2：收到银行入账清算通知 SETTLED (清算 31.32 元)
      const settledRes = processMastercardFxLifecycle({
        foreignAmount: '4.35',
        holdAmountCny: '31.95',
        settledAmountCny: '31.32',
      });

      if (settledRes.status !== 'SETTLED') {
        throw new Error('Expected status to be SETTLED');
      }

      expect(settledRes.status).toBe('SETTLED');
      expect(settledRes.hold_amount_cny).toBe('0.00');
      // 31.95 - 31.32 = 0.63 元释放回可用余额
      expect(settledRes.released_to_available).toBe('0.63');
      expect(settledRes.total_gross).toBe('31.32');
      expect(settledRes.payment_discount).toBe('0.31');
      expect(settledRes.total_net).toBe('31.01');
      expect(settledRes.exchange_rate).toBe('7.200000');
    });

    it('should correctly release hold and lock rate when settled amount differs from estimated base', () => {
      // 若实际清算汇率波动，清算额为 31.50 元
      const settledRes = processMastercardFxLifecycle({
        foreignAmount: '4.35',
        holdAmountCny: '31.95',
        settledAmountCny: '31.50',
      });

      if (settledRes.status !== 'SETTLED') {
        throw new Error('Expected status to be SETTLED');
      }

      // 释放差额：31.95 - 31.50 = 0.45
      expect(settledRes.released_to_available).toBe('0.45');
      // 1% 返现：31.50 * 0.01 = 0.315 -> 0.32
      expect(settledRes.payment_discount).toBe('0.32');
      // 净支出：31.50 - 0.32 = 31.18
      expect(settledRes.total_net).toBe('31.18');
      // 汇率：31.50 / 4.35 = 7.2413793... -> 7.241379
      expect(settledRes.exchange_rate).toBe('7.241379');
    });

    it('should respect monthly cashback cap', () => {
      // 阶段 1 封顶测试：原本应返 0.31 元，但当月仅剩 0.20 元额度
      const holdRes = processMastercardFxLifecycle({
        foreignAmount: '4.35',
        holdAmountCny: '31.95',
        settledAmountCny: null,
        monthlyRemainingCapCny: '0.20',
      });
      expect(holdRes.payment_discount).toBe('0.20');
      // 净扣减：31.32 - 0.20 = 31.12
      expect(holdRes.total_net).toBe('31.12');

      // 阶段 2 封顶测试：清算态同样受到封顶限制
      const settledRes = processMastercardFxLifecycle({
        foreignAmount: '4.35',
        holdAmountCny: '31.95',
        settledAmountCny: '31.32',
        monthlyRemainingCapCny: '0.20',
      });
      expect(settledRes.payment_discount).toBe('0.20');
      expect(settledRes.total_net).toBe('31.12');

      // 返现额度耗尽 (0.00 元)
      const exhaustedRes = processMastercardFxLifecycle({
        foreignAmount: '4.35',
        holdAmountCny: '31.95',
        settledAmountCny: '31.32',
        monthlyRemainingCapCny: '0.00',
      });
      expect(exhaustedRes.payment_discount).toBe('0.00');
      expect(exhaustedRes.total_net).toBe('31.32');
    });
  });

  // ==========================================================================
  // 4. 混合逻辑时钟 (Hybrid Logical Clock, HLC)
  // ==========================================================================
  describe('HybridLogicalClock', () => {
    it('should generate monotonic HLC timestamps on the same node', () => {
      const hlc = new HybridLogicalClock('node-a');
      const fixedPhysicalTime = 1731412800000;

      const t1 = hlc.now(fixedPhysicalTime);
      const t2 = hlc.now(fixedPhysicalTime);
      const t3 = hlc.now(fixedPhysicalTime);

      expect(HybridLogicalClock.compare(t1, t2)).toBe(-1);
      expect(HybridLogicalClock.compare(t2, t3)).toBe(-1);

      const p1 = HybridLogicalClock.parse(t1);
      const p2 = HybridLogicalClock.parse(t2);
      const p3 = HybridLogicalClock.parse(t3);

      expect(p1.counter).toBe(0);
      expect(p2.counter).toBe(1);
      expect(p3.counter).toBe(2);
      expect(p1.nodeId).toBe('node-a');
    });

    it('should format and parse HLC properly with padding', () => {
      const hlc = new HybridLogicalClock('client-phone-01');
      const timeMs = 1731412800123;
      const formatted = hlc.now(timeMs);

      // 15 位数字时间戳 + 4 位十六进制计数器 + 节点ID
      expect(formatted).toMatch(/^\d{15}-[0-9a-f]{4}-client-phone-01$/);

      const parsed = HybridLogicalClock.parse(formatted);
      expect(parsed.timestampMs).toBe(timeMs);
      expect(parsed.counter).toBe(0);
      expect(parsed.nodeId).toBe('client-phone-01');
    });

    it('should advance local clock when receiving remote HLC', () => {
      const localHlc = new HybridLogicalClock('local-node');
      localHlc.now(1000);

      // 接收来自远端更大物理时间戳的 HLC
      const remoteHlcStr = '000000000002000-0005-remote-node';
      const received = localHlc.receive(remoteHlcStr, 1500);

      const parsed = HybridLogicalClock.parse(received);
      expect(parsed.timestampMs).toBe(2000);
      expect(parsed.counter).toBe(6);
      expect(parsed.nodeId).toBe('local-node');

      // 比较接收后本地时钟应严格大于远端时钟
      expect(HybridLogicalClock.compare(received, remoteHlcStr)).toBe(1);
    });
  });

  // ==========================================================================
  // 5. 分布式操作变更日志合并与冲突捕获 (mergeOpLogEntries)
  // ==========================================================================
  describe('mergeOpLogEntries', () => {
    const createTxAggregate = (
      id: string,
      net: string,
      status: 'PENDING_HOLD' | 'SETTLED' = 'SETTLED'
    ): TransactionAggregate => ({
      header: {
        id,
        tx_date: '2026-11-12',
        tx_timestamp: '2026-11-12T10:00:00Z',
        tx_type: 'EXPENSE',
        total_gross: net,
        platform_discount: '0.00',
        payment_discount: '0.00',
        total_net: net,
        allocation_mode: 'SINGLE',
        original_currency: 'CNY',
        original_amount: null,
        exchange_rate: '1.000000',
        settlement_status: status,
        hold_amount_cny: '0.00',
        settled_at: status === 'SETTLED' ? '2026-11-12T10:00:00Z' : null,
        raw_input_text: null,
        merchant_or_note: 'Test TX',
      },
      items: [
        {
          id: 1,
          header_id: id,
          item_name: 'Item 1',
          category_id: 'CAT_FOOD',
          budget_pool_id: 'POOL_DAILY',
          project_tag_id: null,
          item_gross: net,
          allocated_discount: '0.00',
          item_net: net,
          is_primary_item: false,
          raw_formula_expr: null,
        },
      ],
    });

    it('should be idempotent: merge(A, A) === A', () => {
      const op1: SyncOpLogEntry = {
        hlc: '000000000001000-0000-node1',
        node_id: 'node1',
        entity_type: 'BUDGET_POOL',
        entity_id: 'POOL_DAILY',
        op_type: 'UPSERT',
        payload_json: JSON.stringify({ id: 'POOL_DAILY', name: '日常餐饮' }),
        created_at: '2026-11-12T10:00:00Z',
      };
      const op2: SyncOpLogEntry = {
        hlc: '000000000001000-0001-node1',
        node_id: 'node1',
        entity_type: 'TRANSACTION',
        entity_id: 'TX_001',
        op_type: 'UPSERT',
        payload_json: JSON.stringify(createTxAggregate('TX_001', '50.00')),
        created_at: '2026-11-12T10:01:00Z',
      };

      const setA = [op1, op2];
      const res = mergeOpLogEntries(setA, setA);

      expect(res.mergedOps.length).toBe(2);
      expect(res.winningEntities.size).toBe(2);
      expect(res.detectedConflicts.length).toBe(0);
    });

    it('should be commutative and convergent: merge(A, B) === merge(B, A)', () => {
      const opA: SyncOpLogEntry = {
        hlc: '000000000001000-0000-nodeA',
        node_id: 'nodeA',
        entity_type: 'BUDGET_POOL',
        entity_id: 'POOL_DAILY',
        op_type: 'UPSERT',
        payload_json: JSON.stringify({ id: 'POOL_DAILY', name: '日常餐饮' }),
        created_at: '2026-11-12T10:00:00Z',
      };

      const opB: SyncOpLogEntry = {
        hlc: '000000000002000-0000-nodeB',
        node_id: 'nodeB',
        entity_type: 'BUDGET_POOL',
        entity_id: 'POOL_FLEX',
        op_type: 'UPSERT',
        payload_json: JSON.stringify({ id: 'POOL_FLEX', name: '机动灵活' }),
        created_at: '2026-11-12T10:05:00Z',
      };

      const resAB = mergeOpLogEntries([opA], [opB]);
      const resBA = mergeOpLogEntries([opB], [opA]);

      expect(resAB.mergedOps.map((o) => o.hlc)).toEqual(
        resBA.mergedOps.map((o) => o.hlc)
      );
      expect(Array.from(resAB.winningEntities.keys())).toEqual(
        Array.from(resBA.winningEntities.keys())
      );
      expect(resAB.detectedConflicts).toEqual(resBA.detectedConflicts);
    });

    it('should correctly capture CONCURRENT_TX_EDIT when two nodes edit the same transaction', () => {
      // 节点 A 与 节点 B 离线期间并发修改同一笔交易 TX_100
      const opNodeA: SyncOpLogEntry = {
        hlc: '000000000001000-0000-nodeA',
        node_id: 'nodeA',
        entity_type: 'TRANSACTION',
        entity_id: 'TX_100',
        op_type: 'UPSERT',
        payload_json: JSON.stringify(createTxAggregate('TX_100', '25.00')),
        created_at: '2026-11-12T10:00:00Z',
      };

      const opNodeB: SyncOpLogEntry = {
        hlc: '000000000002000-0000-nodeB', // 较高 HLC
        node_id: 'nodeB',
        entity_type: 'TRANSACTION',
        entity_id: 'TX_100',
        op_type: 'UPSERT',
        payload_json: JSON.stringify(createTxAggregate('TX_100', '28.00')),
        created_at: '2026-11-12T10:05:00Z',
      };

      const res = mergeOpLogEntries([opNodeA], [opNodeB]);

      // 胜出者为较高 HLC 的 Node B
      const winner = res.winningEntities.get('TRANSACTION:TX_100');
      expect(winner?.node_id).toBe('nodeB');
      expect(winner?.hlc).toBe(opNodeB.hlc);

      // 捕获 CONCURRENT_TX_EDIT 冲突
      expect(res.detectedConflicts.length).toBe(1);
      const conflict = res.detectedConflicts[0];
      expect(conflict.conflict_type).toBe('CONCURRENT_TX_EDIT');
      expect(conflict.entity_id).toBe('TX_100');
      expect(conflict.winner_hlc).toBe(opNodeB.hlc);
      expect(conflict.loser_hlc).toBe(opNodeA.hlc);
      expect(conflict.loser_payload_json).toBe(opNodeA.payload_json);
      expect(conflict.status).toBe('PENDING');
    });

    it('should capture CONCURRENT_FX_SETTLE when transaction settlement status concurrently changes', () => {
      // Node A 仍处于 PENDING_HOLD，Node B 已经在另一端确认了 SETTLED
      const opHold: SyncOpLogEntry = {
        hlc: '000000000001000-0000-nodeA',
        node_id: 'nodeA',
        entity_type: 'TRANSACTION',
        entity_id: 'TX_FX_001',
        op_type: 'UPSERT',
        payload_json: JSON.stringify(
          createTxAggregate('TX_FX_001', '31.01', null, 'PENDING_HOLD')
        ),
        created_at: '2026-11-12T10:00:00Z',
      };

      const opSettled: SyncOpLogEntry = {
        hlc: '000000000002000-0000-nodeB',
        node_id: 'nodeB',
        entity_type: 'TRANSACTION',
        entity_id: 'TX_FX_001',
        op_type: 'UPSERT',
        payload_json: JSON.stringify(
          createTxAggregate('TX_FX_001', '31.01', null, 'SETTLED')
        ),
        created_at: '2026-11-12T10:05:00Z',
      };

      const res = mergeOpLogEntries([opHold], [opSettled]);

      expect(res.detectedConflicts.length).toBe(1);
      expect(res.detectedConflicts[0].conflict_type).toBe(
        'CONCURRENT_FX_SETTLE'
      );
      expect(res.detectedConflicts[0].entity_id).toBe('TX_FX_001');
      expect(res.detectedConflicts[0].winner_hlc).toBe(opSettled.hlc);
      expect(res.detectedConflicts[0].loser_hlc).toBe(opHold.hlc);
    });
  });
});
