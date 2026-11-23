import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createLedgerServer, LedgerServerInstance } from '../src/app.js';
import { LedgerRepository } from '@ledger/db';
import { formatCny } from '@ledger/core';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

describe('Stage 5: @ledger/server Distributed Sync & Disaster Recovery Server', () => {
  let server: LedgerServerInstance;

  beforeEach(() => {
    server = createLedgerServer({
      dbPath: ':memory:',
      nodeId: 'server-master-test',
      currentYearMonth: '2026-11',
      currentDate: '2026-11-12',
    });
  });

  afterEach(async () => {
    await server.close();
  });

  // ==========================================================================
  // 测试 1：/api/state 初始种子状态、/api/dsl/preview 与 /api/transactions/dsl 记账闭环
  // ==========================================================================
  describe('1. Initial State, DSL Preview & Transaction Recording Loop', () => {
    it('should return initial health and full workspace state', async () => {
      // 1. GET /api/health
      const healthRes = await server.inject({
        method: 'GET',
        url: '/api/health',
      });
      expect(healthRes.statusCode).toBe(200);
      expect(healthRes.body.status).toBe('ok');
      expect(healthRes.body.nodeId).toBe('server-master-test');
      expect(healthRes.body.oplogCount).toBe(0);
      expect(typeof healthRes.body.serverEpochId).toBe('string');

      // 2. GET /api/state
      const stateRes = await server.inject({
        method: 'GET',
        url: '/api/state?yearMonth=2026-11&currentDate=2026-11-12',
      });
      expect(stateRes.statusCode).toBe(200);
      const state = stateRes.body;
      expect(state.nodeId).toBe('server-master-test');
      expect(state.yearMonth).toBe('2026-11');
      expect(state.currentDate).toBe('2026-11-12');
      expect(state.budgetStatus.pools.length).toBe(4);
      expect(state.transactions).toEqual([]);
      expect(state.pendingFxTransactions).toEqual([]);
      expect(state.metadata.categories.length).toBe(14);
      expect(state.metadata.projectTags.length).toBe(3);
      expect(state.metadata.recurringRules.length).toBe(2);
      expect(state.conflicts).toEqual([]);
      expect(state.oplogCount).toBe(0);
      expect(state.latestHlc).toBeNull();
    });

    it('should preview DSL calculation without modifying database', async () => {
      const dsl = '麦当劳巨无霸 35.5-10 #饮食';
      const previewRes = await server.inject({
        method: 'POST',
        url: '/api/dsl/preview',
        body: { rawText: dsl, txDate: '2026-11-12' },
      });

      expect(previewRes.statusCode).toBe(200);
      const { parsed } = previewRes.body;
      expect(parsed.total_gross).toBe('35.50');
      expect(parsed.platform_discount).toBe('10.00');
      expect(parsed.total_net).toBe('25.50');
      expect(parsed.items.length).toBe(1);
      expect(parsed.items[0].item_net).toBe('25.50');

      // 验证未写库
      const stateRes = await server.inject({
        method: 'GET',
        url: '/api/state',
      });
      expect(stateRes.body.transactions).toEqual([]);
      expect(stateRes.body.oplogCount).toBe(0);
    });

    it('should return 400 when previewing invalid DSL', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/dsl/preview',
        body: { rawText: '' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('should record transaction from DSL and update state & oplog', async () => {
      const dsl = '麦当劳巨无霸 35.5-10 #饮食 @主力银联卡';
      const recordRes = await server.inject({
        method: 'POST',
        url: '/api/transactions/dsl',
        body: { rawText: dsl, txDate: '2026-11-12' },
      });

      expect(recordRes.statusCode).toBe(200);
      const tx = recordRes.body.transaction;
      expect(tx.header.total_gross).toBe('35.50');
      expect(tx.header.platform_discount).toBe('10.00');
      expect(tx.header.total_net).toBe('25.50');

      // 验证全量状态已更新
      const stateRes = await server.inject({
        method: 'GET',
        url: '/api/state?yearMonth=2026-11&currentDate=2026-11-12',
      });
      expect(stateRes.body.transactions.length).toBe(1);
      expect(stateRes.body.oplogCount).toBe(1);
      expect(stateRes.body.latestHlc).toBeDefined();

      const dailyPool = stateRes.body.budgetStatus.pools.find(
        (p: any) => p.pool_id === 'POOL_DAILY'
      );
      expect(dailyPool.spent_net).toBe('25.50');
    });

    it('should record structured transaction via POST /api/transactions', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/transactions',
        body: {
          header: {
            tx_date: '2026-11-12',
            tx_type: 'EXPENSE',
            total_gross: '20.00',
            platform_discount: '0.00',
            payment_discount: '0.00',
            total_net: '20.00',
            allocation_mode: 'SINGLE',
            merchant_or_note: '结构化录入测试',
          },
          items: [
            {
              item_name: '文具',
              category_id: 'CAT_STUDY_PRINT',
              budget_pool_id: 'POOL_FLEX',
              item_gross: '20.00',
              allocated_discount: '0.00',
              item_net: '20.00',
              is_primary_item: true,
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body.transaction.header.total_net).toBe('20.00');

      // 校验守恒定律报错
      const badRes = await server.inject({
        method: 'POST',
        url: '/api/transactions',
        body: {
          header: {
            tx_date: '2026-11-12',
            tx_type: 'EXPENSE',
            total_gross: '20.00',
            total_net: '20.00',
          },
          items: [
            {
              item_name: '违规子项',
              category_id: 'CAT_FOOD',
              budget_pool_id: 'POOL_DAILY',
              item_gross: '10.00', // 不等于 20.00
              item_net: '10.00',
              is_primary_item: true,
            },
          ],
        },
      });
      expect(badRes.statusCode).toBe(400);
      expect(badRes.body.error).toContain('Conservation law violated');
    });
  });

  // ==========================================================================
  // 测试 2：万事达外币预授权消费录入 + /api/transactions/:id/settle-fx 清算确认
  // ==========================================================================
  describe('2. Mastercard FX Hold & Settlement Lifecycle', () => {
    it('should handle Mastercard FX 102% hold and settle confirmation', async () => {
      // 1. 录入外币交易: 10.37 USD, 冻结 76.52 CNY
      const dsl = 'Porkbun域名续费 $10.37 冻结76.52 #数字服务';
      const recordRes = await server.inject({
        method: 'POST',
        url: '/api/transactions/dsl',
        body: { rawText: dsl, txDate: '2026-11-12' },
      });
      expect(recordRes.statusCode).toBe(200);
      const tx = recordRes.body.transaction;
      expect(tx.header.original_currency).toBe('USD');
      expect(tx.header.original_amount).toBe('10.37');
      expect(tx.header.settlement_status).toBe('PENDING_HOLD');
      expect(tx.header.hold_amount_cny).toBe('76.52');

      // 验证状态看板中挂起的外币交易
      const state1 = (
        await server.inject({
          method: 'GET',
          url: '/api/state',
        })
      ).body;
      expect(state1.pendingFxTransactions.length).toBe(1);
      expect(state1.pendingFxTransactions[0].header.id).toBe(tx.header.id);

      // 2. 清算确认：银行正式清算金额 75.25 元 (1% 返现 0.75，最终净扣 74.50)
      const settleRes = await server.inject({
        method: 'POST',
        url: `/api/transactions/${tx.header.id}/settle-fx`,
        body: {
          settledAmountCny: '75.25',
          settledAt: '2026-11-14T10:00:00Z',
        },
      });
      expect(settleRes.statusCode).toBe(200);
      const settledTx = settleRes.body.transaction;
      expect(settledTx.header.settlement_status).toBe('SETTLED');
      expect(settledTx.header.hold_amount_cny).toBe('0.00');
      expect(settledTx.header.total_gross).toBe('75.25');
      expect(settledTx.header.payment_discount).toBe('0.75');
      expect(settledTx.header.total_net).toBe('74.50');
      expect(settledTx.header.settled_at).toBe('2026-11-14T10:00:00Z');

      // 验证清算后待清算列表清空
      const state2 = (
        await server.inject({
          method: 'GET',
          url: '/api/state',
        })
      ).body;
      expect(state2.pendingFxTransactions.length).toBe(0);
    });

    it('should return error for non-existent or already settled fx transactions', async () => {
      const res404 = await server.inject({
        method: 'POST',
        url: '/api/transactions/NON_EXISTENT_TX/settle-fx',
        body: { settledAmountCny: '50.00' },
      });
      expect(res404.statusCode).toBe(404);

      // 录入普通消费 (SETTLED) 并尝试 settle-fx
      const dslRes = await server.inject({
        method: 'POST',
        url: '/api/transactions/dsl',
        body: { rawText: '午餐 20.00 #饮食 @主力银联卡' },
      });
      const txId = dslRes.body.transaction.header.id;

      const badRes = await server.inject({
        method: 'POST',
        url: `/api/transactions/${txId}/settle-fx`,
        body: { settledAmountCny: '20.00' },
      });
      expect(badRes.statusCode).toBe(400);
      expect(badRes.body.error).toContain('is in status "SETTLED", not "PENDING_HOLD"');
    });
  });

  // ==========================================================================
  // 测试 3：预算月末滚存
  // ==========================================================================
  describe('3. Month Rollover', () => {
    it('should execute month rollover preserving accumulated pool surplus', async () => {
      // 消费 150 元，高频池总额 650，剩余 500 元
      await server.inject({
        method: 'POST',
        url: '/api/transactions/dsl',
        body: {
          rawText: '食堂大餐 150 #饮食',
          txDate: '2026-11-12',
        },
      });

      // 执行月末滚存至 2026-12
      const rolloverRes = await server.inject({
        method: 'POST',
        url: '/api/budgets/rollover',
        body: { fromYearMonth: '2026-11', toYearMonth: '2026-12' },
      });
      expect(rolloverRes.statusCode).toBe(200);
      expect(rolloverRes.body.pools.length).toBe(4);

      const dailyDec = rolloverRes.body.pools.find(
        (p: any) => p.pool_id === 'POOL_DAILY'
      );
      // POOL_DAILY ACCUMULATE: 滚存剩余 500.00
      expect(dailyDec.rollover_from_prev).toBe('500.00');
    });
  });

  // ==========================================================================
  // 测试 4：多客户端通过 /api/sync/exchange 双向增量同步及网络重传幂等性
  // ==========================================================================
  describe('4. Multi-Client Bidirectional Sync & Idempotency', () => {
    it('should sync changes between multiple clients and handle retries idempotently', async () => {
      // 客户端 1 本地离线记账
      const client1 = new LedgerRepository(':memory:', 'node-client-1');
      client1.recordFromDsl('必胜客比萨 88.00 #饮食', '2026-11-10');
      const opsClient1 = client1.getOpLogs();
      expect(opsClient1.length).toBe(1);

      // 客户端 1 同步至服务端
      const exchange1 = await server.inject({
        method: 'POST',
        url: '/api/sync/exchange',
        body: {
          clientNodeId: 'node-client-1',
          sinceHlc: null,
          ops: opsClient1,
        },
      });
      expect(exchange1.statusCode).toBe(200);
      expect(exchange1.body.appliedCount).toBe(1);
      expect(exchange1.body.conflicts).toEqual([]);

      // 验证服务端状态已吸收 Client 1
      const stateServer1 = (
        await server.inject({
          method: 'GET',
          url: '/api/state?yearMonth=2026-11&currentDate=2026-11-12',
        })
      ).body;
      const dailyPool = stateServer1.budgetStatus.pools.find(
        (p: any) => p.pool_id === 'POOL_DAILY'
      );
      expect(dailyPool.spent_net).toBe('88.00');
      expect(stateServer1.oplogCount).toBe(1);

      // 网络重传测试：Client 1 模拟超时重试，连续再次发送同一批 ops 2 次（共 3 次）
      for (let retry = 0; retry < 2; retry++) {
        const retryRes = await server.inject({
          method: 'POST',
          url: '/api/sync/exchange',
          body: {
            clientNodeId: 'node-client-1',
            sinceHlc: null,
            ops: opsClient1,
          },
        });
        expect(retryRes.statusCode).toBe(200);
      }

      // 验证绝对幂等：服务端支出与 oplog 数量绝不重复累加
      const stateServerRetry = (
        await server.inject({
          method: 'GET',
          url: '/api/state?yearMonth=2026-11&currentDate=2026-11-12',
        })
      ).body;
      const dailyPoolRetry = stateServerRetry.budgetStatus.pools.find(
        (p: any) => p.pool_id === 'POOL_DAILY'
      );
      expect(dailyPoolRetry.spent_net).toBe('88.00');
      expect(stateServerRetry.oplogCount).toBe(1);

      // 客户端 2 接入并增量拉取服务端操作
      const client2 = new LedgerRepository(':memory:', 'node-client-2');
      const exchange2 = await server.inject({
        method: 'POST',
        url: '/api/sync/exchange',
        body: {
          clientNodeId: 'node-client-2',
          sinceHlc: null,
          ops: [],
        },
      });
      expect(exchange2.statusCode).toBe(200);
      expect(exchange2.body.serverOps.length).toBe(1);

      // 客户端 2 应用远端日志并验证与服务端强一致
      client2.applyRemoteOpLogs(exchange2.body.serverOps);
      const client2Daily = client2
        .getMonthlyBudgetStatus('2026-11')
        .pools.find((p) => p.pool_id === 'POOL_DAILY');
      expect(client2Daily?.spent_net).toBe('88.00');
      expect(client2.getRecentTransactions(10).length).toBe(1);
    });
  });

  // ==========================================================================
  // 测试 5：双端离线并发编辑同一笔订单触发冲突，并通过 /api/conflicts/:id/resolve 解决冲突
  // ==========================================================================
  describe('5. Concurrent Offline Conflict Detection & Resolution', () => {
    it('should detect conflicting modifications and resolve properly', async () => {
      // 1. 服务端先创建基准交易
      const seedTx = (
        await server.inject({
          method: 'POST',
          url: '/api/transactions/dsl',
          body: {
            rawText: '基础订单 30.00 #饮食 @主力银联卡',
            txDate: '2026-11-12',
          },
        })
      ).body.transaction;

      // 2. Client A 与 Client B 分别拉取该基准交易
      const clientA = new LedgerRepository(':memory:', 'client-A');
      const clientB = new LedgerRepository(':memory:', 'client-B');
      const serverOps = server.repo.getOpLogs();
      clientA.applyRemoteOpLogs(serverOps);
      clientB.applyRemoteOpLogs(serverOps);

      // 3. Client A 离线基于 seedTx (base_hlc = seedTx.header.updated_hlc) 将金额改为 50 元
      const opA = {
        hlc: clientA.hlc.now(),
        node_id: clientA.nodeId,
        entity_type: 'TRANSACTION',
        entity_id: seedTx.header.id,
        op_type: 'UPSERT',
        payload_json: JSON.stringify({
          base_hlc: seedTx.header.updated_hlc,
          header: {
            ...seedTx.header,
            total_gross: '50.00',
            total_net: '50.00',
            merchant_or_note: 'Client A 修改版 50元',
            updated_hlc: clientA.hlc.now(),
          },
          items: [
            {
              item_name: '修改项A',
              category_id: 'CAT_FOOD',
              budget_pool_id: 'POOL_DAILY',
              item_gross: '50.00',
              allocated_discount: '0.00',
              item_net: '50.00',
              is_primary_item: true,
            },
          ],
        }),
        created_at: new Date().toISOString(),
      };

      // 4. Client B 离线同样基于旧版本 seedTx 并发将金额改为 80 元
      const opB = {
        hlc: clientB.hlc.now(),
        node_id: clientB.nodeId,
        entity_type: 'TRANSACTION',
        entity_id: seedTx.header.id,
        op_type: 'UPSERT',
        payload_json: JSON.stringify({
          base_hlc: seedTx.header.updated_hlc,
          header: {
            ...seedTx.header,
            total_gross: '80.00',
            total_net: '80.00',
            merchant_or_note: 'Client B 修改版 80元',
            updated_hlc: clientB.hlc.now(),
          },
          items: [
            {
              item_name: '修改项B',
              category_id: 'CAT_FOOD',
              budget_pool_id: 'POOL_DAILY',
              item_gross: '80.00',
              allocated_discount: '0.00',
              item_net: '80.00',
              is_primary_item: true,
            },
          ],
        }),
        created_at: new Date().toISOString(),
      };

      // 5. Client A 先同步至服务端
      await server.inject({
        method: 'POST',
        url: '/api/sync/exchange',
        body: { clientNodeId: 'client-A', ops: [opA] },
      });

      // 6. Client B 随后同步至服务端，由于两者存在并发修改，触发冲突检测
      const exchangeB = await server.inject({
        method: 'POST',
        url: '/api/sync/exchange',
        body: { clientNodeId: 'client-B', ops: [opB] },
      });
      expect(exchangeB.statusCode).toBe(200);
      expect(exchangeB.body.conflicts.length).toBe(1);

      const conflict = exchangeB.body.conflicts[0];
      expect(conflict.entity_id).toBe(seedTx.header.id);
      expect(conflict.status).toBe('PENDING');

      // 7. 人工仲裁冲突：采纳落败方 (USE_LOSER)
      const resolveRes = await server.inject({
        method: 'POST',
        url: `/api/conflicts/${conflict.id}/resolve`,
        body: { resolution: 'USE_LOSER' },
      });
      expect(resolveRes.statusCode).toBe(200);
      expect(resolveRes.body.conflict.status).toBe('RESOLVED');

      // 验证冲突已被解决
      const conflictsList = (
        await server.inject({
          method: 'GET',
          url: '/api/conflicts',
        })
      ).body;
      const targetConflict = conflictsList.find(
        (c: any) => c.id === conflict.id
      );
      expect(targetConflict.status).toBe('RESOLVED');
    });
  });

  // ==========================================================================
  // 测试 6：防炸机全链路演练 (Disaster Recovery: Crash -> Reseed -> 100% Recovery)
  // ==========================================================================
  describe('6. Disaster Recovery Full Loop (Crash & Reseed)', () => {
    it('should recover 100% state from client bundle after server database crash', async () => {
      // 1. 客户端建立丰富的账本状态
      const client = new LedgerRepository(':memory:', 'client-dr-tester');

      // 录入多笔交易
      client.recordFromDsl('聚餐 120.00 #饮食', '2026-11-05');
      client.recordFromDsl('冬季保暖卫衣 200.00 #服饰', '2026-11-06');
      client.recordFromDsl('咖啡 35.00 #饮食', '2026-11-07');

      // 2. 客户端向服务端同步全量操作日志
      const initialExchange = await server.inject({
        method: 'POST',
        url: '/api/sync/exchange',
        body: {
          clientNodeId: 'client-dr-tester',
          sinceHlc: null,
          ops: client.getOpLogs(),
        },
      });
      expect(initialExchange.statusCode).toBe(200);

      // 记录服务端炸机前的基准状态看板
      const preCrashState = (
        await server.inject({
          method: 'GET',
          url: '/api/state?yearMonth=2026-11&currentDate=2026-11-12',
        })
      ).body;
      const initialEpoch = server.serverEpochId;

      expect(preCrashState.oplogCount).toBeGreaterThanOrEqual(3);
      expect(preCrashState.transactions.length).toBeGreaterThanOrEqual(3);

      // 3. 模拟服务器硬盘物理损坏/空库重启！(/api/sync/simulate-crash)
      const crashRes = await server.inject({
        method: 'POST',
        url: '/api/sync/simulate-crash',
      });
      expect(crashRes.statusCode).toBe(200);
      expect(crashRes.body.crashed).toBe(true);
      expect(crashRes.body.oplogCount).toBe(0);
      expect(crashRes.body.newServerEpochId).not.toBe(initialEpoch);

      // 验证服务端确实已被“彻底清空并归零”
      const wipedState = (
        await server.inject({
          method: 'GET',
          url: '/api/state',
        })
      ).body;
      expect(wipedState.oplogCount).toBe(0);
      expect(wipedState.transactions).toEqual([]);
      expect(wipedState.latestHlc).toBeNull();

      // 4. 客户端检测到服务器纪元变化/炸机，调用 /api/sync/reseed 执行全量反向冷备恢复
      const clientBundle = client.exportFullSyncBundle();
      const reseedRes = await server.inject({
        method: 'POST',
        url: '/api/sync/reseed',
        body: { bundle: clientBundle },
      });
      expect(reseedRes.statusCode).toBe(200);
      expect(reseedRes.body.restored).toBe(true);
      expect(reseedRes.body.oplogCount).toBe(clientBundle.oplogs.length);

      // 5. 验证服务端 100% 恢复如初！
      const recoveredState = (
        await server.inject({
          method: 'GET',
          url: '/api/state?yearMonth=2026-11&currentDate=2026-11-12',
        })
      ).body;

      // 流水明细 100% 恢复
      expect(recoveredState.transactions.length).toBe(
        preCrashState.transactions.length
      );

      // 预算池执行水位 100% 恢复
      const recoveredDailyPool = recoveredState.budgetStatus.pools.find(
        (p: any) => p.pool_id === 'POOL_DAILY'
      );
      const preDailyPool = preCrashState.budgetStatus.pools.find(
        (p: any) => p.pool_id === 'POOL_DAILY'
      );
      expect(recoveredDailyPool.spent_net).toBe(preDailyPool.spent_net);
      expect(recoveredDailyPool.spent_net).toBe('155.00');

      // 备份导出接口可用性验证
      const exportRes = await server.inject({
        method: 'GET',
        url: '/api/backup/export',
      });
      expect(exportRes.statusCode).toBe(200);
      expect(exportRes.body.oplogs.length).toBe(clientBundle.oplogs.length);
    });
  });

  // ==========================================================================
  // 测试 7：真实 HTTP Server 端口监听、CORS 头与静态 SPA Fallback
  // ==========================================================================
  describe('7. Real HTTP Server, CORS & Static SPA History Fallback', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-dist-test-'));
      fs.writeFileSync(
        path.join(tmpDir, 'index.html'),
        '<!DOCTYPE html><html><body><h1>Ledger SPA App</h1></body></html>'
      );
      fs.writeFileSync(
        path.join(tmpDir, 'main.js'),
        'console.log("ledger loaded");'
      );
    });

    afterEach(() => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    });

    it('should serve static files, CORS headers, and SPA history fallback', async () => {
      const realServer = createLedgerServer({
        clientDistDir: tmpDir,
      });

      try {
        // 1. GET /api/health 请求与 CORS 响应头验证
        const healthRes = await realServer.inject({
          method: 'GET',
          url: '/api/health',
        });
        expect(healthRes.statusCode).toBe(200);
        expect(healthRes.body.status).toBe('ok');
        expect(healthRes.headers['access-control-allow-origin']).toBe('*');

        // 2. 静态 JS 文件托管
        const jsRes = await realServer.inject({
          method: 'GET',
          url: '/main.js',
        });
        expect(jsRes.statusCode).toBe(200);
        expect(jsRes.body).toBe('console.log("ledger loaded");');
        expect(jsRes.headers['content-type']).toContain('application/javascript');

        // 3. SPA 任意深层前端路由回退到 index.html
        const spaRes = await realServer.inject({
          method: 'GET',
          url: '/dashboard/budgets',
        });
        expect(spaRes.statusCode).toBe(200);
        expect(spaRes.body).toContain('Ledger SPA App');
        expect(spaRes.headers['content-type']).toContain('text/html');

        // 4. POST JSON 字符串请求体解析与流水写入
        const postRes = await realServer.inject({
          method: 'POST',
          url: '/api/transactions/dsl',
          body: JSON.stringify({
            rawText: '早餐 15.00 #饮食',
            txDate: '2026-11-12',
          }),
        });
        expect(postRes.statusCode).toBe(200);
        expect(postRes.body.transaction.header.total_net).toBe('15.00');
      } finally {
        await realServer.close();
      }
    });
  });

  // ==========================================================================
  // 测试 7：Stage 8 全生命周期 CRUD REST Endpoints 综合闭环测试
  // ==========================================================================
  describe('7. Stage 8 Full-Lifecycle CRUD REST Endpoints Integration', () => {
    it('should support manual transaction recording, update, and soft delete via REST API', async () => {
      // 1. POST /api/transactions/manual
      const createRes = await server.inject({
        method: 'POST',
        url: '/api/transactions/manual',
        body: {
          tx_type: 'EXPENSE',
          tx_date: '2026-11-12',
          amount: '88.00',
          discount: '8.00',
          category_id: 'CAT_FOOD',
          merchant_or_note: '老北京炸酱面',
        },
      });
      expect(createRes.statusCode).toBe(200);
      const tx = createRes.body.transaction;
      expect(tx.header.total_gross).toBe('88.00');
      expect(tx.header.payment_discount).toBe('8.00');
      expect(tx.header.total_net).toBe('80.00');

      // 2. PUT /api/transactions/:id
      const updateRes = await server.inject({
        method: 'PUT',
        url: `/api/transactions/${tx.header.id}`,
        body: {
          total_gross: '98.00',
          merchant_or_note: '老北京炸酱面+北冰洋',
        },
      });
      expect(updateRes.statusCode).toBe(200);
      expect(updateRes.body.transaction.header.total_gross).toBe('98.00');
      expect(updateRes.body.transaction.header.total_net).toBe('90.00');
      expect(updateRes.body.transaction.header.merchant_or_note).toBe('老北京炸酱面+北冰洋');

      // 3. DELETE /api/transactions/:id
      const deleteRes = await server.inject({
        method: 'DELETE',
        url: `/api/transactions/${tx.header.id}`,
      });
      expect(deleteRes.statusCode).toBe(200);
      expect(deleteRes.body.deleted).toBe(true);
    });

    it('should support budget pools, categories, project tags, and recurring rules CRUD', async () => {
      // 1. Budget Pool & Monthly Budget
      const poolRes = await server.inject({
        method: 'POST',
        url: '/api/budget-pools',
        body: {
          id: 'POOL_SERVER_TEST',
          name: '服务端测试专项池',
          pool_type: 'FLEX',
          is_monthly_budget: true,
          base_allocation: '200.00',
        },
      });
      expect(poolRes.statusCode).toBe(200);

      // 2. Category
      const catRes = await server.inject({
        method: 'POST',
        url: '/api/categories',
        body: {
          id: 'CAT_SERVER_TEST',
          name: '服务端测试分类',
          default_pool_id: 'POOL_SERVER_TEST',
        },
      });
      expect(catRes.statusCode).toBe(200);

      // 3. Project Tag
      const tagRes = await server.inject({
        method: 'POST',
        url: '/api/project-tags',
        body: {
          id: 'TAG_SERVER_TEST',
          name: '心愿单：测试立项',
          target_budget: '500.00',
        },
      });
      expect(tagRes.statusCode).toBe(200);

      // 4. Recurring Rule & Execute
      const ruleRes = await server.inject({
        method: 'POST',
        url: '/api/recurring-rules',
        body: {
          title: '服务器托管月付',
          rule_type: 'FIXED_EXPENSE',
          amount: '99.00',
          budget_pool_id: 'POOL_FIXED',
        },
      });
      expect(ruleRes.statusCode).toBe(200);
      const ruleId = ruleRes.body.rule.id;

      const execRes = await server.inject({
        method: 'POST',
        url: `/api/recurring-rules/${ruleId}/execute`,
        body: { txDate: '2026-11-12' },
      });
      expect(execRes.statusCode).toBe(200);
      expect(execRes.body.transaction.header.total_gross).toBe('99.00');
    });
  });

  // ==========================================================================
  // 测试 8：Stage 13 自定义实体（资金池、心愿标签、卡券）同步与全量灾备恢复免外键冲突
  // ==========================================================================
  describe('8. Stage 13 Custom Entities Sync & Reseed Without FK Errors', () => {
    it('能够成功同步 (POST /api/sync/exchange) 和灾备重置 (POST /api/sync/reseed) 包含心愿目标、资金池的完整流水', async () => {
      const client = new LedgerRepository(':memory:', 'client-stage13-tester');

      // 1. 创建自定义资金池
      client.upsertBudgetPool({
        id: 'POOL_CUSTOM_EQUIP',
        name: '数码极客装备池',
        pool_type: 'FLEX',
        is_monthly_budget: true,
        base_allocation: '800.00',
      });

      // 2. 创建自定义商品属性分类
      client.upsertCategory({
        id: 'CAT_CUSTOM_KEYBOARD',
        name: '客制化机械键盘',
        default_pool_id: 'POOL_CUSTOM_EQUIP',
      });

      // 3. 创建自定义心愿目标与专项立项
      client.upsertProjectTag({
        id: 'TAG_CUSTOM_HHKB',
        name: '心愿单：HHKB 静电容键盘',
        tag_type: 'PROJECT',
        target_budget: '1800.00',
      });

      // 4. 记一笔引用自定义分类、自定义资金池与自定义心愿标签的交易
      client.recordTransaction({
        header: {
          tx_date: '2026-11-12',
          tx_type: 'EXPENSE',
          total_gross: '120.00',
          platform_discount: '0.00',
          payment_discount: '0.00',
          total_net: '120.00',
          allocation_mode: 'SINGLE',
          original_currency: 'CNY',
          original_amount: null,
          exchange_rate: '1.000000',
          settlement_status: 'SETTLED',
          hold_amount_cny: '0.00',
          settled_at: null,
          raw_input_text: 'HHKB键盘配件 120.00',
          merchant_or_note: 'HHKB键盘配件',
        },
        items: [
          {
            item_name: 'HHKB静电容轴体',
            category_id: 'CAT_CUSTOM_KEYBOARD',
            budget_pool_id: 'POOL_CUSTOM_EQUIP',
            project_tag_id: 'TAG_CUSTOM_HHKB',
            item_gross: '120.00',
            allocated_discount: '0.00',
            item_net: '120.00',
            is_primary_item: true,
          },
        ],
      });

      // 6. 测试 POST /api/sync/exchange：增量同步操作日志到服务端
      const exchangeRes = await server.inject({
        method: 'POST',
        url: '/api/sync/exchange',
        body: {
          clientNodeId: client.nodeId,
          sinceHlc: null,
          ops: client.getOpLogs(),
        },
      });

      expect(exchangeRes.statusCode).toBe(200);
      expect(exchangeRes.body.error).toBeUndefined();
      expect(exchangeRes.body.appliedCount).toBeGreaterThan(0);

      // 7. 模拟服务端灾备重置：POST /api/sync/simulate-crash
      const crashRes = await server.inject({
        method: 'POST',
        url: '/api/sync/simulate-crash',
      });
      expect(crashRes.statusCode).toBe(200);

      // 8. 测试 POST /api/sync/reseed：使用 client.exportFullSyncBundle() 恢复空库
      const clientBundle = client.exportFullSyncBundle();
      const reseedRes = await server.inject({
        method: 'POST',
        url: '/api/sync/reseed',
        body: { bundle: clientBundle },
      });

      expect(reseedRes.statusCode).toBe(200);
      expect(reseedRes.body.error).toBeUndefined();
      expect(reseedRes.body.restored).toBe(true);

      // 9. 验证恢复后的服务端状态，确保无外键约束阻断且数据全部完整
      const stateRes = await server.inject({
        method: 'GET',
        url: '/api/state?yearMonth=2026-11&currentDate=2026-11-12',
      });
      expect(stateRes.statusCode).toBe(200);

      const customTag = stateRes.body.metadata.projectTags.find(
        (t: any) => t.id === 'TAG_CUSTOM_HHKB'
      );
      expect(customTag).toBeDefined();
      expect(customTag.target_budget).toBe('1800.00');
    });
  });
});
