// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:geek_ledger_mobile/main.dart';
import 'package:geek_ledger_mobile/src/ledger_engine.dart';

void main() {
  testWidgets(
      'V2 3-Tab Shell & Overview Dashboard shows seed budgets, savings pill and pending rule banner',
      (WidgetTester tester) async {
    final engine = FlutterLedgerEngine();
    await tester.pumpWidget(GeekLedgerApp(engine: engine));
    await tester.pumpAndSettle();

    // AppBar shell elements
    expect(find.text('Geek Ledger · Rust FFI'), findsOneWidget);
    expect(find.text('2026-11'), findsOneWidget);
    expect(find.text('已同步'), findsOneWidget);

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
      'Timeline split item expansion, pool rebind, swipe-delete undo and Projects view work end-to-end',
      (WidgetTester tester) async {
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
      'Wallet & Engine tab renders voucher deck, executes recurring rule, and resolves sync conflict',
      (WidgetTester tester) async {
    final engine = FlutterLedgerEngine();
    await tester.pumpWidget(GeekLedgerApp(engine: engine));
    await tester.pumpAndSettle();

    await tester.tap(find.text('卡包与引擎'));
    await tester.pumpAndSettle();

    // Voucher deck + recurring rule 1-tap execution
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

    expect(engine.transactions.length, 1);
    expect(find.textContaining('周期账单已入账:'), findsOneWidget);

    // Scroll down to Fixed Assets section
    await tester.scrollUntilVisible(
      find.text('二手 iPhone 13 mini'),
      250,
      scrollable: walletScroll,
    );
    expect(find.text('二手 iPhone 13 mini'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('希捷3T监控级硬盘+硬盘盒'),
      250,
      scrollable: walletScroll,
    );
    expect(find.text('希捷3T监控级硬盘+硬盘盒'), findsOneWidget);

    // Open Sync & Conflict center from AppBar SyncStatusPill
    await tester.tap(find.textContaining('待同步'));
    await tester.pumpAndSettle();

    expect(find.text('并发冲突裁决 (0)'), findsOneWidget);
    await tester.tap(find.text('模拟冲突演示'));
    await tester.pumpAndSettle();

    expect(find.text('检测到多端同时修改差异'), findsOneWidget);
    await tester.tap(find.text('保留手机版'));
    await tester.pumpAndSettle();

    expect(engine.pendingConflicts, isEmpty);
    expect(find.text('已保留手机版本'), findsOneWidget);
  });
}
