import 'package:material_ui/material_ui.dart';

import 'ledger_engine.dart';
import 'overview_tab.dart';
import 'platform_backup.dart';
import 'quick_record_sheet.dart';
import 'settings_page.dart';
import 'timeline_tab.dart';
import 'ui_helpers.dart';
import 'wallet_engine_tab.dart';
import 'widgets/month_picker_dialog.dart';

class LedgerHomeScreen extends StatefulWidget {
  const LedgerHomeScreen({
    super.key,
    required this.engine,
    required this.onAppearanceChanged,
    this.monetSeedArgb,
    this.onPickBackupFile,
    this.onSaveBackupFile,
  });

  final FlutterLedgerEngine engine;
  final VoidCallback onAppearanceChanged;
  final int? monetSeedArgb;
  final JsonFilePicker? onPickBackupFile;
  final JsonFileSaver? onSaveBackupFile;

  @override
  State<LedgerHomeScreen> createState() => _LedgerHomeScreenState();
}

class _LedgerHomeScreenState extends State<LedgerHomeScreen> {
  int _tabIndex = 0;
  late String _selectedMonth;
  late EngineChangeNotifier _engineNotifier;

  @override
  void initState() {
    super.initState();
    _selectedMonth = _resolveInitialMonth(widget.engine);
    widget.engine.ensureAutoRolloverForMonth(_selectedMonth);
    _engineNotifier = EngineChangeNotifier(widget.engine);
  }

  @override
  void didUpdateWidget(covariant LedgerHomeScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.engine != widget.engine) {
      _engineNotifier.dispose();
      _engineNotifier = EngineChangeNotifier(widget.engine);
    }
  }

  @override
  void dispose() {
    _engineNotifier.dispose();
    super.dispose();
  }

  static String _resolveInitialMonth(FlutterLedgerEngine engine) {
    final todayYm = getLocalTodayDateStr().substring(0, 7);
    if (engine.monthlyBudgets.any((b) => b['year_month'] == todayYm)) {
      return todayYm;
    }
    if (engine.monthlyBudgets.isNotEmpty) {
      return (engine.monthlyBudgets.last['year_month'] as String?) ?? todayYm;
    }
    return todayYm;
  }

  void _refresh() {
    if (!mounted) return;
    setState(() {});
  }

  Future<void> _openQuickRecordSheet({
    String initialMode = 'dsl',
  }) async {
    final engine = widget.engine;
    final tx = await showQuickRecordModal(
      context,
      engine,
      initialMode: initialMode,
    );
    if (tx == null || !mounted) return;
    final h = tx['header'] as Map<String, dynamic>;
    setState(() {
      _selectedMonth = (h['tx_date'] as String).substring(0, 7);
    });
    showLedgerSnackBar(
      context,
      '已记账: ${h['merchant_or_note']} ¥${h['total_net']}',
    );
  }

  Future<void> _showSettleFxDialog(Map<String, dynamic> tx) async {
    final engine = widget.engine;
    final h = tx['header'] as Map<String, dynamic>;
    final result = await showDialog<Map<String, String>>(
      context: context,
      builder: (ctx) => SettleFxDialog(
        merchantOrNote: (h['merchant_or_note'] as String?) ?? '',
        originalCurrency: (h['original_currency'] as String?) ?? 'USD',
        originalAmount: (h['original_amount'] as String?) ?? '',
        holdAmountCny: (h['total_gross'] as String?) ?? '0.00',
        initialSettledAmount: (h['total_gross'] as String?) ?? '',
        initialCashbackRate: (h['fx_cashback_rate'] as String?) ??
            (engine.settings['fx_default_cashback_rate'] ?? '0.0100'),
      ),
    );
    if (result == null || !mounted) return;
    final settledAmt = result['settledAmountCny'];
    if (settledAmt == null || settledAmt.isEmpty) return;

    try {
      final updated = engine.settleMastercardTransaction(
        h['id'] as String,
        settledAmt,
        cashbackRate: result['cashbackRate'],
      );
      final uh = updated['header'] as Map<String, dynamic>;
      _refresh();
      if (mounted) {
        showLedgerSnackBar(
          context,
          '外币清算完成 · 实付净额 ¥${uh['total_net']}',
        );
      }
    } catch (e) {
      if (mounted) {
        showLedgerSnackBar(context, '清算失败: $e', isError: true);
      }
    }
  }

  Future<void> _pullSync() async {
    final engine = widget.engine;
    final res = await engine.syncWithServer();
    engine.ensureAutoRolloverForMonth(_selectedMonth);
    _refresh();
    if (!mounted) return;
    if (res['success'] == true) {
      showLedgerSnackBar(
        context,
        '云端 HLC 同步完成（推送 ${res['pushedCount']} 条 · 累计 ${res['totalOplogCount']} 条）',
      );
    } else {
      showLedgerSnackBar(
        context,
        (res['message'] as String?) ?? '同步未完成',
        isError: res['skipped'] != true,
      );
    }
  }

  Future<void> _openSettings({bool focusSync = false}) async {
    final engine = widget.engine;
    await Navigator.of(context).push<void>(
      MaterialPageRoute<void>(
        builder: (ctx) => SettingsPage(
          engine: engine,
          monetSeedArgb: widget.monetSeedArgb,
          focusSyncSection: focusSync,
          onEngineChanged: _refresh,
          onAppearanceChanged: widget.onAppearanceChanged,
          onPickBackupFile: widget.onPickBackupFile,
          onSaveBackupFile: widget.onSaveBackupFile,
        ),
      ),
    );
    if (mounted) {
      _selectedMonth = engine.monthlyBudgets.any(
        (b) => b['year_month'] == _selectedMonth,
      )
          ? _selectedMonth
          : _resolveInitialMonth(engine);
      engine.ensureAutoRolloverForMonth(_selectedMonth);
      _refresh();
    }
  }

  Future<void> _openMonthPickerDialog() async {
    final engine = widget.engine;
    final months = <String>{
      _selectedMonth,
      getLocalTodayDateStr().substring(0, 7),
      for (final b in engine.monthlyBudgets)
        if (b['year_month'] is String) b['year_month'] as String,
      for (final tx in engine.transactions)
        ((tx['header'] as Map<String, dynamic>)['tx_date'] as String)
            .substring(0, 7),
    }.toList()
      ..sort((a, b) => b.compareTo(a));

    final chosen = await showDialog<String>(
      context: context,
      builder: (_) => MonthPickerDialog(
        initialMonth: _selectedMonth,
        months: months,
      ),
    );
    if (chosen != null && mounted) {
      engine.ensureAutoRolloverForMonth(chosen);
      setState(() {
        _selectedMonth = chosen;
      });
    }
  }

  Widget _buildTabBody(FlutterLedgerEngine engine) {
    return ListenableBuilder(
      listenable: _engineNotifier,
      builder: (context, _) => IndexedStack(
        index: _tabIndex,
        children: <Widget>[
          OverviewTab(
            engine: engine,
            selectedMonth: _selectedMonth,
            onSettleFx: _showSettleFxDialog,
            onPullSync: _pullSync,
            onEngineChanged: _refresh,
          ),
          TimelineAndProjectsTab(
            engine: engine,
            onSettleFx: _showSettleFxDialog,
            onPullSync: _pullSync,
            onEngineChanged: _refresh,
          ),
          WalletAndEngineTab(
            engine: engine,
            onPullSync: _pullSync,
            onEngineChanged: _refresh,
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final engine = widget.engine;
    final cs = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: false,
        titleSpacing: 12,
        title: InkWell(
          borderRadius: BorderRadius.circular(999),
          onTap: _openMonthPickerDialog,
          child: Tooltip(
            message: '切换账单月份',
            child: Container(
              padding: const EdgeInsets.symmetric(
                horizontal: 10,
                vertical: 6,
              ),
              decoration: BoxDecoration(
                color: cs.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(999),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  const Icon(Icons.calendar_month_outlined, size: 15),
                  const SizedBox(width: 5),
                  Text(
                    _selectedMonth,
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(width: 2),
                  const Icon(Icons.arrow_drop_down, size: 16),
                ],
              ),
            ),
          ),
        ),
        actions: <Widget>[
          ListenableBuilder(
            listenable: _engineNotifier,
            builder: (context, _) => SyncStatusPill(
              engine: engine,
              onTap: () => _openSettings(focusSync: true),
            ),
          ),
          IconButton(
            visualDensity: VisualDensity.compact,
            constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
            padding: const EdgeInsets.all(4),
            tooltip: '设置',
            icon: const Icon(Icons.settings_outlined, size: 20),
            onPressed: () => _openSettings(),
          ),
          const SizedBox(width: 6),
        ],
      ),
      body: _buildTabBody(engine),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _openQuickRecordSheet(),
        icon: const Icon(Icons.add),
        label: const Text('记一笔'),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tabIndex,
        onDestinationSelected: (idx) => setState(() => _tabIndex = idx),
        destinations: const <NavigationDestination>[
          NavigationDestination(
            icon: Icon(Icons.today_outlined),
            selectedIcon: Icon(Icons.today),
            label: '今日看板',
          ),
          NavigationDestination(
            icon: Icon(Icons.receipt_long_outlined),
            selectedIcon: Icon(Icons.receipt_long),
            label: '流水与专项',
          ),
          NavigationDestination(
            icon: Icon(Icons.account_balance_wallet_outlined),
            selectedIcon: Icon(Icons.account_balance_wallet),
            label: '卡包与周期',
          ),
        ],
      ),
    );
  }
}
