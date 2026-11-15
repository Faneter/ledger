import 'dart:io';

// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:geek_ledger_mobile/main.dart';
import 'package:geek_ledger_mobile/src/ledger_engine.dart';

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
      'V2 3-Tab Shell & Overview Dashboard shows seed budgets, honest unsynced pill and pending rule banner at 360x780',
      (WidgetTester tester) async {
    await _setPhoneViewport(tester);
    final engine = FlutterLedgerEngine();
    await tester.pumpWidget(GeekLedgerApp(engine: engine));
    await tester.pumpAndSettle();

    // AppBar shell elements
    expect(find.text('Geek Ledger'), findsOneWidget);
    expect(find.text('2026-11'), findsOneWidget);
    expect(find.text('未同步'), findsOneWidget);

    // 3-Tab NavigationBar + FAB
    expect(find.text('今日看板'), findsOneWidget);
    expect(find.text('流水与专项'), findsOneWidget);
    expect(find.text('卡包与引擎'), findsOneWidget);
    expect(find.text('记一笔'), findsOneWidget);

    // Pending recurring rule banner & daily gauge card
    expect(
      find.textContaining('每月固定话费(移动8+电信29+联通49)'),
      findsOneWidget,
    );
    expect(find.text('一键入账'), findsWidgets);
    expect(find.textContaining('本月薅羊毛已省 ¥0.00'), findsOneWidget);
    expect(find.textContaining('今日可用:'), findsOneWidget);

    // Scroll to verify all 4 budget pools
    final mainScroll = find.byType(Scrollable).first;
    await tester.scrollUntilVisible(
      find.text('固定刚需与定投池'),
      200,
      scrollable: mainScroll,
    );
    expect(find.text('固定刚需与定投池'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('高频饮食与洗护池'),
      200,
      scrollable: mainScroll,
    );
    expect(find.text('高频饮食与洗护池'), findsWidgets);
    await tester.scrollUntilVisible(
      find.text('月度弹性发展池'),
      200,
      scrollable: mainScroll,
    );
    expect(find.text('月度弹性发展池'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('医疗与突发应急池'),
      250,
      scrollable: mainScroll,
    );
    expect(find.text('医疗与突发应急池'), findsOneWidget);
  });

  testWidgets(
      'Half-screen Geek Formula BottomSheet supports live split preview, primary item toggle and voucher mounting',
      (WidgetTester tester) async {
    await _setPhoneViewport(tester);
    final engine = FlutterLedgerEngine();
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

    // Live split preview + smart eligible voucher chip appear
    expect(find.text('实时拆单沙盒'), findsOneWidget);
    final voucherChip = find.text('🎟️ 可用：微信支付10元立减金 (净省 ¥4.01)');
    expect(voucherChip, findsOneWidget);

    await tester.ensureVisible(voucherChip);
    await tester.tap(voucherChip);
    await tester.pumpAndSettle();

    // Mark 排针 as primary item (tap row inside split preview)
    final pinTarget = find.descendant(
      of: find.byType(BottomSheet),
      matching: find.text('排针'),
    );
    await tester.ensureVisible(pinTarget);
    await tester.tap(pinTarget);
    await tester.pumpAndSettle();
    expect(find.text('★ 主商品'), findsOneWidget);

    // Submit 55.00 - 10.00 + 5.99 = 50.99 net
    final confirmBtn = find.text('确认入账 · ¥50.99');
    await tester.ensureVisible(confirmBtn);
    await tester.tap(confirmBtn);
    await tester.pumpAndSettle();

    expect(engine.transactions.length, 1);
    final h = engine.transactions.first['header'] as Map<String, dynamic>;
    expect(h['total_gross'], '55.00');
    expect(h['total_net'], '50.99');
    expect(h['applied_voucher_id'], 1);
    expect(find.textContaining('已记账:'), findsOneWidget);
    expect(find.textContaining('本月薅羊毛已省 ¥4.01'), findsOneWidget);
  });

  testWidgets(
      'Mastercard FX pre-auth hold shows pending banner and settles via SettleFxDialog',
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
    await tester.enterText(sheetField, '4.32 USD GooglePlay #弹性 冻结');
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
    expect(find.textContaining('¥30.94'), findsWidgets);
  });

  testWidgets(
      'Switching month, creating monthly pool, and creating detached project budget work with zero controller disposal errors or overflows',
      (WidgetTester tester) async {
    await _setPhoneViewport(tester);
    final engine = FlutterLedgerEngine();
    await tester.pumpWidget(GeekLedgerApp(engine: engine));
    await tester.pumpAndSettle();

    // 1. Switch billing month via AppBar month pill (typing custom YYYY-MM)
    await tester.tap(find.text('2026-11'));
    await tester.pumpAndSettle();
    expect(find.text('切换账单月份'), findsOneWidget);

    final monthField = find
        .descendant(
          of: find.byType(AlertDialog),
          matching: find.byType(TextField),
        )
        .first;
    await tester.enterText(monthField, '2026-12');
    await tester.tap(find.text('确定'));
    await tester.pumpAndSettle(const Duration(milliseconds: 400));

    expect(find.text('2026-12'), findsOneWidget);

    // 2. Create a new Monthly Budget Pool via Overview dialog
    final mainScroll = find.byType(Scrollable).first;
    final addPoolBtn = find.text('新增/调配');
    await tester.scrollUntilVisible(addPoolBtn, 200, scrollable: mainScroll);
    await tester.tap(addPoolBtn);
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
    // Verify 关联预算池 was completely removed
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
    final engine = FlutterLedgerEngine();
    engine.recordFromDsl('N2报名费 550 #JLPT_N2考试专项', txDate: '2026-11-15');
    engine.recordFromDsl('牛奶 28 + 排针 15 = 35', txDate: '2026-11-16');

    await tester.pumpWidget(GeekLedgerApp(engine: engine));
    await tester.pumpAndSettle();

    await tester.tap(find.text('流水与专项'));
    await tester.pumpAndSettle();

    // Expand split transaction card (牛奶 28 + 排针 15 => 原价 ¥43.00)
    await tester.tap(find.textContaining('原价 ¥43.00'));
    await tester.pumpAndSettle();

    expect(find.text('编辑主账单'), findsOneWidget);

    // Rebind first split child item pool
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

    // Left-swipe Dismissible soft delete + SnackBar Undo
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

    // Switch SegmentedButton to 专项立项
    await tester.tap(find.text('专项立项'));
    await tester.pumpAndSettle();

    expect(find.textContaining('专项预算总览'), findsOneWidget);
    expect(find.text('#JLPT_N2考试专项'), findsOneWidget);
  });

  testWidgets(
      'Wallet & Engine tab + Real HTTP sync with unreachable vs live mock server',
      (WidgetTester tester) async {
    await _setPhoneViewport(tester);

    // Phase 1: Failing HTTP transport keeps pending ops and marks 未连云端
    final offlineEngine = FlutterLedgerEngine(
      httpPost: (_, __) async =>
          throw const SocketException('Connection refused'),
    );
    await tester.pumpWidget(GeekLedgerApp(engine: offlineEngine));
    await tester.pumpAndSettle();

    await tester.tap(find.text('卡包与引擎'));
    await tester.pumpAndSettle();

    // Voucher deck + recurring rule 1-tap execution + fixed assets
    expect(find.text('微信支付10元立减金'), findsOneWidget);
    expect(find.text('美团外卖5元无门槛优惠券'), findsOneWidget);
    expect(
      find.textContaining('每月固定话费(移动8+电信29+联通49)'),
      findsOneWidget,
    );

    final walletScroll = find.byType(Scrollable).first;
    await tester.drag(walletScroll, const Offset(0, -140));
    await tester.pumpAndSettle();

    await tester.tap(find.text('立即入账').first);
    await tester.pumpAndSettle();

    expect(offlineEngine.transactions.length, 1);
    expect(offlineEngine.pendingSyncCount, greaterThan(0));

    // Open Sync Dialog -> attempt sync -> fails honestly without resetting pending count
    await tester.tap(find.textContaining('待传'));
    await tester.pumpAndSettle();
    expect(find.text('云端同步与差异处理'), findsOneWidget);
    expect(find.text('模拟冲突演示'), findsNothing);

    await tester.tap(find.text('立即与服务端同步'));
    await tester.pumpAndSettle();
    expect(offlineEngine.pendingSyncCount, greaterThan(0));
    expect(offlineEngine.lastSyncAt, isNull);
    expect(find.textContaining('连接服务端失败:'), findsOneWidget);

    await tester.tap(find.text('完成'));
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
    engine.recordFromDsl('测试面条 18 #饮食');
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
    expect(pushRes['restored'], isTrue);
    expect(engine.serverResetDetected, isFalse);
    expect(recordedPaths, <String>[
      '/api/sync/exchange',
      '/api/conflicts/cf_1/resolve',
      '/api/sync/exchange',
      '/api/sync/exchange',
      '/api/sync/reseed',
    ]);
  });
}
