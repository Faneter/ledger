// ignore_for_file: avoid_relative_lib_imports

import 'dart:convert';
import 'dart:io';

import '../lib/src/ledger_engine.dart';
import '../lib/src/rust_bridge.dart';

int _passed = 0;
int _failed = 0;

void check(bool condition, String message) {
  if (condition) {
    _passed += 1;
  } else {
    _failed += 1;
    stderr.writeln('FAIL: $message');
  }
}

void checkEq(Object? actual, Object? expected, String label) {
  if (jsonEncode(actual) == jsonEncode(expected)) {
    _passed += 1;
  } else {
    _failed += 1;
    stderr.writeln('FAIL [$label]:\n  expected: $expected\n  actual:   $actual');
  }
}

/// Exact arbitrary decimal string division `a / b` scaled to 10^28 integer digits
/// so Rust `round_rate` / `format_rate` can round the ratio directly.
String _divDecimalString28(String aStr, String bStr) {
  ({BigInt coeff, int scale}) parseParts(String raw) {
    final t = raw.trim();
    final neg = t.startsWith('-');
    final body = (neg || t.startsWith('+')) ? t.substring(1) : t;
    final dot = body.indexOf('.');
    if (dot == -1) {
      final v = BigInt.parse(body);
      return (coeff: neg ? -v : v, scale: 0);
    }
    final i = body.substring(0, dot);
    final f = body.substring(dot + 1);
    final v = BigInt.parse('${i.isEmpty ? '0' : i}$f');
    return (coeff: neg ? -v : v, scale: f.length);
  }

  final pa = parseParts(aStr);
  final pb = parseParts(bStr);
  const targetScale = 28;
  final shift = targetScale - pa.scale + pb.scale;
  final numScaled = shift >= 0
      ? pa.coeff * BigInt.from(10).pow(shift)
      : pa.coeff ~/ BigInt.from(10).pow(-shift);
  final q = numScaled ~/ pb.coeff;
  final neg = q.isNegative;
  final absStr = q.abs().toString().padLeft(targetScale + 1, '0');
  final intPart = absStr.substring(0, absStr.length - targetScale);
  final fracPart = absStr.substring(absStr.length - targetScale);
  return '${neg ? '-' : ''}$intPart.$fracPart';
}

void assertTxMatches(
  Map<String, dynamic> actual,
  Map<String, dynamic> expected,
  Map<String, String> txRefToId,
  String label,
) {
  final ah = actual['header'] as Map<String, dynamic>;
  final eh = expected['header'] as Map<String, dynamic>;
  for (final entry in eh.entries) {
    if (entry.key == 'tx_ref') {
      final ref = entry.value as String;
      if (txRefToId.containsKey(ref)) {
        checkEq(ah['id'], txRefToId[ref], '$label.header.id($ref)');
      }
      continue;
    }
    checkEq(ah[entry.key], entry.value, '$label.header.${entry.key}');
  }

  final aItems = (actual['items'] as List<dynamic>).cast<Map<String, dynamic>>();
  final eItems = (expected['items'] as List<dynamic>).cast<Map<String, dynamic>>();
  checkEq(aItems.length, eItems.length, '$label.items.length');
  for (var i = 0; i < eItems.length; i++) {
    final ai = aItems[i];
    final ei = eItems[i];
    for (final entry in ei.entries) {
      checkEq(ai[entry.key], entry.value, '$label.items[$i].${entry.key}');
    }
  }
}

void assertPoolsMatch(
  List<Map<String, dynamic>> actual,
  List<dynamic> expected,
  String label,
) {
  checkEq(actual.length, expected.length, '$label.length');
  for (var i = 0; i < expected.length; i++) {
    final ep = expected[i] as Map<String, dynamic>;
    final ap = actual.firstWhere(
      (p) => p['pool_id'] == ep['pool_id'],
      orElse: () => <String, dynamic>{},
    );
    for (final entry in ep.entries) {
      checkEq(ap[entry.key], entry.value, '$label[${ep['pool_id']}].${entry.key}');
    }
  }
}

void assertBudgetDashboardMatches(
  Map<String, dynamic> actual,
  Map<String, dynamic> expected,
  String label,
) {
  assertPoolsMatch(
    (actual['pools'] as List<dynamic>).cast<Map<String, dynamic>>(),
    expected['pools'] as List<dynamic>,
    '$label.pools',
  );
  for (final key in <String>[
    'dailyPoolRemainingPerDay',
    'totalMonthlyBudget',
    'totalMonthlySpent',
    'totalMonthlySaved',
  ]) {
    if (expected.containsKey(key)) {
      checkEq(actual[key], expected[key], '$label.$key');
    }
  }
}

void main() {
  final goldenFile = File('docs/golden_test_cases.json');
  if (!goldenFile.existsSync()) {
    stderr.writeln('Cannot find docs/golden_test_cases.json from ${Directory.current.path}');
    exitCode = 1;
    return;
  }

  final golden = jsonDecode(goldenFile.readAsStringSync()) as Map<String, dynamic>;
  final meta = golden['meta'] as Map<String, dynamic>;
  final suites = golden['suites'] as Map<String, dynamic>;
  final seedCategories = (meta['seed_categories'] as List<dynamic>)
      .map((e) => Map<String, dynamic>.from(e as Map<dynamic, dynamic>))
      .toList();
  final seedTags = (meta['seed_project_tags'] as List<dynamic>)
      .map((e) => Map<String, dynamic>.from(e as Map<dynamic, dynamic>))
      .toList();
  final seedPools = (meta['seed_budget_pools'] as List<dynamic>)
      .map((e) => Map<String, dynamic>.from(e as Map<dynamic, dynamic>))
      .toList();

  final bridge = RustCoreBridge.instance();

  // Suite 1: money_rounding_and_helpers
  for (final rawCase in suites['money_rounding_and_helpers'] as List<dynamic>) {
    final c = rawCase as Map<String, dynamic>;
    final id = c['id'] as String;
    final fnName = c['fn'] as String;
    final input = c['input'];
    final expected = c['expected'];
    switch (fnName) {
      case 'roundCny':
        checkEq(bridge.formatCny(input as Object), expected, 'money:$id');
        break;
      case 'roundRate':
        final rawStr = input as String;
        final val = rawStr.contains('/')
            ? _divDecimalString28(
                rawStr.split('/')[0].trim(),
                rawStr.split('/')[1].trim(),
              )
            : rawStr;
        checkEq(bridge.formatRate(val), expected, 'money:$id');
        break;
      case 'sumCny':
        final list = (input as List<dynamic>).cast<Object>();
        checkEq(bridge.sumCny(list), expected, 'money:$id');
        break;
      case 'equalsCny':
        final pair = input as List<dynamic>;
        checkEq(
          bridge.equalsCny(pair[0] as Object, pair[1] as Object),
          expected,
          'money:$id',
        );
        break;
      case 'generateVoucherTitle':
        final m = input as Map<String, dynamic>;
        checkEq(
          bridge.generateVoucherTitle(
            voucherType: m['voucherType'] as String,
            faceValue: m['faceValue'] as Object,
            minSpend: (m['minSpend'] as Object?) ?? '0.00',
          ),
          expected,
          'money:$id',
        );
        break;
      default:
        check(false, 'Unknown money helper fn: $fnName');
    }
  }

  // Suite 2: math_formula_eval
  for (final rawCase in suites['math_formula_eval'] as List<dynamic>) {
    final c = rawCase as Map<String, dynamic>;
    final id = c['id'] as String;
    final expr = (c['input'] as Map<String, dynamic>)['expr'] as String;
    final exp = c['expected'] as Map<String, dynamic>;
    final got = bridge.evaluateMathFormula(expr);
    checkEq(got['gross'], exp['gross'], 'math:$id.gross');
    checkEq(got['discount'], exp['discount'], 'math:$id.discount');
    checkEq(got['net'], exp['net'], 'math:$id.net');
  }

  // Suite 3: dsl_parser
  for (final rawCase in suites['dsl_parser'] as List<dynamic>) {
    final c = rawCase as Map<String, dynamic>;
    final id = c['id'] as String;
    final input = c['input'] as Map<String, dynamic>;
    final fxCfg = input['fxConfig'] != null
        ? Map<String, dynamic>.from(input['fxConfig'] as Map<dynamic, dynamic>)
        : null;
    final got = bridge.parseQuickInputDsl(
      input['rawText'] as String,
      categories: seedCategories,
      projectTags: seedTags,
      budgetPools: seedPools,
      fxConfig: fxCfg,
    );
    final exp = c['expected'] as Map<String, dynamic>;
    for (final entry in exp.entries) {
      if (entry.key == 'items') {
        final gotItems = (got['items'] as List<dynamic>).cast<Map<String, dynamic>>();
        final expItems = (entry.value as List<dynamic>).cast<Map<String, dynamic>>();
        checkEq(gotItems.length, expItems.length, 'dsl:$id.items.len');
        for (var i = 0; i < expItems.length; i++) {
          for (final kv in expItems[i].entries) {
            checkEq(gotItems[i][kv.key], kv.value, 'dsl:$id.items[$i].${kv.key}');
          }
        }
      } else {
        checkEq(got[entry.key], entry.value, 'dsl:$id.${entry.key}');
      }
    }
  }

  // Suite 4: split_discount_allocation
  for (final rawCase in suites['split_discount_allocation'] as List<dynamic>) {
    final c = rawCase as Map<String, dynamic>;
    final id = c['id'] as String;
    final input = c['input'] as Map<String, dynamic>;
    final items = (input['items'] as List<dynamic>)
        .map((e) => Map<String, dynamic>.from(e as Map<dynamic, dynamic>))
        .toList();
    final manual = input['manualNets'] != null
        ? (input['manualNets'] as List<dynamic>).cast<Object>()
        : null;
    final got = bridge.allocateSplitDiscounts(
      items: items,
      totalNetPaid: input['totalNetPaid'] as Object,
      mode: (input['mode'] as String?) ?? 'PROPORTIONAL',
      manualNets: manual,
    );
    final exp = (c['expected'] as List<dynamic>).cast<Map<String, dynamic>>();
    checkEq(got.length, exp.length, 'split:$id.len');
    for (var i = 0; i < exp.length; i++) {
      for (final kv in exp[i].entries) {
        checkEq(got[i][kv.key], kv.value, 'split:$id[$i].${kv.key}');
      }
    }
  }

  // Suite 5: voucher_cost_carryover
  for (final rawCase in suites['voucher_cost_carryover'] as List<dynamic>) {
    final c = rawCase as Map<String, dynamic>;
    final id = c['id'] as String;
    final fnName = c['fn'] as String;
    final input = c['input'] as Map<String, dynamic>;
    final exp = c['expected'] as Map<String, dynamic>;
    if (fnName == 'applyVoucherToOrder') {
      final got = bridge.applyVoucherToOrder(
        orderGross: input['orderGross'] as Object,
        cashActuallyPaidAfterVoucher:
            input['cashActuallyPaidAfterVoucher'] as Object,
        voucher: Map<String, dynamic>.from(
          input['voucher'] as Map<dynamic, dynamic>,
        ),
      );
      for (final kv in exp.entries) {
        checkEq(got[kv.key], kv.value, 'voucher:$id.${kv.key}');
      }
    } else {
      final got = bridge.computeOrderAllocation(
        items: (input['items'] as List<dynamic>)
            .map((e) => Map<String, dynamic>.from(e as Map<dynamic, dynamic>))
            .toList(),
        cashActuallyPaid: input['cashActuallyPaid'] as Object,
        mode: (input['mode'] as String?) ?? 'PROPORTIONAL',
        voucher: input['voucher'] != null
            ? Map<String, dynamic>.from(
                input['voucher'] as Map<dynamic, dynamic>,
              )
            : null,
      );
      for (final kv in exp.entries) {
        if (kv.key == 'items') {
          final gotItems = (got['items'] as List<dynamic>).cast<Map<String, dynamic>>();
          final expItems = (kv.value as List<dynamic>).cast<Map<String, dynamic>>();
          checkEq(gotItems.length, expItems.length, 'voucher:$id.items.len');
          for (var i = 0; i < expItems.length; i++) {
            for (final ikv in expItems[i].entries) {
              checkEq(gotItems[i][ikv.key], ikv.value, 'voucher:$id.items[$i].${ikv.key}');
            }
          }
        } else {
          checkEq(got[kv.key], kv.value, 'voucher:$id.${kv.key}');
        }
      }
    }
  }

  // Suite 6: mastercard_fx_lifecycle
  for (final rawCase in suites['mastercard_fx_lifecycle'] as List<dynamic>) {
    final c = rawCase as Map<String, dynamic>;
    final id = c['id'] as String;
    final input = c['input'] as Map<String, dynamic>;
    final exp = c['expected'] as Map<String, dynamic>;
    final got = bridge.processMastercardFxLifecycle(
      foreignAmount: input['foreignAmount'] as Object,
      holdAmountCny: input['holdAmountCny'] as Object,
      settledAmountCny: input['settledAmountCny'] as Object?,
      holdRatio: input['holdRatio'] as Object?,
      cashbackRate: input['cashbackRate'] as Object?,
      monthlyRemainingCapCny: input['monthlyRemainingCapCny'] as Object?,
    );
    for (final kv in exp.entries) {
      checkEq(got[kv.key], kv.value, 'fx:$id.${kv.key}');
    }
  }

  // Suite 7: end_to_end_ledger_scenarios (Scenarios A through E)
  final scenarios =
      suites['end_to_end_ledger_scenarios'] as List<dynamic>;
  final sMap = <String, Map<String, dynamic>>{
    for (final s in scenarios) (s as Map<String, dynamic>)['id'] as String: s,
  };

  // Scenario A: Phase 1 (normal) & Phase 2 (overspend clamping)
  {
    final sa = sMap['scenario_a_routine_expense_income_and_daily_summary']!;
    final evalDate = sa['evaluation_date'] as String;
    final expP1 = sa['expected_phase_1_normal'] as Map<String, dynamic>;
    final engine1 = FlutterLedgerEngine(bridge: bridge, seedDemoData: true);
    for (final rawAct in sa['actions_phase_1_normal'] as List<dynamic>) {
      final act = rawAct as Map<String, dynamic>;
      if (act['type'] == 'recordFromDsl') {
        engine1.recordFromDsl(
          act['rawText'] as String,
          txDate: act['txDate'] as String?,
        );
      } else {
        final p = act['params'] as Map<String, dynamic>;
        engine1.recordManualTransaction(
          txType: p['tx_type'] as String,
          txDate: p['tx_date'] as String?,
          amount: p['amount'] as String,
          merchantOrNote: p['merchant_or_note'] as String,
        );
      }
    }
    assertBudgetDashboardMatches(
      engine1.getMonthlyBudgetDashboard('2026-11', evalDate),
      expP1['monthly_budget_status'] as Map<String, dynamic>,
      'scenario_a.phase1.dashboard',
    );
    checkEq(
      engine1.getDailyBudgetSummary('2026-11', evalDate),
      expP1['client_daily_budget_summary'],
      'scenario_a.phase1.daily_summary',
    );

    final expP2 = sa['expected_phase_2_with_overspend'] as Map<String, dynamic>;
    final engine2 = FlutterLedgerEngine(bridge: bridge, seedDemoData: true);
    final txIds2 = <Map<String, dynamic>>[];
    for (final rawAct in sa['actions_phase_2_with_overspend'] as List<dynamic>) {
      final act = rawAct as Map<String, dynamic>;
      if (act['type'] == 'recordFromDsl') {
        txIds2.add(
          engine2.recordFromDsl(
            act['rawText'] as String,
            txDate: act['txDate'] as String?,
          ),
        );
      } else {
        final p = act['params'] as Map<String, dynamic>;
        txIds2.add(
          engine2.recordManualTransaction(
            txType: p['tx_type'] as String,
            txDate: p['tx_date'] as String?,
            amount: p['amount'] as String,
            discount: (p['discount'] as String?) ?? '0.00',
            categoryId: p['category_id'] as String?,
            budgetPoolId: p['budget_pool_id'] as String?,
            merchantOrNote: p['merchant_or_note'] as String,
          ),
        );
      }
    }
    final expTxs2 = expP2['transactions'] as List<dynamic>;
    final refs2 = <String, String>{
      'TX_1': (txIds2[0]['header'] as Map<String, dynamic>)['id'] as String,
      'TX_2': (txIds2[1]['header'] as Map<String, dynamic>)['id'] as String,
      'TX_3': (txIds2[2]['header'] as Map<String, dynamic>)['id'] as String,
    };
    for (var i = 0; i < expTxs2.length; i++) {
      assertTxMatches(
        txIds2[i],
        expTxs2[i] as Map<String, dynamic>,
        refs2,
        'scenario_a.phase2.tx[$i]',
      );
    }
    assertBudgetDashboardMatches(
      engine2.getMonthlyBudgetDashboard('2026-11', evalDate),
      expP2['monthly_budget_status'] as Map<String, dynamic>,
      'scenario_a.phase2.dashboard',
    );
    checkEq(
      engine2.getDailyBudgetSummary('2026-11', evalDate),
      expP2['client_daily_budget_summary'],
      'scenario_a.phase2.daily_summary',
    );
  }

  // Scenario B: cross-pool split + tail diff + item edit rescale
  {
    final sb = sMap['scenario_b_cross_pool_split_tail_diff_and_item_edit']!;
    final actions = sb['actions'] as List<dynamic>;
    final exp = sb['expected'] as Map<String, dynamic>;
    final engine = FlutterLedgerEngine(bridge: bridge, seedDemoData: true);

    final a1 = actions[0] as Map<String, dynamic>;
    final tx1 = engine.recordFromDsl(
      a1['rawText'] as String,
      txDate: a1['txDate'] as String?,
    );
    final refs = <String, String>{
      'TX_1': (tx1['header'] as Map<String, dynamic>)['id'] as String,
    };
    assertTxMatches(tx1, exp['after_step_1_tx'] as Map<String, dynamic>, refs, 'scenario_b.step1.tx');
    assertBudgetDashboardMatches(
      engine.getMonthlyBudgetDashboard('2026-11', '2026-11-15'),
      exp['after_step_1_budget_status'] as Map<String, dynamic>,
      'scenario_b.step1.dashboard',
    );

    final a2 = actions[1] as Map<String, dynamic>;
    final tx1Updated = engine.updateTransaction(
      refs[a2['target_tx_ref'] as String]!,
      Map<String, dynamic>.from(a2['patch'] as Map<dynamic, dynamic>),
    );
    assertTxMatches(
      tx1Updated,
      exp['after_step_2_tx'] as Map<String, dynamic>,
      refs,
      'scenario_b.step2.tx',
    );
    assertBudgetDashboardMatches(
      engine.getMonthlyBudgetDashboard('2026-11', '2026-11-15'),
      exp['after_step_2_budget_status'] as Map<String, dynamic>,
      'scenario_b.step2.dashboard',
    );
  }

  // Scenario C: voucher buy -> redeem -> delete rollback
  {
    final sc = sMap['scenario_c_voucher_buy_redeem_and_delete_rollback']!;
    final actions = sc['actions'] as List<dynamic>;
    final exp = sc['expected'] as Map<String, dynamic>;
    final engine = FlutterLedgerEngine(bridge: bridge, seedDemoData: true);
    final refs = <String, String>{};

    // Step 1: buyVoucher
    final s1p = (actions[0] as Map<String, dynamic>)['params'] as Map<String, dynamic>;
    final buyRes = engine.buyVoucher(
      voucherType: s1p['voucherType'] as String,
      faceValue: s1p['faceValue'] as String,
      acquireCost: s1p['acquireCost'] as String,
      minSpend: s1p['minSpend'] as String,
      txDate: s1p['txDate'] as String?,
    );
    final buyTx = buyRes['transaction'] as Map<String, dynamic>;
    final createdVoucher = buyRes['voucher'] as Map<String, dynamic>;
    refs['TX_1'] = (buyTx['header'] as Map<String, dynamic>)['id'] as String;
    assertTxMatches(buyTx, exp['step_1_buy_tx'] as Map<String, dynamic>, refs, 'scenario_c.step1.tx');
    final expV = exp['step_1_created_voucher'] as Map<String, dynamic>;
    checkEq(createdVoucher['id'], expV['id'], 'scenario_c.step1.voucher.id');
    checkEq(createdVoucher['title'], expV['title'], 'scenario_c.step1.voucher.title');
    checkEq(createdVoucher['status'], expV['status'], 'scenario_c.step1.voucher.status');
    checkEq(createdVoucher['purchase_tx_id'], refs['TX_1'], 'scenario_c.step1.voucher.purchase_tx_id');
    assertBudgetDashboardMatches(
      engine.getMonthlyBudgetDashboard('2026-11', '2026-11-15'),
      exp['step_1_budget_status'] as Map<String, dynamic>,
      'scenario_c.step1.dashboard',
    );

    // Step 2: redeem single tx with voucher 1
    final s2 = actions[1] as Map<String, dynamic>;
    final tx2 = engine.recordFromDsl(
      s2['rawText'] as String,
      txDate: s2['txDate'] as String?,
      appliedVoucherId: s2['appliedVoucherId'] as int?,
    );
    refs['TX_2'] = (tx2['header'] as Map<String, dynamic>)['id'] as String;
    assertTxMatches(tx2, exp['step_2_redeem_single_tx'] as Map<String, dynamic>, refs, 'scenario_c.step2.tx');
    final v1 = engine.vouchers.firstWhere((v) => v['id'] == 1);
    checkEq(v1['status'], exp['step_2_voucher_1_status'], 'scenario_c.step2.v1_status');
    assertBudgetDashboardMatches(
      engine.getMonthlyBudgetDashboard('2026-11', '2026-11-15'),
      exp['step_2_budget_status'] as Map<String, dynamic>,
      'scenario_c.step2.dashboard',
    );

    // Step 3: redeem split tx with voucher 3
    final s3 = actions[2] as Map<String, dynamic>;
    final tx3 = engine.recordFromDsl(
      s3['rawText'] as String,
      txDate: s3['txDate'] as String?,
      appliedVoucherId: s3['appliedVoucherId'] as int?,
    );
    refs['TX_3'] = (tx3['header'] as Map<String, dynamic>)['id'] as String;
    assertTxMatches(tx3, exp['step_3_redeem_split_tx'] as Map<String, dynamic>, refs, 'scenario_c.step3.tx');
    assertBudgetDashboardMatches(
      engine.getMonthlyBudgetDashboard('2026-11', '2026-11-15'),
      exp['step_3_budget_status'] as Map<String, dynamic>,
      'scenario_c.step3.dashboard',
    );

    // Step 4: delete TX_3 -> rollback voucher 3 & budget
    final s4 = actions[3] as Map<String, dynamic>;
    final delTx3 = engine.deleteTransaction(refs[s4['target_tx_ref'] as String]!);
    checkEq(
      (delTx3['header'] as Map<String, dynamic>)['is_deleted'],
      exp['step_4_deleted_tx_is_deleted'],
      'scenario_c.step4.is_deleted',
    );
    final v3 = engine.vouchers.firstWhere((v) => v['id'] == 3);
    final expV3 = exp['step_4_voucher_3_restored'] as Map<String, dynamic>;
    checkEq(v3['status'], expV3['status'], 'scenario_c.step4.v3.status');
    checkEq(v3['used_tx_id'], expV3['used_tx_id'], 'scenario_c.step4.v3.used_tx_id');
    assertBudgetDashboardMatches(
      engine.getMonthlyBudgetDashboard('2026-11', '2026-11-15'),
      exp['step_4_budget_status'] as Map<String, dynamic>,
      'scenario_c.step4.dashboard',
    );
  }

  // Scenario D: Mastercard FX pre-auth hold & settlement (1% vs 0% cashback)
  {
    final sd = sMap['scenario_d_mastercard_fx_hold_and_settlement']!;
    final actions = sd['actions'] as List<dynamic>;
    final exp = sd['expected'] as Map<String, dynamic>;
    final engine = FlutterLedgerEngine(bridge: bridge, seedDemoData: true);
    final refs = <String, String>{};

    final a1 = actions[0] as Map<String, dynamic>;
    final tx1 = engine.recordFromDsl(
      a1['rawText'] as String,
      txDate: a1['txDate'] as String?,
    );
    refs['TX_1'] = (tx1['header'] as Map<String, dynamic>)['id'] as String;
    assertTxMatches(tx1, exp['step_1_hold_tx'] as Map<String, dynamic>, refs, 'scenario_d.step1.tx');

    final a2p = (actions[1] as Map<String, dynamic>)['params'] as Map<String, dynamic>;
    final tx2 = engine.recordManualTransaction(
      txType: a2p['tx_type'] as String,
      txDate: a2p['tx_date'] as String?,
      amount: a2p['amount'] as String,
      currency: a2p['currency'] as String,
      holdAmountCny: a2p['hold_amount_cny'] as String?,
      fxHoldRatio: a2p['fx_hold_ratio'] as String?,
      fxCashbackRate: a2p['fx_cashback_rate'] as String?,
      categoryId: a2p['category_id'] as String?,
      budgetPoolId: a2p['budget_pool_id'] as String?,
      merchantOrNote: a2p['merchant_or_note'] as String,
    );
    refs['TX_2'] = (tx2['header'] as Map<String, dynamic>)['id'] as String;
    assertTxMatches(tx2, exp['step_2_hold_tx_zero_cb'] as Map<String, dynamic>, refs, 'scenario_d.step2.tx');
    assertBudgetDashboardMatches(
      engine.getMonthlyBudgetDashboard('2026-11', '2026-11-15'),
      exp['after_hold_budget_status'] as Map<String, dynamic>,
      'scenario_d.after_hold.dashboard',
    );

    final a3 = actions[2] as Map<String, dynamic>;
    final tx1Settled = engine.settleMastercardTransaction(
      refs[a3['target_tx_ref'] as String]!,
      a3['settledAmountCny'] as String,
    );
    assertTxMatches(
      tx1Settled,
      exp['step_3_settled_tx_1pct'] as Map<String, dynamic>,
      refs,
      'scenario_d.step3.settled1',
    );

    final a4 = actions[3] as Map<String, dynamic>;
    final tx2Settled = engine.settleMastercardTransaction(
      refs[a4['target_tx_ref'] as String]!,
      a4['settledAmountCny'] as String,
    );
    assertTxMatches(
      tx2Settled,
      exp['step_4_settled_tx_0pct'] as Map<String, dynamic>,
      refs,
      'scenario_d.step4.settled2',
    );
    assertBudgetDashboardMatches(
      engine.getMonthlyBudgetDashboard('2026-11', '2026-11-15'),
      exp['after_settle_budget_status'] as Map<String, dynamic>,
      'scenario_d.after_settle.dashboard',
    );
  }

  // Scenario E: Project tag exemption & month rollover (ACCUMULATE + RESET)
  {
    final se = sMap['scenario_e_project_exemption_and_month_rollover']!;
    final actions = se['actions'] as List<dynamic>;
    final exp = se['expected'] as Map<String, dynamic>;
    final engine = FlutterLedgerEngine(bridge: bridge, seedDemoData: true);

    for (var i = 0; i < 4; i++) {
      final act = actions[i] as Map<String, dynamic>;
      engine.recordFromDsl(
        act['rawText'] as String,
        txDate: act['txDate'] as String?,
      );
    }
    assertBudgetDashboardMatches(
      engine.getMonthlyBudgetDashboard('2026-11', '2026-11-15'),
      exp['nov_2026_budget_status'] as Map<String, dynamic>,
      'scenario_e.nov_2026',
    );

    final r1 = actions[4] as Map<String, dynamic>;
    final decRows = engine.executeMonthRollover(
      r1['fromYearMonth'] as String,
      r1['toYearMonth'] as String,
    );
    assertPoolsMatch(
      decRows,
      exp['dec_2026_after_all_accumulate_rollover'] as List<dynamic>,
      'scenario_e.dec_after_rollover',
    );

    final a6 = actions[5] as Map<String, dynamic>;
    engine.recordFromDsl(
      a6['rawText'] as String,
      txDate: a6['txDate'] as String?,
    );
    assertBudgetDashboardMatches(
      engine.getMonthlyBudgetDashboard('2026-12', '2026-12-15'),
      exp['dec_2026_before_jan_rollover'] as Map<String, dynamic>,
      'scenario_e.dec_before_jan_rollover',
    );

    final a7 = actions[6] as Map<String, dynamic>;
    engine.upsertBudgetPool(
      id: a7['id'] as String,
      rolloverStrategy: a7['rollover_strategy'] as String,
    );
    final a8 = actions[7] as Map<String, dynamic>;
    final janRows = engine.executeMonthRollover(
      a8['fromYearMonth'] as String,
      a8['toYearMonth'] as String,
    );
    assertPoolsMatch(
      janRows,
      exp['jan_2027_after_mixed_reset_accumulate_rollover'] as List<dynamic>,
      'scenario_e.jan_2027',
    );
  }

  // Extra check: HLC monotonicity & LWW sync merge across two Dart engines
  {
    final eA = FlutterLedgerEngine(
      bridge: bridge,
      nodeId: 'phone-a',
      seedDemoData: true,
    );
    final eB = FlutterLedgerEngine(
      bridge: bridge,
      nodeId: 'web-b',
      seedDemoData: true,
    );
    final txA = eA.recordFromDsl('咖啡 18 #饮食', txDate: '2026-11-15');
    final syncRes = eB.processSync(eA.syncOplog);
    check(syncRes['acceptedCount'] == 1, 'hlc_sync.acceptedCount');
    checkEq(eB.getRecentTransactions(10).length, 1, 'hlc_sync.replicated_tx_count');
    final txB = eB.getRecentTransactions(10).first;
    checkEq(
      (txB['header'] as Map<String, dynamic>)['id'],
      (txA['header'] as Map<String, dynamic>)['id'],
      'hlc_sync.replicated_tx_id',
    );
  }

  stdout.writeln(
    'Dart Rust-FFI Golden Verification: $_passed assertions passed, $_failed failed.',
  );
  if (_failed > 0) {
    exitCode = 1;
  }
}
