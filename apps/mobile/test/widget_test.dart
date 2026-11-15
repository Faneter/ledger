// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:geek_ledger_mobile/main.dart';
import 'package:geek_ledger_mobile/src/ledger_engine.dart';

void main() {
  testWidgets('Initial render displays 2026-11 seed state and all budget pools',
      (WidgetTester tester) async {
    final engine = FlutterLedgerEngine();
    await tester.pumpWidget(GeekLedgerApp(engine: engine));

    await tester.tap(find.byIcon(Icons.restart_alt));
    await tester.pumpAndSettle();

    expect(find.text('Geek Ledger · Rust FFI'), findsOneWidget);
    expect(find.text('极速记账 DSL（Rust 引擎解析）'), findsOneWidget);
    expect(find.text('2026-11 总预算 ¥1500.00 · 已支净额 ¥0.00'), findsOneWidget);

    final verticalScrollable = find.byWidgetPredicate(
      (Widget w) => w is Scrollable && w.axis == Axis.vertical,
    );

    await tester.scrollUntilVisible(
      find.text('固定刚需与定投池'),
      150,
      scrollable: verticalScrollable,
    );
    expect(find.text('固定刚需与定投池'), findsOneWidget);

    await tester.scrollUntilVisible(
      find.text('高频饮食与洗护池'),
      150,
      scrollable: verticalScrollable,
    );
    expect(find.text('高频饮食与洗护池'), findsOneWidget);

    await tester.scrollUntilVisible(
      find.text('医疗与突发应急池'),
      150,
      scrollable: verticalScrollable,
    );
    expect(find.text('月度弹性发展池'), findsOneWidget);
    expect(find.text('医疗与突发应急池'), findsOneWidget);
  });

  testWidgets('DSL expense recording updates budget and renders in Transactions tab',
      (WidgetTester tester) async {
    final engine = FlutterLedgerEngine();
    await tester.pumpWidget(GeekLedgerApp(engine: engine));

    await tester.tap(find.byIcon(Icons.restart_alt));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField).first, '咸蛋黄拌面 16.8-0.15 #饮食');
    await tester.tap(find.byIcon(Icons.send));
    await tester.pumpAndSettle();

    expect(find.text('2026-11 总预算 ¥1500.00 · 已支净额 ¥16.65'), findsOneWidget);

    await tester.tap(find.text('流水'));
    await tester.pumpAndSettle();

    expect(find.text('咸蛋黄拌面'), findsOneWidget);
    expect(find.text('¥16.65'), findsOneWidget);
  });

  testWidgets('Mastercard FX pre-auth hold and settlement dialog updates ledger',
      (WidgetTester tester) async {
    final engine = FlutterLedgerEngine();
    await tester.pumpWidget(GeekLedgerApp(engine: engine));

    await tester.tap(find.byIcon(Icons.restart_alt));
    await tester.pumpAndSettle();

    await tester.enterText(
      find.byType(TextField).first,
      r'Porkbun域名 $4.35 冻结31.95 #数字服务',
    );
    await tester.tap(find.byIcon(Icons.send));
    await tester.pumpAndSettle();

    await tester.tap(find.text('流水'));
    await tester.pumpAndSettle();

    expect(find.text('Porkbun域名'), findsOneWidget);
    expect(find.textContaining('待清算(冻结¥31.95)'), findsOneWidget);

    await tester.tap(find.byIcon(Icons.currency_exchange));
    await tester.pumpAndSettle();

    expect(find.text('万事达外币预授权清算'), findsOneWidget);
    final dialogField = find.descendant(
      of: find.byType(AlertDialog),
      matching: find.byType(TextField),
    );
    await tester.enterText(dialogField, '31.25');
    await tester.tap(find.text('确认入账'));
    await tester.pumpAndSettle();

    expect(find.text('¥30.94'), findsOneWidget);
    expect(find.textContaining('待清算(冻结¥31.95)'), findsNothing);
  });

  testWidgets('Vouchers tab creation dialog and Assets/Sync tab render seed state',
      (WidgetTester tester) async {
    final engine = FlutterLedgerEngine();
    await tester.pumpWidget(GeekLedgerApp(engine: engine));

    await tester.tap(find.byIcon(Icons.restart_alt));
    await tester.pumpAndSettle();

    final initialVouchersCount = engine.vouchers.length;

    await tester.tap(find.text('卡包'));
    await tester.pumpAndSettle();

    expect(find.text('买券/添券'), findsOneWidget);
    await tester.tap(find.text('买券/添券'));
    await tester.pumpAndSettle();

    expect(find.text('购买 / 新增卡券'), findsOneWidget);
    await tester.tap(find.text('入库'));
    await tester.pumpAndSettle();

    expect(engine.vouchers.length, initialVouchersCount + 1);

    await tester.tap(find.text('资产与同步'));
    await tester.pumpAndSettle();

    expect(find.text('Rust FFI Core Engine 状态正常'), findsOneWidget);
    expect(find.text('二手 iPhone 13 mini'), findsOneWidget);
    expect(find.text('希捷3T监控级硬盘+硬盘盒'), findsOneWidget);
  });
}
