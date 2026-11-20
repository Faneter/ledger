import 'dart:convert';
import 'dart:io';

import 'package:material_ui/material_ui.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:geek_ledger_mobile/main.dart';
import 'package:geek_ledger_mobile/src/ledger_engine.dart';
import 'package:geek_ledger_mobile/src/overview/pool_water_card.dart';
import 'package:geek_ledger_mobile/src/platform_backup.dart';

Future<void> _setPhoneViewport(WidgetTester tester) async {
  tester.view.physicalSize = const Size(360, 780);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(() {
    tester.view.resetPhysicalSize();
    tester.view.resetDevicePixelRatio();
  });
}

void main() {
  testWidgets(
      'App launches cleanly with zero default seed data, no AppBar app name, and no inline quick-record card on OverviewTab',
      (WidgetTester tester) async {
    await _setPhoneViewport(tester);
    final engine = FlutterLedgerEngine();
    final currentYm = getLocalTodayDateStr().substring(0, 7);

    await tester.pumpWidget(GeekLedgerApp(engine: engine));
    await tester.pumpAndSettle();

    // Zero initial default data
    expect(engine.budgetPools, isEmpty);
    expect(engine.monthlyBudgets, isEmpty);
    expect(engine.categories, isEmpty);
    expect(engine.projectTags, isEmpty);
    expect(engine.vouchers, isEmpty);
    expect(engine.recurringRules, isEmpty);
    expect(engine.transactions, isEmpty);

    // Top bar omits app name & seed reset button, keeping month pill + sync pill
    expect(find.text('Geek Ledger'), findsNothing);
    expect(find.text(currentYm), findsOneWidget);
    expect(find.text('未同步'), findsOneWidget);

    // OverviewTab omits inline quick-record card (FAB is sufficient) & shows empty budget state
    expect(find.textContaining('极速记账 DSL'), findsNothing);
    expect(find.text('拆单/键盘'), findsNothing);
    expect(find.text('日均预算概览'), findsOneWidget);
    expect(find.text('暂无月度预算池'), findsOneWidget);
    expect(find.text('月度预算池水位 (0)'), findsOneWidget);

    // 3-Tab NavigationBar + FAB (no '引擎' wording in 3rd tab)
    expect(find.text('今日看板'), findsOneWidget);
    expect(find.text('流水与专项'), findsOneWidget);
    expect(find.text('卡包与周期'), findsOneWidget);
    expect(find.text('卡包与引擎'), findsNothing);
    expect(find.byTooltip('设置'), findsOneWidget);
    expect(find.text('记一笔'), findsOneWidget);

    // Quick record works even when budgetPools is completely empty
    await tester.tap(find.text('记一笔'));
    await tester.pumpAndSettle();

    final sheetField = find
        .descendant(
          of: find.byType(BottomSheet),
          matching: find.byType(TextField),
        )
        .first;
    await tester.enterText(sheetField, '晚餐牛肉面 22');
    await tester.pumpAndSettle();
    final confirmBtn = find.text('确认入账 · ¥22.00');
    await tester.ensureVisible(confirmBtn);
    await tester.tap(confirmBtn);
    await tester.pumpAndSettle();

    expect(engine.transactions.length, 1);
    final items = engine.transactions.first['items'] as List<dynamic>;
    expect((items.first as Map<String, dynamic>)['budget_pool_id'], isNull);
  });

  testWidgets(
      'Half-screen Geek Formula BottomSheet supports live split preview, primary item toggle and voucher mounting',
      (WidgetTester tester) async {
    await _setPhoneViewport(tester);
    final engine = FlutterLedgerEngine(seedDemoData: true);
    await tester.pumpWidget(GeekLedgerApp(engine: engine));
    await tester.pumpAndSettle();

    await tester.tap(find.text('记一笔'));
    await tester.pumpAndSettle();

    expect(find.text('极速算式'), findsOneWidget);
    expect(find.text('可视化表单'), findsOneWidget);

    final sheetField = find
        .descendant(
          of: find.byType(BottomSheet),
          matching: find.byType(TextField),
        )
        .first;
    await tester.enterText(sheetField, '牛奶 28 + 晾衣架 12 + 排针 15');
    await tester.pumpAndSettle();

    expect(find.text('实时拆单沙盒'), findsOneWidget);
    final voucherChip = find.text('🎟️ 可用：微信支付10元立减金 (净省 ¥4.01)');
    expect(voucherChip, findsOneWidget);

    await tester.ensureVisible(voucherChip);
    await tester.tap(voucherChip);
    await tester.pumpAndSettle();

    final pinTarget = find.descendant(
      of: find.byType(BottomSheet),
      matching: find.text('排针'),
    );
    await tester.ensureVisible(pinTarget);
    await tester.tap(pinTarget);
    await tester.pumpAndSettle();
    expect(find.text('★ 主商品'), findsOneWidget);

    final confirmBtn = find.text('确认入账 · ¥50.99');
    await tester.ensureVisible(confirmBtn);
    await tester.tap(confirmBtn);
    await tester.pumpAndSettle();

    expect(engine.transactions.length, 1);
    final h = engine.transactions.first['header'] as Map<String, dynamic>;
    expect(h['total_gross'], '55.00');
    expect(h['total_net'], '50.99');
    expect(h['applied_voucher_id'], 1);
    expect(find.textContaining('本月薅羊毛已省 ¥4.01'), findsOneWidget);
  });

  testWidgets(
      'Mastercard FX pre-auth hold shows pending banner and settles via SettleFxDialog on clean engine',
      (WidgetTester tester) async {
    await _setPhoneViewport(tester);
    final engine = FlutterLedgerEngine();
    await tester.pumpWidget(GeekLedgerApp(engine: engine));
    await tester.pumpAndSettle();

    await tester.tap(find.text('记一笔'));
    await tester.pumpAndSettle();

    final sheetField = find
        .descendant(
          of: find.byType(BottomSheet),
          matching: find.byType(TextField),
        )
        .first;
    await tester.enterText(sheetField, '4.32 USD GooglePlay 冻结');
    await tester.pumpAndSettle();

    expect(find.textContaining('已识别外币消费 (USD 4.32)'), findsOneWidget);
    final confirmBtn = find.textContaining('确认入账 · ¥');
    await tester.ensureVisible(confirmBtn);
    await tester.tap(confirmBtn);
    await tester.pumpAndSettle();

    expect(
      find.text('有 1 笔外币待清算（点击快速输入银行实付解冻）'),
      findsOneWidget,
    );

    await tester.tap(find.text('清算'));
    await tester.pumpAndSettle();

    expect(find.text('万事达外币预授权清算'), findsOneWidget);
    final dialogField = find
        .descendant(
          of: find.byType(AlertDialog),
          matching: find.byType(TextField),
        )
        .first;
    await tester.enterText(dialogField, '31.25');
    await tester.tap(find.text('确认入账'));
    await tester.pumpAndSettle();

    expect(
      find.text('有 1 笔外币待清算（点击快速输入银行实付解冻）'),
      findsNothing,
    );
    expect(engine.getPendingFxTransactions(), isEmpty);
  });

  testWidgets(
      'Switching month via visual calendar month-picker widget (no TextField), creating monthly pool, and creating detached project budget work cleanly',
      (WidgetTester tester) async {
    await _setPhoneViewport(tester);
    final engine = FlutterLedgerEngine();
    final today = getLocalTodayDateStr();
    final todayYear = int.parse(today.substring(0, 4));
    final currentYm = today.substring(0, 7);

    await tester.pumpWidget(GeekLedgerApp(engine: engine));
    await tester.pumpAndSettle();

    // 1. Switch billing month via visual year/month calendar picker (zero TextFields)
    await tester.tap(find.text(currentYm));
    await tester.pumpAndSettle();
    expect(find.text('选择账单月份'), findsOneWidget);
    expect(
      find.descendant(
        of: find.byType(AlertDialog),
        matching: find.byType(TextField),
      ),
      findsNothing,
    );

    // Step to next year and select 12月
    await tester.tap(find.byTooltip('下一年'));
    await tester.pumpAndSettle();
    expect(find.text('${todayYear + 1} 年'), findsOneWidget);

    await tester.tap(find.text('12月'));
    await tester.pumpAndSettle(const Duration(milliseconds: 300));
    expect(find.text('${todayYear + 1}-12'), findsOneWidget);

    // 2. Create a new Monthly Budget Pool via Overview dialog
    await tester.tap(find.text('新增/调配'));
    await tester.pumpAndSettle();
    expect(find.text('新增月度预算池'), findsOneWidget);

    final poolFields = find.descendant(
      of: find.byType(AlertDialog),
      matching: find.byType(TextField),
    );
    await tester.enterText(poolFields.at(0), '夜宵专项补贴');
    await tester.enterText(poolFields.at(1), '180.00');
    await tester.tap(find.text('保存'));
    await tester.pumpAndSettle(const Duration(milliseconds: 400));

    expect(find.text('夜宵专项补贴'), findsOneWidget);
    expect(
      engine.budgetPools.any((p) => p['name'] == '夜宵专项补贴'),
      isTrue,
    );

    // 3. Switch to 流水与专项 -> 专项立项 and create a detached Project Budget
    await tester.tap(find.text('流水与专项'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('专项立项'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('新增专项'));
    await tester.pumpAndSettle();
    expect(find.text('新增跨期独立专项预算'), findsOneWidget);
    expect(find.text('关联预算池'), findsNothing);

    final projFields = find.descendant(
      of: find.byType(AlertDialog),
      matching: find.byType(TextField),
    );
    await tester.enterText(projFields.at(0), '毕业旅行基金');
    await tester.enterText(projFields.at(1), '2400.00');
    await tester.tap(find.text('保存'));
    await tester.pumpAndSettle(const Duration(milliseconds: 400));

    expect(find.text('#毕业旅行基金'), findsOneWidget);
    final created = engine.projectTags.firstWhere(
      (t) => t['name'] == '毕业旅行基金',
    );
    expect(created.containsKey('linked_pool_id'), isFalse);
    expect(created['target_budget'], '2400.00');
  });

  testWidgets(
      'Timeline split item expansion, pool rebind, swipe-delete undo and Projects view work end-to-end',
      (WidgetTester tester) async {
    await _setPhoneViewport(tester);
    final engine = FlutterLedgerEngine(seedDemoData: true);
    engine.recordFromDsl('N2报名费 550 #JLPT_N2考试专项', txDate: '2026-11-15');
    engine.recordFromDsl('牛奶 28 + 排针 15 = 35', txDate: '2026-11-16');

    await tester.pumpWidget(GeekLedgerApp(engine: engine));
    await tester.pumpAndSettle();

    await tester.tap(find.text('流水与专项'));
    await tester.pumpAndSettle();

    await tester.tap(find.textContaining('原价 ¥43.00'));
    await tester.pumpAndSettle();

    expect(find.text('编辑主账单'), findsOneWidget);

    final pillFinder = find.textContaining('▾').first;
    await tester.ensureVisible(pillFinder);
    await tester.tap(pillFinder);
    await tester.pumpAndSettle();

    expect(find.textContaining('改绑「'), findsOneWidget);
    await tester.tap(find.text('医疗与突发应急池').last);
    await tester.pumpAndSettle();

    final splitTx = engine.transactions.firstWhere(
      (t) =>
          (t['header'] as Map<String, dynamic>)['total_gross'] == '43.00',
    );
    final splitItems =
        (splitTx['items'] as List<dynamic>).cast<Map<String, dynamic>>();
    expect(splitItems.first['budget_pool_id'], 'POOL_EMERGENCY');

    await tester.drag(
      find.byType(Dismissible).first,
      const Offset(-500, 0),
    );
    await tester.pumpAndSettle();

    expect(engine.getRecentTransactions().length, 1);
    expect(find.text('撤销'), findsOneWidget);

    await tester.tap(find.text('撤销'));
    await tester.pumpAndSettle();
    expect(engine.getRecentTransactions().length, 2);

    await tester.tap(find.text('专项立项'));
    await tester.pumpAndSettle();

    expect(find.textContaining('专项预算总览'), findsOneWidget);
    expect(find.text('#JLPT_N2考试专项'), findsOneWidget);
  });

  testWidgets(
      'Wallet & Engine tab handles empty state, adding recurring rule without pools, and honest unreachable HTTP sync error',
      (WidgetTester tester) async {
    await _setPhoneViewport(tester);

    final offlineEngine = FlutterLedgerEngine(
      httpPost: (_, __) async =>
          throw const SocketException('Connection refused'),
    );
    await tester.pumpWidget(GeekLedgerApp(engine: offlineEngine));
    await tester.pumpAndSettle();

    await tester.tap(find.text('卡包与周期'));
    await tester.pumpAndSettle();

    // Empty state cards render cleanly & Fixed Assets / FX / Manual Rollover / Engine status are all gone
    expect(find.textContaining('暂无符合条件的卡券'), findsOneWidget);
    expect(find.textContaining('暂无周期性扣款规则'), findsOneWidget);
    expect(find.textContaining('固定资产'), findsNothing);
    expect(find.text('添置资产'), findsNothing);
    expect(find.textContaining('外币参数'), findsNothing);
    expect(find.text('一键滚存'), findsNothing);
    expect(find.textContaining('Rust FFI Core Engine'), findsNothing);

    // Add a recurring rule even when budgetPools is empty (no DropdownButton crash)
    await tester.tap(find.text('新增规则'));
    await tester.pumpAndSettle();
    expect(find.text('新增周期性扣款规则'), findsOneWidget);

    final ruleFields = find.descendant(
      of: find.byType(AlertDialog),
      matching: find.byType(TextField),
    );
    await tester.enterText(ruleFields.at(0), '校园网月租');
    await tester.enterText(ruleFields.at(1), '30.00');
    await tester.tap(find.text('保存规则'));
    await tester.pumpAndSettle(const Duration(milliseconds: 300));

    expect(find.text('校园网月租'), findsOneWidget);
    expect(offlineEngine.recurringRules.length, 1);
    expect(offlineEngine.pendingSyncCount, greaterThan(0));

    // Execute recurring rule -> pending sync increments
    final walletScroll = find.byType(Scrollable).first;
    await tester.drag(walletScroll, const Offset(0, -140));
    await tester.pumpAndSettle();

    await tester.tap(find.text('立即入账').first);
    await tester.pumpAndSettle();
    expect(offlineEngine.transactions.length, 1);

    // Tap SyncStatusPill -> opens SettingsPage scrolled to Cloud Sync section (NO dialog popup)
    await tester.tap(find.textContaining('待传'));
    await tester.pumpAndSettle();
    expect(find.byType(AlertDialog), findsNothing);
    expect(find.text('云同步与服务器'), findsOneWidget);
    expect(find.text('模拟冲突演示'), findsNothing);

    final syncNowBtn = find.text('立即与服务端同步');
    await tester.ensureVisible(syncNowBtn);
    await tester.tap(syncNowBtn);
    await tester.pumpAndSettle();
    expect(offlineEngine.pendingSyncCount, greaterThan(0));
    expect(offlineEngine.lastSyncAt, isNull);
    expect(find.textContaining('连接服务端失败:'), findsOneWidget);

    await tester.pageBack();
    await tester.pumpAndSettle();
    expect(find.text('未连云端'), findsOneWidget);
  });

  test(
      'FlutterLedgerEngine exchanges ops, detects server reset, and resolves conflicts via HTTP transport',
      () async {
    var epoch = 'epoch_srv_1';
    var resolved = false;
    final recordedPaths = <String>[];

    final engine = FlutterLedgerEngine(
      serverUrl: 'http://127.0.0.1:3001',
      httpPost: (Uri uri, Map<String, dynamic> body) async {
        recordedPaths.add(uri.path);
        if (uri.path == '/api/sync/exchange') {
          final ops = (body['ops'] as List<dynamic>? ?? <dynamic>[]);
          return <String, dynamic>{
            'serverNodeId': 'server-test',
            'serverEpochId': epoch,
            'appliedCount': ops.length,
            'serverOps': <dynamic>[],
            'conflicts': resolved
                ? <dynamic>[]
                : <Map<String, dynamic>>[
                    <String, dynamic>{
                      'id': 'cf_1',
                      'entity_type': 'TRANSACTION',
                      'entity_id': 'tx_remote_1',
                      'status': 'PENDING',
                      'winner_summary': '桌面端修改 ¥18.00',
                      'loser_summary': '手机端修改 ¥16.50',
                    },
                  ],
            'fullBundle': <String, dynamic>{
              'transactions': <dynamic>[],
              'oplogs': ops,
            },
          };
        } else if (uri.path == '/api/conflicts/cf_1/resolve') {
          resolved = true;
          return <String, dynamic>{'conflicts': <dynamic>[]};
        } else if (uri.path == '/api/sync/reseed') {
          return <String, dynamic>{
            'restored': true,
            'oplogCount': ((body['bundle'] as Map)['oplogs'] as List).length,
          };
        }
        throw StateError('Unexpected path: ${uri.path}');
      },
    );
    engine.recordFromDsl('测试面条 18');
    expect(engine.pendingSyncCount, 1);

    final syncRes = await engine.syncWithServer();
    expect(syncRes['success'], isTrue);
    expect(engine.pendingSyncCount, 0);
    expect(engine.serverEpochId, 'epoch_srv_1');
    expect(engine.pendingConflicts.length, 1);

    await engine.resolveConflict('cf_1', 'KEEP_WINNER');
    expect(engine.pendingConflicts, isEmpty);

    // Simulate server epoch change -> serverResetDetected protection triggers
    epoch = 'epoch_srv_reset_2';
    final resetCheck = await engine.syncWithServer();
    expect(resetCheck['success'], isFalse);
    expect(resetCheck['serverResetDetected'], isTrue);
    expect(engine.serverResetDetected, isTrue);

    final pushRes = await engine.pushLocalBundleToServer();
    expect(pushRes['success'], isTrue);
    expect(engine.serverResetDetected, isFalse);
    expect(
      recordedPaths,
      <String>[
        '/api/sync/exchange',
        '/api/conflicts/cf_1/resolve',
        '/api/sync/exchange',
        '/api/sync/exchange',
        '/api/sync/reseed',
      ],
    );
  });

  test(
      'FlutterLedgerEngine persists local state to disk across restarts without overwriting IDs',
      () async {
    final tmpDir = Directory.systemTemp.createTempSync('geek_ledger_persist_');
    addTearDown(() => tmpDir.deleteSync(recursive: true));
    final statePath = '${tmpDir.path}/geek_ledger_state.json';

    // Session 1: Create budget pool, monthly allocation, project tag, voucher, rule, and tx
    final engine1 = FlutterLedgerEngine(storageFilePath: statePath);
    engine1.upsertBudgetPool(
      id: 'POOL_CUSTOM',
      name: '日常餐饮池',
      isMonthlyBudget: true,
    );
    engine1.setMonthlyBudget(
      yearMonth: '2026-11',
      poolId: 'POOL_CUSTOM',
      baseAllocation: '500.00',
    );
    engine1.upsertProjectTag(name: '秋招差旅', targetBudget: '1200.00');
    engine1.recordManualTransaction(
      amount: '24.50',
      budgetPoolId: 'POOL_CUSTOM',
      merchantOrNote: '黄焖鸡米饭',
      txDate: '2026-11-16',
    );
    engine1.serverUrl = 'http://192.168.1.50:3001';
    engine1.isOfflineMode = true;
    engine1.saveToDisk();

    expect(File(statePath).existsSync(), isTrue);

    // Session 2: Restart engine from the exact same storageFilePath
    final engine2 = FlutterLedgerEngine(storageFilePath: statePath);
    expect(engine2.budgetPools.length, 1);
    expect(engine2.budgetPools.first['name'], '日常餐饮池');
    expect(engine2.monthlyBudgets.length, 1);
    expect(engine2.projectTags.length, 1);
    expect(engine2.transactions.length, 1);
    expect(
      (engine2.transactions.first['header'] as Map<String, dynamic>)['merchant_or_note'],
      '黄焖鸡米饭',
    );
    expect(engine2.serverUrl, 'http://192.168.1.50:3001');
    expect(engine2.isOfflineMode, isTrue);

    // Adding a second tx after reload must get tx_mobile_2 (not collide with tx_mobile_1)
    final tx2 = engine2.recordManualTransaction(
      amount: '10.00',
      budgetPoolId: 'POOL_CUSTOM',
      merchantOrNote: '冰美式',
      txDate: '2026-11-16',
    );
    expect((tx2['header'] as Map<String, dynamic>)['id'], 'tx_mobile_2');

    // Wait for debounced Isolate.run persistence to complete automatically, then verify Session 3 reload
    await engine2.flushPendingSaves();
    final engine3 = FlutterLedgerEngine(storageFilePath: statePath);
    expect(engine3.transactions.length, 2);
  });

  testWidgets(
      'File-based JSON import parses Web-exported backup JSON (numeric amounts, BOM, ISO dates, legacy fixedAssets/linked_pool_id) and exports JSON file cleanly',
      (WidgetTester tester) async {
    await _setPhoneViewport(tester);
    final engine = FlutterLedgerEngine();

    // Simulate a Web / SQLite exported JSON backup containing BOM, numeric values,
    // ISO timestamp tx_date, fxConfig, and deprecated legacy fields.
    final webExportedJson = '\uFEFF${jsonEncode(<String, dynamic>{
      'nodeId': 'web-browser-1',
      'exportedAt': '2026-11-16T03:00:00.000Z',
      'fxConfig': <String, dynamic>{
        'defaultHoldRatio': '1.030',
        'defaultCashbackRate': '0.0150',
      },
      'budgetPools': <Map<String, dynamic>>[
        <String, dynamic>{
          'id': 'POOL_DAILY',
          'name': 'Web 日常餐饮',
          'pool_type': 'DAILY',
          'is_monthly_budget': 1,
          'rollover_strategy': 'ACCUMULATE',
          'sort_order': 20,
        },
        <String, dynamic>{
          'id': 'POOL_ASSET',
          'name': '旧资产池',
          'pool_type': 'CAPITAL_ASSET',
          'is_monthly_budget': 0,
        },
      ],
      'monthlyBudgets': <Map<String, dynamic>>[
        <String, dynamic>{
          'id': 1,
          'year_month': '2026-11',
          'pool_id': 'POOL_DAILY',
          'base_allocation': 650,
          'rollover_from_prev': 0,
          'reserved_fixed': 0,
          'swept_to_fund': 0,
        },
      ],
      'categories': <Map<String, dynamic>>[
        <String, dynamic>{
          'id': 'CAT_FOOD',
          'name': '餐饮',
          'default_pool_id': 'POOL_DAILY',
          'sort_order': 10,
        },
      ],
      'projectTags': <Map<String, dynamic>>[
        <String, dynamic>{
          'id': 'TAG_EXAM',
          'name': 'Web考证',
          'tag_type': 'PROJECT',
          'linked_pool_id': 'POOL_DAILY',
          'target_budget': 800,
          'is_active': 1,
        },
      ],
      'vouchers': <Map<String, dynamic>>[
        <String, dynamic>{
          'id': 1,
          'title': 'Web导出的满减券',
          'voucher_type': 'PREPAID_COUPON',
          'face_value': 10,
          'acquire_cost': 5.5,
          'min_spend': 10,
          'status': 'AVAILABLE',
        },
      ],
      'fixedAssets': <Map<String, dynamic>>[
        <String, dynamic>{'id': 1, 'asset_name': '旧固定资产'},
      ],
      'recurringRules': <dynamic>[],
      'transactions': <Map<String, dynamic>>[
        <String, dynamic>{
          'header': <String, dynamic>{
            'id': 'tx_web_99',
            'tx_date': '2026-11-16T00:00:00.000Z',
            'tx_type': 'EXPENSE',
            'total_gross': 32.5,
            'platform_discount': 0,
            'payment_discount': 2.5,
            'total_net': 30,
            'allocation_mode': 'SINGLE',
            'original_currency': 'CNY',
            'settlement_status': 'SETTLED',
            'hold_amount_cny': 0,
            'merchant_or_note': 'Web同步晚餐',
            'is_deleted': 0,
          },
          'items': <Map<String, dynamic>>[
            <String, dynamic>{
              'id': 1,
              'tx_id': 'tx_web_99',
              'item_index': 0,
              'item_name': '煲仔饭',
              'category_id': 'CAT_FOOD',
              'budget_pool_id': 'POOL_DAILY',
              'item_gross': 32.5,
              'allocated_discount': 2.5,
              'item_net': 30,
              'is_primary_item': 1,
            },
          ],
        },
      ],
      'oplogs': <Map<String, dynamic>>[
        <String, dynamic>{
          'hlc': '00000001763251200000-0001-web-browser-1',
          'node_id': 'web-browser-1',
          'entity_type': 'FIXED_ASSET',
          'entity_id': '1',
          'op_type': 'UPSERT',
          'payload_json': <String, dynamic>{'id': 1},
        },
      ],
    })}';

    String? savedFileName;
    String? savedFileContent;

    await tester.pumpWidget(
      GeekLedgerApp(
        engine: engine,
        onPickBackupFile: () async => PickedBackupFile(
          name: 'geek_ledger_backup_2026-11-16.json',
          content: webExportedJson,
        ),
        onSaveBackupFile: (name, content) async {
          savedFileName = name;
          savedFileContent = content;
          return name;
        },
      ),
    );
    await tester.pumpAndSettle();

    // Open sync dialog -> tap '选择 JSON 导入' -> verify NO TextField paste dialog appears
    await tester.tap(find.text('未同步'));
    await tester.pumpAndSettle();

    final importBtn = find.text('选择 JSON 导入');
    await tester.ensureVisible(importBtn);
    await tester.tap(importBtn);
    await tester.pumpAndSettle();

    expect(find.text('导入 JSON 备份'), findsNothing);
    expect(find.textContaining('已导入「geek_ledger_backup_2026-11-16.json」'), findsOneWidget);

    // Export JSON file works cleanly
    final exportBtn = find.text('导出 JSON 文件');
    await tester.ensureVisible(exportBtn);
    await tester.tap(exportBtn);
    await tester.pumpAndSettle();
    expect(savedFileName, startsWith('geek_ledger_backup_'));
    expect(savedFileContent, contains('Web同步晚餐'));
    expect(find.textContaining('已导出 JSON 备份文件：'), findsOneWidget);

    await tester.pageBack();
    await tester.pumpAndSettle();

    // Normalized data renders cleanly across all tabs without Dart type cast crashes
    expect(find.text('Web 日常餐饮'), findsWidgets);
    expect(engine.budgetPools.any((p) => p['id'] == 'POOL_ASSET'), isFalse);
    expect(engine.projectTags.first.containsKey('linked_pool_id'), isFalse);
    expect(engine.settings['fx_default_hold_ratio'], '1.030');

    await tester.tap(find.text('流水与专项'));
    await tester.pumpAndSettle();
    expect(find.text('Web同步晚餐'), findsOneWidget);
    await tester.tap(find.text('专项立项'));
    await tester.pumpAndSettle();
    expect(find.text('#Web考证'), findsOneWidget);
  });

  testWidgets(
      'SettingsPage supports system/light/dark theme, Monet dynamic color, FX settings, and automatic month-end balance rollover',
      (WidgetTester tester) async {
    await _setPhoneViewport(tester);
    final engine = FlutterLedgerEngine();
    engine.upsertBudgetPool(
      id: 'POOL_DAILY',
      name: '高频饮食池',
      poolType: 'DAILY',
      rolloverStrategy: 'ACCUMULATE',
      isMonthlyBudget: true,
    );
    engine.setMonthlyBudget(
      yearMonth: '2026-11',
      poolId: 'POOL_DAILY',
      baseAllocation: '500.00',
    );
    engine.recordManualTransaction(
      amount: '120.00',
      budgetPoolId: 'POOL_DAILY',
      merchantOrNote: '食堂聚餐',
      txDate: '2026-11-10',
    );

    const monetArgb = 0xFF8B5CF6;
    await tester.pumpWidget(
      GeekLedgerApp(
        engine: engine,
        monetSeedArgb: monetArgb,
      ),
    );
    await tester.pumpAndSettle();

    // Default themeMode is ThemeMode.system & Monet color is active
    var appWidget = tester.widget<MaterialApp>(find.byType(MaterialApp));
    expect(appWidget.themeMode, ThemeMode.system);
    final monetPrimary = appWidget.theme!.colorScheme.primary;

    // Open Settings via top-right Settings icon
    await tester.tap(find.byTooltip('设置'));
    await tester.pumpAndSettle();
    expect(find.text('外观与主题'), findsOneWidget);
    expect(find.text('外币默认参数'), findsOneWidget);
    expect(find.text('已从系统壁纸提取动态主题色'), findsOneWidget);

    // Switch theme mode to 深色
    await tester.tap(find.text('深色'));
    await tester.pumpAndSettle();
    appWidget = tester.widget<MaterialApp>(find.byType(MaterialApp));
    expect(appWidget.themeMode, ThemeMode.dark);
    expect(engine.themeModePreference, 'dark');

    // Toggle off Monet color -> switches back to fallback teal seed
    await tester.tap(find.text('莫奈取色 (Material You)'));
    await tester.pumpAndSettle();
    appWidget = tester.widget<MaterialApp>(find.byType(MaterialApp));
    expect(engine.useMonetColor, isFalse);
    expect(appWidget.theme!.colorScheme.primary, isNot(monetPrimary));

    // Update FX settings from SettingsPage
    final holdField = find.widgetWithText(TextField, '默认冻结比例 (%)');
    await tester.ensureVisible(holdField);
    await tester.enterText(holdField, '105');
    final fxSaveBtn = find.text('保存');
    await tester.ensureVisible(fxSaveBtn);
    await tester.tap(fxSaveBtn);
    await tester.pumpAndSettle();
    expect(engine.settings['fx_default_hold_ratio'], '1.050');

    // Return to Overview and switch month 2026-11 -> 2026-12: rollover happens automatically!
    await tester.pageBack();
    await tester.pumpAndSettle();

    await tester.tap(find.text('2026-11'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('12月'));
    await tester.pumpAndSettle();

    expect(find.text('2026-12'), findsOneWidget);
    // 500.00 base + 380.00 rolled-over remaining = 880.00 available
    expect(find.text('总额 ¥880.00'), findsOneWidget);

    // Retroactive expense of ¥30.00 in 2026-11 updates 2026-12 rolled-over balance to 850.00 automatically
    engine.recordManualTransaction(
      amount: '30.00',
      budgetPoolId: 'POOL_DAILY',
      merchantOrNote: '补记宵夜',
      txDate: '2026-11-15',
    );
    await tester.pumpWidget(
      GeekLedgerApp(
        key: const ValueKey<String>('reopened'),
        engine: engine,
        monetSeedArgb: monetArgb,
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('2026-11'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('12月'));
    await tester.pumpAndSettle();
    expect(find.text('2026-12'), findsOneWidget);
    expect(find.text('总额 ¥850.00'), findsOneWidget);
  });

  testWidgets(
      'Pure-Dart reactive listeners update UI automatically, debounced Isolate persistence writes without blocking, and SettingsPage respects MediaQuery reduceMotion',
      (WidgetTester tester) async {
    await _setPhoneViewport(tester);
    final tempDir = Directory.systemTemp.createTempSync('geek_ledger_async_');
    addTearDown(() {
      if (tempDir.existsSync()) {
        tempDir.deleteSync(recursive: true);
      }
    });
    final statePath = '${tempDir.path}${Platform.pathSeparator}async_state.json';

    final engine = FlutterLedgerEngine(storageFilePath: statePath);
    addTearDown(engine.dispose);
    var notifyCount = 0;
    void listener() => notifyCount += 1;
    engine.addListener(listener);

    await tester.pumpWidget(
      MediaQuery(
        data: const MediaQueryData(
          size: Size(360, 780),
          disableAnimations: true,
        ),
        child: GeekLedgerApp(engine: engine),
      ),
    );
    await tester.pumpAndSettle();

    // Mutate engine directly without calling onEngineChanged(): ListenableBuilder updates OverviewTab
    engine.upsertBudgetPool(
      id: 'POOL_DAILY',
      name: '异步餐饮池',
      poolType: 'DAILY',
      isMonthlyBudget: true,
    );
    engine.setMonthlyBudget(
      yearMonth: getLocalTodayDateStr().substring(0, 7),
      poolId: 'POOL_DAILY',
      baseAllocation: '600.00',
    );
    expect(notifyCount, greaterThanOrEqualTo(2));

    // Pumping settles the 60ms debounce timer in FakeAsync, kicking off Isolate.run disk write
    await tester.pumpAndSettle(const Duration(milliseconds: 150));
    expect(find.text('异步餐饮池'), findsOneWidget);

    // Wait for the spawned Isolate.run write to complete on real time
    await tester.runAsync(() async {
      await engine.flushPendingSaves();
    });
    expect(File(statePath).existsSync(), isTrue);
    final reloaded = FlutterLedgerEngine(storageFilePath: statePath);
    expect(reloaded.budgetPools.length, 1);
    expect(reloaded.budgetPools.first['name'], '异步餐饮池');

    // Open Settings via sync pill under reduceMotion/disableAnimations
    expect(find.text('待传 2'), findsOneWidget);
    await tester.tap(find.text('待传 2'));
    await tester.pumpAndSettle();
    expect(find.text('云同步与服务器'), findsOneWidget);

    engine.removeListener(listener);
  });

  testWidgets(
      'PoolWaterCard renders remaining/overspend percentage, dual-segment discount progress bar with time marker, and 3-column single-line tabular footer',
      (WidgetTester tester) async {
    await _setPhoneViewport(tester);
    final engine = FlutterLedgerEngine();
    final today = getLocalTodayDateStr();
    final currentYm = today.substring(0, 7);

    engine.upsertBudgetPool(
      id: 'POOL_DAILY',
      name: '日常',
      poolType: 'DAILY',
      rolloverStrategy: 'ACCUMULATE',
      isMonthlyBudget: true,
    );
    engine.setMonthlyBudget(
      yearMonth: currentYm,
      poolId: 'POOL_DAILY',
      baseAllocation: '800.00',
    );
    engine.upsertBudgetPool(
      id: 'POOL_FIXED',
      name: '固定刚需',
      poolType: 'FIXED',
      rolloverStrategy: 'RESET',
      isMonthlyBudget: true,
    );
    engine.setMonthlyBudget(
      yearMonth: currentYm,
      poolId: 'POOL_FIXED',
      baseAllocation: '204.00',
    );
    engine.upsertBudgetPool(
      id: 'POOL_FLEX',
      name: '弹性消费',
      poolType: 'FLEX',
      rolloverStrategy: 'ACCUMULATE',
      isMonthlyBudget: true,
    );
    engine.setMonthlyBudget(
      yearMonth: currentYm,
      poolId: 'POOL_FLEX',
      baseAllocation: '100.00',
    );

    // 420.65 gross - 35.75 discount = 384.90 net -> remaining 415.10 (51.9%)
    engine.recordFromDsl(
      '超市大采购 420.65 = 384.90',
      txDate: today,
      itemTargetOverrides: <int, Map<String, String?>>{
        0: <String, String?>{'budget_pool_id': 'POOL_DAILY'},
      },
    );
    // Overspend POOL_FLEX: 112.50 > 100.00 -> -12.50 (超支 12.5%)
    engine.recordManualTransaction(
      amount: '112.50',
      budgetPoolId: 'POOL_FLEX',
      merchantOrNote: '外设采购',
      txDate: today,
    );

    await tester.pumpWidget(GeekLedgerApp(engine: engine));
    await tester.pumpAndSettle();

    // Daily pool header, segmented progress bar ratios, and 3-column footer
    expect(find.text('日常'), findsOneWidget);
    expect(find.text('¥415.10'), findsOneWidget);
    expect(find.text('剩 51.9%'), findsOneWidget);
    expect(find.text('总额 ¥800.00'), findsOneWidget);
    expect(find.text('已用 ¥384.90'), findsOneWidget);
    expect(find.textContaining('日均 ¥'), findsWidgets);
    expect(find.textContaining('优惠 ¥'), findsNothing);

    final bars = tester
        .widgetList<SegmentedBudgetProgressBar>(
          find.byType(SegmentedBudgetProgressBar),
        )
        .toList();
    final dailyBar = bars.firstWhere((b) => b.label.contains('日常'));
    expect(dailyBar.spentRatio, closeTo(384.90 / 800.00, 1e-4));
    expect(dailyBar.discountRatio, closeTo(35.75 / 800.00, 1e-4));
    expect(dailyBar.timeProgress, isNotNull);
    expect(dailyBar.timeProgress, closeTo(computeMonthTimeProgress(currentYm)!, 1e-6));

    // Verify tabular figures fontFeature on header amount & footer labels
    final dailyAmountWidget = tester.widget<Text>(find.text('¥415.10'));
    expect(
      dailyAmountWidget.style?.fontFeatures,
      contains(const FontFeature.tabularFigures()),
    );
    final dailyTotalWidget = tester.widget<Text>(find.text('总额 ¥800.00'));
    expect(
      dailyTotalWidget.style?.fontFeatures,
      contains(const FontFeature.tabularFigures()),
    );
    expect(dailyTotalWidget.maxLines, 1);

    // Scroll down to inspect Fixed pool and Overspent Flex pool
    await tester.drag(find.byType(ListView), const Offset(0, -320));
    await tester.pumpAndSettle();

    // Fixed pool uses "剩余 ¥204.00" (not "日均") and has 0 discountRatio
    final fixedCard = find.ancestor(
      of: find.text('固定刚需'),
      matching: find.byType(PoolWaterCard),
    );
    expect(fixedCard, findsOneWidget);
    expect(
      find.descendant(of: fixedCard, matching: find.text('剩余 ¥204.00')),
      findsOneWidget,
    );
    expect(
      find.descendant(of: fixedCard, matching: find.textContaining('日均')),
      findsNothing,
    );
    final fixedBar = tester.widget<SegmentedBudgetProgressBar>(
      find.descendant(
        of: fixedCard,
        matching: find.byType(SegmentedBudgetProgressBar),
      ),
    );
    expect(fixedBar.discountRatio, 0.0);

    // Overspent pool shows negative remaining and "超支 12.5%"
    final flexCard = find.ancestor(
      of: find.text('弹性消费'),
      matching: find.byType(PoolWaterCard),
    );
    expect(flexCard, findsOneWidget);
    expect(
      find.descendant(of: flexCard, matching: find.text('-¥12.50')),
      findsOneWidget,
    );
    expect(
      find.descendant(of: flexCard, matching: find.text('超支 12.5%')),
      findsOneWidget,
    );
    expect(
      find.descendant(of: flexCard, matching: find.text('总额 ¥100.00')),
      findsOneWidget,
    );
    expect(
      find.descendant(of: flexCard, matching: find.text('已用 ¥112.50')),
      findsOneWidget,
    );

    expect(tester.takeException(), isNull);
  });
}
