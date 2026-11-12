import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';
import {
  Decimal,
  toDecimal,
  formatCny,
  Category,
  ProjectTag,
  Voucher,
  VoucherType,
  SyncOpLogEntry,
  SyncConflict,
  TransactionAggregate,
  SplitItemInput,
  parseQuickInputDsl,
  computeOrderAllocation,
} from '@ledger/core';
import { LedgerRepository, FullSyncBundle } from '@ledger/db';

export interface LedgerServerOptions {
  dbPath?: string;
  nodeId?: string;
  clientDistDir?: string;
  currentYearMonth?: string;
  currentDate?: string;
}

export interface InjectRequest {
  method: string;
  url: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface InjectResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: any;
}

export interface LedgerServerInstance {
  inject(req: InjectRequest): Promise<InjectResponse>;
  listen(port: number, host?: string): Promise<http.Server>;
  close(): Promise<void>;
  readonly repo: LedgerRepository;
  readonly serverEpochId: string;
  readonly server: http.Server | null;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

interface DispatchResult {
  statusCode: number;
  headers?: Record<string, string>;
  body?: any;
  isStatic?: boolean;
  filePath?: string;
}

export function createLedgerServer(
  options: LedgerServerOptions = {}
): LedgerServerInstance {
  const dbPath = options.dbPath ?? ':memory:';
  const nodeId = options.nodeId ?? 'server-master';
  const clientDistDir = options.clientDistDir;

  let repo = new LedgerRepository(dbPath, nodeId);

  // 初始化或读取服务器纪元标识 serverEpochId
  let serverEpochId: string;
  try {
    const row = repo.db
      .prepare("SELECT value FROM sync_meta WHERE key = 'server_epoch_id'")
      .get() as { value: string } | undefined;
    if (row?.value) {
      serverEpochId = row.value;
    } else {
      serverEpochId = `epoch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      repo.db
        .prepare(
          "INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('server_epoch_id', ?)"
        )
        .run(serverEpochId);
    }
  } catch {
    serverEpochId = `epoch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  let serverInstance: http.Server | null = null;

  async function dispatch(req: {
    method: string;
    pathname: string;
    query: URLSearchParams;
    body: any;
    headers: Record<string, string>;
  }): Promise<DispatchResult> {
    const { method, pathname, query, body } = req;

    // 1. GET /api/health
    if (method === 'GET' && pathname === '/api/health') {
      const oplogs = repo.getOpLogs();
      return {
        statusCode: 200,
        body: {
          status: 'ok',
          nodeId: repo.nodeId,
          serverEpochId,
          oplogCount: oplogs.length,
        },
      };
    }

    // 2. GET /api/state
    if (method === 'GET' && pathname === '/api/state') {
      const ym =
        query.get('yearMonth') ||
        options.currentYearMonth ||
        new Date().toISOString().slice(0, 7);
      const cd =
        query.get('currentDate') ||
        options.currentDate ||
        new Date().toISOString().slice(0, 10);
      const oplogs = repo.getOpLogs();
      const latestHlc =
        oplogs.length > 0 ? oplogs[oplogs.length - 1].hlc : null;

      return {
        statusCode: 200,
        body: {
          nodeId: repo.nodeId,
          serverEpochId,
          yearMonth: ym,
          currentDate: cd,
          accounts: repo.getAccountDashboard(),
          budgetStatus: repo.getMonthlyBudgetStatus(ym, cd),
          transactions: repo.getRecentTransactions(100),
          pendingFxTransactions: repo.getPendingFxTransactions(),
          vouchers: repo.getVouchers(),
          fixedAssets: repo.getFixedAssetsWithCost(cd),
          metadata: repo.getMetadata(),
          conflicts: repo.getConflicts(),
          oplogCount: oplogs.length,
          latestHlc,
        },
      };
    }

    // 3. POST /api/dsl/preview
    if (method === 'POST' && pathname === '/api/dsl/preview') {
      const { rawText, txDate, appliedVoucherId } = (body as any) || {};
      if (!rawText || typeof rawText !== 'string') {
        return { statusCode: 400, body: { error: 'rawText is required' } };
      }
      try {
        const categories = repo.db
          .prepare('SELECT * FROM categories')
          .all() as unknown as Category[];
        const accounts = (
          repo.db
            .prepare(
              'SELECT id, name, account_role, is_default_pay FROM accounts'
            )
            .all() as any[]
        ).map((a) => ({
          ...a,
          is_default_pay: Boolean(a.is_default_pay),
        }));
        const projectTags = repo.db
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

        if (appliedVoucherId != null) {
          const voucher = repo.db
            .prepare('SELECT * FROM vouchers WHERE id = ?')
            .get(appliedVoucherId) as Voucher | undefined;

          if (voucher) {
            if (parsed.tx_type === 'EXPENSE') {
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
              if (toDecimal(paymentDiscount).isZero()) {
                paymentDiscount = formatCny(voucher.face_value);
              }
              totalNet = formatCny(
                toDecimal(totalGross).minus(toDecimal(paymentDiscount))
              );
            }
          }
        }

        return {
          statusCode: 200,
          body: {
            parsed: {
              ...parsed,
              total_gross: totalGross,
              payment_discount: paymentDiscount,
              platform_discount: platformDiscount,
              total_net: totalNet,
              items,
              applied_voucher_id: appliedVoucherId ?? null,
            },
          },
        };
      } catch (err) {
        return {
          statusCode: 400,
          body: { error: err instanceof Error ? err.message : String(err) },
        };
      }
    }

    // 4. POST /api/transactions/dsl
    if (method === 'POST' && pathname === '/api/transactions/dsl') {
      const { rawText, txDate, appliedVoucherId } = (body as any) || {};
      if (!rawText || typeof rawText !== 'string') {
        return { statusCode: 400, body: { error: 'rawText is required' } };
      }
      try {
        const transaction = repo.recordFromDsl(
          rawText,
          txDate,
          appliedVoucherId
        );
        return { statusCode: 200, body: { transaction } };
      } catch (err) {
        return {
          statusCode: 400,
          body: { error: err instanceof Error ? err.message : String(err) },
        };
      }
    }

    // 5. POST /api/transactions
    if (method === 'POST' && pathname === '/api/transactions') {
      try {
        const transaction = repo.recordTransaction(body as any);
        return { statusCode: 200, body: { transaction } };
      } catch (err) {
        return {
          statusCode: 400,
          body: { error: err instanceof Error ? err.message : String(err) },
        };
      }
    }

    // 6. POST /api/transactions/:id/settle-fx
    let m = pathname.match(/^\/api\/transactions\/([^/]+)\/settle-fx$/);
    if (method === 'POST' && m) {
      const id = decodeURIComponent(m[1]);
      const { settledAmountCny, settledAt } = (body as any) || {};
      if (!settledAmountCny) {
        return {
          statusCode: 400,
          body: { error: 'settledAmountCny is required' },
        };
      }
      try {
        const transaction = repo.settleMastercardTransaction(
          id,
          settledAmountCny,
          settledAt
        );
        return { statusCode: 200, body: { transaction } };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const statusCode = msg.includes('not found') ? 404 : 400;
        return { statusCode, body: { error: msg } };
      }
    }

    // 7. POST /api/accounts/:id/initial-balance
    m = pathname.match(/^\/api\/accounts\/([^/]+)\/initial-balance$/);
    if (method === 'POST' && m) {
      const id = decodeURIComponent(m[1]);
      const { initialBalance } = (body as any) || {};
      if (initialBalance === undefined || initialBalance === null) {
        return {
          statusCode: 400,
          body: { error: 'initialBalance is required' },
        };
      }
      try {
        repo.setAccountInitialBalance(id, String(initialBalance));
        return {
          statusCode: 200,
          body: { accounts: repo.getAccountDashboard() },
        };
      } catch (err) {
        return {
          statusCode: 400,
          body: { error: err instanceof Error ? err.message : String(err) },
        };
      }
    }

    // 8. POST /api/accounts/:id/market-value
    m = pathname.match(/^\/api\/accounts\/([^/]+)\/market-value$/);
    if (method === 'POST' && m) {
      const id = decodeURIComponent(m[1]);
      const { marketValue } = (body as any) || {};
      if (marketValue === undefined || marketValue === null) {
        return { statusCode: 400, body: { error: 'marketValue is required' } };
      }
      try {
        const account = repo.updateInvestmentMarketValue(id, String(marketValue));
        return { statusCode: 200, body: { account } };
      } catch (err) {
        return {
          statusCode: 400,
          body: { error: err instanceof Error ? err.message : String(err) },
        };
      }
    }

    // 9. POST /api/vouchers/buy
    if (method === 'POST' && pathname === '/api/vouchers/buy') {
      try {
        const result = repo.buyVoucher(body as any);
        return { statusCode: 200, body: result };
      } catch (err) {
        return {
          statusCode: 400,
          body: { error: err instanceof Error ? err.message : String(err) },
        };
      }
    }

    // 10. POST /api/budgets/sweep-to-fund
    if (method === 'POST' && pathname === '/api/budgets/sweep-to-fund') {
      const { yearMonth } = (body as any) || {};
      if (!yearMonth) {
        return { statusCode: 400, body: { error: 'yearMonth is required' } };
      }
      try {
        const result = repo.sweepDailyPoolToSinkingFund(yearMonth);
        return { statusCode: 200, body: result };
      } catch (err) {
        return {
          statusCode: 400,
          body: { error: err instanceof Error ? err.message : String(err) },
        };
      }
    }

    // 11. POST /api/budgets/rollover
    if (method === 'POST' && pathname === '/api/budgets/rollover') {
      const { fromYearMonth, toYearMonth } = (body as any) || {};
      if (!fromYearMonth || !toYearMonth) {
        return {
          statusCode: 400,
          body: { error: 'fromYearMonth and toYearMonth are required' },
        };
      }
      try {
        const pools = repo.executeMonthRollover(fromYearMonth, toYearMonth);
        return { statusCode: 200, body: { pools } };
      } catch (err) {
        return {
          statusCode: 400,
          body: { error: err instanceof Error ? err.message : String(err) },
        };
      }
    }

    // 12. POST /api/conflicts/:id/resolve
    m = pathname.match(/^\/api\/conflicts\/([^/]+)\/resolve$/);
    if (method === 'POST' && m) {
      const id = decodeURIComponent(m[1]);
      const { resolution } = (body as any) || {};
      if (resolution !== 'KEEP_WINNER' && resolution !== 'USE_LOSER') {
        return {
          statusCode: 400,
          body: { error: 'resolution must be KEEP_WINNER or USE_LOSER' },
        };
      }
      try {
        const conflict = repo.resolveConflict(id, resolution);
        if (!conflict) {
          return {
            statusCode: 404,
            body: { error: `Conflict with ID "${id}" not found` },
          };
        }
        return {
          statusCode: 200,
          body: { conflict, conflicts: repo.getConflicts() },
        };
      } catch (err) {
        return {
          statusCode: 400,
          body: { error: err instanceof Error ? err.message : String(err) },
        };
      }
    }

    // 13. GET /api/sync/status
    if (method === 'GET' && pathname === '/api/sync/status') {
      const oplogs = repo.getOpLogs();
      const latestHlc =
        oplogs.length > 0 ? oplogs[oplogs.length - 1].hlc : null;
      return {
        statusCode: 200,
        body: {
          nodeId: repo.nodeId,
          serverEpochId,
          oplogCount: oplogs.length,
          latestHlc,
        },
      };
    }

    // 14. POST /api/sync/exchange
    if (method === 'POST' && pathname === '/api/sync/exchange') {
      const { sinceHlc, ops } = (body as any) || {};
      try {
        const incomingOps: SyncOpLogEntry[] = Array.isArray(ops) ? ops : [];
        const { appliedCount } = repo.applyRemoteOpLogs(incomingOps);
        const serverOps = sinceHlc
          ? (repo.db
              .prepare('SELECT * FROM sync_oplog WHERE hlc > ? ORDER BY hlc ASC')
              .all(sinceHlc) as unknown as SyncOpLogEntry[])
          : repo.getOpLogs();

        return {
          statusCode: 200,
          body: {
            serverNodeId: repo.nodeId,
            serverEpochId,
            appliedCount,
            serverOps,
            conflicts: repo.getConflicts(),
            fullBundle: repo.exportFullSyncBundle(),
          },
        };
      } catch (err) {
        return {
          statusCode: 400,
          body: { error: err instanceof Error ? err.message : String(err) },
        };
      }
    }

    // 15. POST /api/sync/reseed
    if (method === 'POST' && pathname === '/api/sync/reseed') {
      const { bundle } = (body as any) || {};
      if (!bundle) {
        return {
          statusCode: 400,
          body: { error: 'Missing bundle in request body' },
        };
      }
      try {
        repo.reseedFromBundle(bundle);
        return {
          statusCode: 200,
          body: {
            restored: true,
            oplogCount: repo.getOpLogs().length,
            accounts: repo.getAccountDashboard(),
          },
        };
      } catch (err) {
        return {
          statusCode: 400,
          body: { error: err instanceof Error ? err.message : String(err) },
        };
      }
    }

    // 16. POST /api/sync/simulate-crash
    if (method === 'POST' && pathname === '/api/sync/simulate-crash') {
      try {
        repo.close();
        if (dbPath && dbPath !== ':memory:') {
          try {
            if (fs.existsSync(dbPath)) {
              fs.unlinkSync(dbPath);
            }
          } catch {}
        }
        repo = new LedgerRepository(dbPath, nodeId);
        serverEpochId = `epoch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        repo.db
          .prepare(
            "INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('server_epoch_id', ?)"
          )
          .run(serverEpochId);

        return {
          statusCode: 200,
          body: {
            crashed: true,
            newServerEpochId: serverEpochId,
            oplogCount: 0,
          },
        };
      } catch (err) {
        return {
          statusCode: 500,
          body: { error: err instanceof Error ? err.message : String(err) },
        };
      }
    }

    // 17. GET /api/backup/export
    if (method === 'GET' && pathname === '/api/backup/export') {
      return {
        statusCode: 200,
        body: repo.exportFullSyncBundle(),
      };
    }

    // 附加只读接口便于查询
    if (method === 'GET' && pathname === '/api/conflicts') {
      return { statusCode: 200, body: repo.getConflicts() };
    }
    if (method === 'GET' && pathname === '/api/transactions') {
      const limit = Number(query.get('limit') || 100);
      return { statusCode: 200, body: repo.getRecentTransactions(limit) };
    }
    if (method === 'GET' && pathname === '/api/vouchers') {
      return { statusCode: 200, body: repo.getVouchers() };
    }
    if (method === 'GET' && pathname === '/api/accounts') {
      return { statusCode: 200, body: repo.getAccountDashboard() };
    }

    // ========================================================================
    // Stage 8: 全生命周期 CRUD REST Endpoints
    // ========================================================================

    // 18. POST /api/transactions/manual
    if (method === 'POST' && pathname === '/api/transactions/manual') {
      try {
        const tx = repo.recordManualTransaction(body as any);
        return { statusCode: 200, body: { transaction: tx } };
      } catch (err) {
        return { statusCode: 400, body: { error: err instanceof Error ? err.message : String(err) } };
      }
    }

    // 19. PUT /api/transactions/:id
    let txMatch = pathname.match(/^\/api\/transactions\/([^/]+)$/);
    if (method === 'PUT' && txMatch) {
      const id = decodeURIComponent(txMatch[1]);
      try {
        const tx = repo.updateTransaction(id, body as any);
        return { statusCode: 200, body: { transaction: tx } };
      } catch (err) {
        return { statusCode: 400, body: { error: err instanceof Error ? err.message : String(err) } };
      }
    }

    // 20. DELETE /api/transactions/:id
    if (method === 'DELETE' && txMatch) {
      const id = decodeURIComponent(txMatch[1]);
      try {
        const tx = repo.deleteTransaction(id);
        return { statusCode: 200, body: { transaction: tx, deleted: true } };
      } catch (err) {
        return { statusCode: 400, body: { error: err instanceof Error ? err.message : String(err) } };
      }
    }

    // 21. POST /api/accounts
    if (method === 'POST' && pathname === '/api/accounts') {
      try {
        const account = repo.upsertAccount(body as any);
        return { statusCode: 200, body: { account, accounts: repo.getAccountDashboard() } };
      } catch (err) {
        return { statusCode: 400, body: { error: err instanceof Error ? err.message : String(err) } };
      }
    }

    // 22. POST /api/accounts/:id/calibrate
    let accCalibMatch = pathname.match(/^\/api\/accounts\/([^/]+)\/calibrate$/);
    if (method === 'POST' && accCalibMatch) {
      const id = decodeURIComponent(accCalibMatch[1]);
      const { targetBookBalance } = (body as any) || {};
      if (targetBookBalance === undefined || targetBookBalance === null) {
        return { statusCode: 400, body: { error: 'targetBookBalance is required' } };
      }
      try {
        const account = repo.calibrateAccountBalance(id, String(targetBookBalance));
        return { statusCode: 200, body: { account, accounts: repo.getAccountDashboard() } };
      } catch (err) {
        return { statusCode: 400, body: { error: err instanceof Error ? err.message : String(err) } };
      }
    }

    // 23. DELETE /api/accounts/:id
    let accMatch = pathname.match(/^\/api\/accounts\/([^/]+)$/);
    if (method === 'DELETE' && accMatch) {
      const id = decodeURIComponent(accMatch[1]);
      try {
        repo.deleteAccount(id);
        return { statusCode: 200, body: { success: true, accounts: repo.getAccountDashboard() } };
      } catch (err) {
        return { statusCode: 400, body: { error: err instanceof Error ? err.message : String(err) } };
      }
    }

    // 24. POST /api/budget-pools
    if (method === 'POST' && pathname === '/api/budget-pools') {
      try {
        const pool = repo.upsertBudgetPool(body as any);
        return { statusCode: 200, body: { pool } };
      } catch (err) {
        return { statusCode: 400, body: { error: err instanceof Error ? err.message : String(err) } };
      }
    }

    // 25. DELETE /api/budget-pools/:id
    let poolMatch = pathname.match(/^\/api\/budget-pools\/([^/]+)$/);
    if (method === 'DELETE' && poolMatch) {
      const id = decodeURIComponent(poolMatch[1]);
      try {
        repo.deleteBudgetPool(id);
        return { statusCode: 200, body: { success: true } };
      } catch (err) {
        return { statusCode: 400, body: { error: err instanceof Error ? err.message : String(err) } };
      }
    }

    // 26. POST /api/budgets/monthly
    if (method === 'POST' && pathname === '/api/budgets/monthly') {
      try {
        const budget = repo.upsertMonthlyBudget(body as any);
        return { statusCode: 200, body: { budget } };
      } catch (err) {
        return { statusCode: 400, body: { error: err instanceof Error ? err.message : String(err) } };
      }
    }

    // 27. POST /api/categories
    if (method === 'POST' && pathname === '/api/categories') {
      try {
        const category = repo.upsertCategory(body as any);
        return { statusCode: 200, body: { category } };
      } catch (err) {
        return { statusCode: 400, body: { error: err instanceof Error ? err.message : String(err) } };
      }
    }

    // 28. DELETE /api/categories/:id
    let catMatch = pathname.match(/^\/api\/categories\/([^/]+)$/);
    if (method === 'DELETE' && catMatch) {
      const id = decodeURIComponent(catMatch[1]);
      try {
        repo.deleteCategory(id);
        return { statusCode: 200, body: { success: true } };
      } catch (err) {
        return { statusCode: 400, body: { error: err instanceof Error ? err.message : String(err) } };
      }
    }

    // 29. POST /api/project-tags
    if (method === 'POST' && pathname === '/api/project-tags') {
      try {
        const tag = repo.upsertProjectTag(body as any);
        return { statusCode: 200, body: { tag } };
      } catch (err) {
        return { statusCode: 400, body: { error: err instanceof Error ? err.message : String(err) } };
      }
    }

    // 30. DELETE /api/project-tags/:id
    let tagMatch = pathname.match(/^\/api\/project-tags\/([^/]+)$/);
    if (method === 'DELETE' && tagMatch) {
      const id = decodeURIComponent(tagMatch[1]);
      try {
        repo.deleteProjectTag(id);
        return { statusCode: 200, body: { success: true } };
      } catch (err) {
        return { statusCode: 400, body: { error: err instanceof Error ? err.message : String(err) } };
      }
    }

    // 31. POST /api/vouchers
    if (method === 'POST' && pathname === '/api/vouchers') {
      try {
        const res = repo.upsertVoucher(body as any);
        return { statusCode: 200, body: res };
      } catch (err) {
        return { statusCode: 400, body: { error: err instanceof Error ? err.message : String(err) } };
      }
    }

    // 32. DELETE /api/vouchers/:id
    let vMatch = pathname.match(/^\/api\/vouchers\/([^/]+)$/);
    if (method === 'DELETE' && vMatch) {
      const id = Number(decodeURIComponent(vMatch[1]));
      try {
        repo.deleteVoucher(id);
        return { statusCode: 200, body: { success: true } };
      } catch (err) {
        return { statusCode: 400, body: { error: err instanceof Error ? err.message : String(err) } };
      }
    }

    // 33. POST /api/recurring-rules
    if (method === 'POST' && pathname === '/api/recurring-rules') {
      try {
        const rule = repo.upsertRecurringRule(body as any);
        return { statusCode: 200, body: { rule } };
      } catch (err) {
        return { statusCode: 400, body: { error: err instanceof Error ? err.message : String(err) } };
      }
    }

    // 34. DELETE /api/recurring-rules/:id
    let ruleMatch = pathname.match(/^\/api\/recurring-rules\/([^/]+)$/);
    if (method === 'DELETE' && ruleMatch) {
      const id = Number(decodeURIComponent(ruleMatch[1]));
      try {
        repo.deleteRecurringRule(id);
        return { statusCode: 200, body: { success: true } };
      } catch (err) {
        return { statusCode: 400, body: { error: err instanceof Error ? err.message : String(err) } };
      }
    }

    // 35. POST /api/recurring-rules/:id/execute
    let ruleExecMatch = pathname.match(/^\/api\/recurring-rules\/([^/]+)\/execute$/);
    if (method === 'POST' && ruleExecMatch) {
      const id = Number(decodeURIComponent(ruleExecMatch[1]));
      const { txDate } = (body as any) || {};
      try {
        const tx = repo.executeRecurringRule(id, txDate);
        return { statusCode: 200, body: { transaction: tx } };
      } catch (err) {
        return { statusCode: 400, body: { error: err instanceof Error ? err.message : String(err) } };
      }
    }

    // 未知 API 路由返回 404
    if (pathname.startsWith('/api')) {
      return {
        statusCode: 404,
        body: { error: `Endpoint not found: ${method} ${pathname}` },
      };
    }

    // 静态文件与 SPA History Fallback
    if (clientDistDir) {
      const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
      let targetPath = path.join(clientDistDir, safePath);
      if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
        targetPath = path.join(targetPath, 'index.html');
      }
      if (!fs.existsSync(targetPath)) {
        targetPath = path.join(clientDistDir, 'index.html');
      }
      if (fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
        return {
          isStatic: true,
          filePath: targetPath,
          statusCode: 200,
        };
      }
    }

    return {
      statusCode: 404,
      body: { error: 'Not Found' },
    };
  }

  return {
    get repo() {
      return repo;
    },
    get serverEpochId() {
      return serverEpochId;
    },
    get server() {
      return serverInstance;
    },

    async inject(req: InjectRequest): Promise<InjectResponse> {
      const urlObj = new URL(req.url, 'http://localhost');
      let bodyData = req.body;
      if (typeof bodyData === 'string' && bodyData.trim().startsWith('{')) {
        try {
          bodyData = JSON.parse(bodyData);
        } catch {}
      }

      const result = await dispatch({
        method: req.method.toUpperCase(),
        pathname: urlObj.pathname,
        query: urlObj.searchParams,
        body: bodyData,
        headers: req.headers ?? {},
      });

      if (result.isStatic && result.filePath) {
        const ext = path.extname(result.filePath).toLowerCase();
        const mime = MIME_TYPES[ext] ?? 'text/plain; charset=utf-8';
        const fileContent = fs.readFileSync(result.filePath, 'utf-8');
        return {
          statusCode: result.statusCode,
          headers: {
            'content-type': mime,
            'access-control-allow-origin': '*',
            ...(result.headers ?? {}),
          },
          body: fileContent,
        };
      }

      return {
        statusCode: result.statusCode,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'access-control-allow-origin': '*',
          ...(result.headers ?? {}),
        },
        body: result.body,
      };
    },

    listen(port: number, host = '0.0.0.0'): Promise<http.Server> {
      if (serverInstance) {
        return Promise.resolve(serverInstance);
      }

      return new Promise((resolve, reject) => {
        const srv = http.createServer(async (req, res) => {
          // CORS 跨域响应头设置
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader(
            'Access-Control-Allow-Methods',
            'GET, POST, PUT, DELETE, OPTIONS, PATCH'
          );
          res.setHeader(
            'Access-Control-Allow-Headers',
            'Content-Type, Authorization, X-Requested-With, X-Node-Id'
          );

          if (req.method === 'OPTIONS') {
            res.statusCode = 204;
            res.end();
            return;
          }

          let bodyData: any = undefined;
          if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method ?? '')) {
            const chunks: Buffer[] = [];
            for await (const chunk of req) {
              chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
            }
            const rawBody = Buffer.concat(chunks).toString('utf-8');
            if (rawBody.trim().length > 0) {
              try {
                bodyData = JSON.parse(rawBody);
              } catch {
                bodyData = rawBody;
              }
            }
          }

          const hostHeader = req.headers.host || `localhost:${port}`;
          const urlObj = new URL(req.url ?? '/', `http://${hostHeader}`);

          const result = await dispatch({
            method: (req.method ?? 'GET').toUpperCase(),
            pathname: urlObj.pathname,
            query: urlObj.searchParams,
            body: bodyData,
            headers: (req.headers as Record<string, string>) || {},
          });

          if (result.isStatic && result.filePath) {
            try {
              const ext = path.extname(result.filePath).toLowerCase();
              const mime = MIME_TYPES[ext] ?? 'application/octet-stream';
              const content = fs.readFileSync(result.filePath);
              res.statusCode = result.statusCode;
              res.setHeader('Content-Type', mime);
              res.end(content);
              return;
            } catch {
              res.statusCode = 404;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ error: 'File Not Found' }));
              return;
            }
          }

          res.statusCode = result.statusCode;
          for (const [k, v] of Object.entries(result.headers ?? {})) {
            res.setHeader(k, v);
          }
          if (!res.hasHeader('Content-Type')) {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
          }

          if (typeof result.body === 'string') {
            res.end(result.body);
          } else {
            res.end(JSON.stringify(result.body));
          }
        });

        srv.listen(port, host, () => {
          serverInstance = srv;
          resolve(srv);
        });

        srv.on('error', (err) => {
          reject(err);
        });
      });
    },

    async close(): Promise<void> {
      try {
        repo.close();
      } catch {}
      if (serverInstance) {
        await new Promise<void>((resolve, reject) => {
          serverInstance!.close((err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        serverInstance = null;
      }
    },
  };
}
