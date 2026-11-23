import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  roundCny,
  roundRate,
  sumCny,
  equalsCny,
  evaluateMathFormula,
  parseQuickInputDsl,
  allocateSplitDiscounts,
  processMastercardFxLifecycle,
  mergeOpLogEntries,
  toDecimal,
  type AllocationMode,
} from '../src/index.js';
import { LedgerRepository } from '../../db/src/ledger-repository.js';
import { LocalLedgerEngine } from '../../../apps/client/src/sync/local-replica.js';

const goldenPath = path.resolve(
  import.meta.dirname,
  '../../../docs/golden_test_cases.json'
);
const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8')) as {
  meta: {
    seed_budget_pools: any[];
    seed_categories: any[];
    seed_project_tags: any[];
  };
  suites: Record<string, any[]>;
};

function assertTxHeaderAndItems(
  actual: any,
  expected: any,
  txRefToId: Record<string, string>
) {
  for (const [k, v] of Object.entries(expected.header)) {
    if (k === 'tx_ref') {
      const ref = v as string;
      if (txRefToId[ref]) {
        expect(actual.header.id).toBe(txRefToId[ref]);
      }
      continue;
    }
    expect(v === null ? (actual.header[k] ?? null) : actual.header[k], `header.${k}`).toEqual(v);
  }
  expect(actual.items.length).toBe(expected.items.length);
  expected.items.forEach((ei: any, idx: number) => {
    const ai = actual.items[idx];
    for (const [k, v] of Object.entries(ei)) {
      if (k === 'item_index') {
        expect(ai[k] ?? idx, `items[${idx}].${k}`).toEqual(v);
      } else {
        expect(v === null ? (ai[k] ?? null) : ai[k], `items[${idx}].${k}`).toEqual(v);
      }
    }
  });
}

function assertPoolsMatch(actualPools: any[], expectedPools: any[]) {
  expect(actualPools.length).toBe(expectedPools.length);
  for (const ep of expectedPools) {
    const ap = actualPools.find((p) => p.pool_id === ep.pool_id);
    expect(ap, `pool ${ep.pool_id}`).toBeDefined();
    for (const [k, v] of Object.entries(ep)) {
      expect(ap[k], `${ep.pool_id}.${k}`).toEqual(v);
    }
  }
}

function assertDashboardMatch(actual: any, expected: any) {
  assertPoolsMatch(actual.pools, expected.pools);
  expect(actual.dailyPoolRemainingPerDay).toBe(expected.dailyPoolRemainingPerDay);
  expect(actual.totalMonthlyBudget).toBe(expected.totalMonthlyBudget);
  expect(actual.totalMonthlySpent).toBe(expected.totalMonthlySpent);
  expect(actual.totalMonthlySaved).toBe(expected.totalMonthlySaved);
}

describe('Golden Unification: Rust WASM (@ledger/core) + Server (LedgerRepository) + Web (LocalLedgerEngine)', () => {
  it('matches all 6 pure golden suites in @ledger/core (Rust WASM)', () => {
    const { meta, suites } = golden;

    for (const c of suites.money_rounding_and_helpers) {
      if (c.fn === 'roundCny') {
        expect(roundCny(c.input).toFixed(2)).toBe(c.expected);
      } else if (c.fn === 'roundRate') {
        const [a, b] = (c.input as string).split('/').map((s) => s.trim());
        const val = b ? toDecimal(a).div(toDecimal(b)) : toDecimal(a);
        expect(roundRate(val).toFixed(6)).toBe(c.expected);
      } else if (c.fn === 'sumCny') {
        expect(sumCny(c.input).toFixed(2)).toBe(c.expected);
      } else if (c.fn === 'equalsCny') {
        expect(equalsCny(c.input[0], c.input[1])).toBe(c.expected);
      }
    }

    for (const c of suites.math_formula_eval) {
      expect(evaluateMathFormula(c.input.expr)).toEqual(c.expected);
    }

    for (const c of suites.dsl_parser) {
      const got = parseQuickInputDsl(c.input.rawText, {
        categories: meta.seed_categories,
        projectTags: meta.seed_project_tags,
        budgetPools: meta.seed_budget_pools,
        txDate: c.input.txDate,
        fxConfig: c.input.fxConfig ?? undefined,
      });
      for (const [k, v] of Object.entries(c.expected)) {
        if (k === 'items') {
          expect(got.items.length).toBe((v as any[]).length);
          (v as any[]).forEach((ei, idx) => {
            expect(got.items[idx]).toMatchObject(ei);
          });
        } else {
          expect((got as any)[k]).toEqual(v);
        }
      }
    }

    for (const c of suites.split_discount_allocation) {
      const got = allocateSplitDiscounts(
        c.input.items,
        c.input.totalNetPaid,
        (c.input.mode ?? 'PROPORTIONAL') as AllocationMode,
        c.input.manualNets
      );
      expect(got.length).toBe(c.expected.length);
      c.expected.forEach((ei: any, idx: number) => {
        expect(got[idx]).toMatchObject(ei);
      });
    }

    for (const c of suites.mastercard_fx_lifecycle) {
      const got = processMastercardFxLifecycle(c.input);
      expect(got).toEqual(c.expected);
    }
  });

  const scenarios = golden.suites.end_to_end_ledger_scenarios;
  const getScenario = (id: string) =>
    scenarios.find((s) => s.id === id)!;

  it('Scenario A: Server & Web match golden phase 1 & phase 2 identically', () => {
    const sa = getScenario('scenario_a_routine_expense_income_and_daily_summary');
    const evalDate = sa.evaluation_date as string;

    const runPhase1 = (engine: LedgerRepository | LocalLedgerEngine) => {
      for (const act of sa.actions_phase_1_normal) {
        if (act.type === 'recordFromDsl') {
          engine.recordFromDsl(act.rawText, act.txDate);
        } else {
          engine.recordManualTransaction(act.params);
        }
      }
      const dash =
        engine instanceof LocalLedgerEngine
          ? engine.getMonthlyBudgetDashboard('2026-11', evalDate)
          : engine.getMonthlyBudgetStatus('2026-11', evalDate);
      assertDashboardMatch(dash, sa.expected_phase_1_normal.monthly_budget_status);

      if (engine instanceof LocalLedgerEngine) {
        expect(engine.getDailyBudgetSummary('2026-11', evalDate)).toEqual(
          sa.expected_phase_1_normal.client_daily_budget_summary
        );
      }
    };

    runPhase1(new LedgerRepository(':memory:', 'server-a1'));
    const web1 = new LocalLedgerEngine('web-a1');
    web1.resetToSeed();
    runPhase1(web1);

    const runPhase2 = (engine: LedgerRepository | LocalLedgerEngine) => {
      const txs = sa.actions_phase_2_with_overspend.map((act: any) =>
        act.type === 'recordFromDsl'
          ? engine.recordFromDsl(act.rawText, act.txDate)
          : engine.recordManualTransaction(act.params)
      );
      const refs = {
        TX_1: txs[0].header.id,
        TX_2: txs[1].header.id,
        TX_3: txs[2].header.id,
      };
      sa.expected_phase_2_with_overspend.transactions.forEach((et: any, i: number) => {
        assertTxHeaderAndItems(txs[i], et, refs);
      });
      const dash =
        engine instanceof LocalLedgerEngine
          ? engine.getMonthlyBudgetDashboard('2026-11', evalDate)
          : engine.getMonthlyBudgetStatus('2026-11', evalDate);
      assertDashboardMatch(dash, sa.expected_phase_2_with_overspend.monthly_budget_status);
      if (engine instanceof LocalLedgerEngine) {
        expect(engine.getDailyBudgetSummary('2026-11', evalDate)).toEqual(
          sa.expected_phase_2_with_overspend.client_daily_budget_summary
        );
      }
    };

    runPhase2(new LedgerRepository(':memory:', 'server-a2'));
    const web2 = new LocalLedgerEngine('web-a2');
    web2.resetToSeed();
    runPhase2(web2);
  });

  it('Scenario B: cross-pool split + tail diff + item edit matches on Server & Web', () => {
    const sb = getScenario('scenario_b_cross_pool_split_tail_diff_and_item_edit');

    const runB = (engine: LedgerRepository | LocalLedgerEngine) => {
      const tx1 = engine.recordFromDsl(sb.actions[0].rawText, sb.actions[0].txDate);
      const refs = { TX_1: tx1.header.id };
      assertTxHeaderAndItems(tx1, sb.expected.after_step_1_tx, refs);
      const d1 =
        engine instanceof LocalLedgerEngine
          ? engine.getMonthlyBudgetDashboard('2026-11', '2026-11-15')
          : engine.getMonthlyBudgetStatus('2026-11', '2026-11-15');
      assertDashboardMatch(d1, sb.expected.after_step_1_budget_status);

      const tx1Up = engine.updateTransaction(tx1.header.id, sb.actions[1].patch);
      assertTxHeaderAndItems(tx1Up, sb.expected.after_step_2_tx, refs);
      const d2 =
        engine instanceof LocalLedgerEngine
          ? engine.getMonthlyBudgetDashboard('2026-11', '2026-11-15')
          : engine.getMonthlyBudgetStatus('2026-11', '2026-11-15');
      assertDashboardMatch(d2, sb.expected.after_step_2_budget_status);
    };

    runB(new LedgerRepository(':memory:', 'server-b'));
    const web = new LocalLedgerEngine('web-b');
    web.resetToSeed();
    runB(web);
  });

  it('Scenario D: Mastercard FX pre-auth & settlement (1% vs 0% cashback) matches on Server & Web', () => {
    const sd = getScenario('scenario_d_mastercard_fx_hold_and_settlement');

    const runD = (engine: LedgerRepository | LocalLedgerEngine) => {
      const tx1 = engine.recordFromDsl(sd.actions[0].rawText, sd.actions[0].txDate);
      const refs: Record<string, string> = { TX_1: tx1.header.id };
      assertTxHeaderAndItems(tx1, sd.expected.step_1_hold_tx, refs);

      const tx2 = engine.recordManualTransaction(sd.actions[1].params);
      refs.TX_2 = tx2.header.id;
      assertTxHeaderAndItems(tx2, sd.expected.step_2_hold_tx_zero_cb, refs);

      const dHold =
        engine instanceof LocalLedgerEngine
          ? engine.getMonthlyBudgetDashboard('2026-11', '2026-11-15')
          : engine.getMonthlyBudgetStatus('2026-11', '2026-11-15');
      assertDashboardMatch(dHold, sd.expected.after_hold_budget_status);

      const tx1S = engine.settleMastercardTransaction(
        refs.TX_1,
        sd.actions[2].settledAmountCny
      );
      assertTxHeaderAndItems(tx1S, sd.expected.step_3_settled_tx_1pct, refs);

      const tx2S = engine.settleMastercardTransaction(
        refs.TX_2,
        sd.actions[3].settledAmountCny
      );
      assertTxHeaderAndItems(tx2S, sd.expected.step_4_settled_tx_0pct, refs);

      const dSettle =
        engine instanceof LocalLedgerEngine
          ? engine.getMonthlyBudgetDashboard('2026-11', '2026-11-15')
          : engine.getMonthlyBudgetStatus('2026-11', '2026-11-15');
      assertDashboardMatch(dSettle, sd.expected.after_settle_budget_status);
    };

    runD(new LedgerRepository(':memory:', 'server-d'));
    const web = new LocalLedgerEngine('web-d');
    web.resetToSeed();
    runD(web);
  });

  it('Scenario E: project exemption & month rollover (ACCUMULATE + RESET) matches on Server & Web', () => {
    const se = getScenario('scenario_e_project_exemption_and_month_rollover');

    const runE = (engine: LedgerRepository | LocalLedgerEngine) => {
      for (let i = 0; i < 4; i++) {
        engine.recordFromDsl(se.actions[i].rawText, se.actions[i].txDate);
      }
      const dNov =
        engine instanceof LocalLedgerEngine
          ? engine.getMonthlyBudgetDashboard('2026-11', '2026-11-15')
          : engine.getMonthlyBudgetStatus('2026-11', '2026-11-15');
      assertDashboardMatch(dNov, se.expected.nov_2026_budget_status);

      const decRollover = engine.executeMonthRollover(
        se.actions[4].fromYearMonth,
        se.actions[4].toYearMonth
      );
      const decPools = Array.isArray(decRollover)
        ? decRollover
        : (decRollover as any).pools;
      assertPoolsMatch(decPools, se.expected.dec_2026_after_all_accumulate_rollover);

      engine.recordFromDsl(se.actions[5].rawText, se.actions[5].txDate);
      const dDec =
        engine instanceof LocalLedgerEngine
          ? engine.getMonthlyBudgetDashboard('2026-12', '2026-12-15')
          : engine.getMonthlyBudgetStatus('2026-12', '2026-12-15');
      assertDashboardMatch(dDec, se.expected.dec_2026_before_jan_rollover);

      engine.upsertBudgetPool({
        id: se.actions[6].id,
        name: '高频饮食与洗护池',
        pool_type: 'DAILY',
        rollover_strategy: se.actions[6].rollover_strategy,
      });

      const janRollover = engine.executeMonthRollover(
        se.actions[7].fromYearMonth,
        se.actions[7].toYearMonth
      );
      const janPools = Array.isArray(janRollover)
        ? janRollover
        : (janRollover as any).pools;
      assertPoolsMatch(janPools, se.expected.jan_2027_after_mixed_reset_accumulate_rollover);
    };

    runE(new LedgerRepository(':memory:', 'server-e'));
    const web = new LocalLedgerEngine('web-e');
    web.resetToSeed();
    runE(web);
  });

  it('merges Web OpLogs cleanly into Server via Rust mergeOpLogEntries', () => {
    const server = new LedgerRepository(':memory:', 'server-sync');
    const web = new LocalLedgerEngine('web-sync');
    web.resetToSeed();

    const webTx = web.recordFromDsl('测试sync 25 #饮食', '2026-11-15');
    const pendingOps = web.state.pendingSyncOps;
    expect(pendingOps.length).toBeGreaterThan(0);

    const serverExisting = server.getOpLogs();
    const rustMerged = mergeOpLogEntries(serverExisting, pendingOps);
    expect(rustMerged.mergedOps.length).toBeGreaterThan(0);
    expect(
      rustMerged.winningEntities.get(`TRANSACTION:${webTx.header.id}`)?.entity_id
    ).toBe(webTx.header.id);

    const applyRes = server.applyRemoteOpLogs(pendingOps);
    expect(applyRes.appliedCount).toBeGreaterThan(0);
    const syncedTxs = server.getRecentTransactions(10);
    expect(syncedTxs.some((t) => t.header.id === webTx.header.id)).toBe(true);
  });
});
