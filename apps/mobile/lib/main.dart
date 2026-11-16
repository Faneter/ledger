// ignore: deprecated_member_use
import 'package:flutter/material.dart';

import 'src/ledger_engine.dart';
import 'src/overview_tab.dart';
import 'src/platform_backup.dart';
import 'src/quick_record_sheet.dart';
import 'src/sync_dialog.dart';
import 'src/timeline_tab.dart';
import 'src/ui_helpers.dart';
import 'src/wallet_engine_tab.dart';

void main() {
  runApp(const GeekLedgerApp());
}

class GeekLedgerApp extends StatefulWidget {
  const GeekLedgerApp({
    super.key,
    this.engine,
    this.onPickBackupFile,
    this.onSaveBackupFile,
  });

  final FlutterLedgerEngine? engine;
  final JsonFilePicker? onPickBackupFile;
  final JsonFileSaver? onSaveBackupFile;

  @override
  State<GeekLedgerApp> createState() => _GeekLedgerAppState();
}

class _GeekLedgerAppState extends State<GeekLedgerApp> {
  ThemeMode _themeMode = ThemeMode.light;

  ThemeData _buildTheme(Brightness brightness) {
    final scheme = ColorScheme.fromSeed(
      seedColor: const Color(0xFF0F766E),
      brightness: brightness,
    );
    return ThemeData(
      colorScheme: scheme,
      useMaterial3: true,
      cardTheme: CardThemeData(
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(
            color: scheme.outlineVariant.withValues(alpha: 0.45),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Geek Ledger · Rust FFI',
      debugShowCheckedModeBanner: false,
      themeMode: _themeMode,
      theme: _buildTheme(Brightness.light),
      darkTheme: _buildTheme(Brightness.dark),
      home: LedgerHomeScreen(
        engine: widget.engine,
        themeMode: _themeMode,
        onPickBackupFile: widget.onPickBackupFile,
        onSaveBackupFile: widget.onSaveBackupFile,
        onToggleTheme: () {
          setState(() {
            _themeMode = _themeMode == ThemeMode.dark
                ? ThemeMode.light
                : ThemeMode.dark;
          });
        },
      ),
    );
  }
}

class LedgerHomeScreen extends StatefulWidget {
  const LedgerHomeScreen({
    super.key,
    this.engine,
    this.themeMode = ThemeMode.light,
    this.onToggleTheme,
    this.onPickBackupFile,
    this.onSaveBackupFile,
  });

  final FlutterLedgerEngine? engine;
  final ThemeMode themeMode;
  final VoidCallback? onToggleTheme;
  final JsonFilePicker? onPickBackupFile;
  final JsonFileSaver? onSaveBackupFile;

  @override
  State<LedgerHomeScreen> createState() => _LedgerHomeScreenState();
}

class _LedgerHomeScreenState extends State<LedgerHomeScreen>
    with WidgetsBindingObserver {
  FlutterLedgerEngine? _engine;
  String? _initError;
  int _tabIndex = 0;
  String _selectedMonth = getLocalTodayDateStr().substring(0, 7);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    if (widget.engine != null) {
      _engine = widget.engine;
      _selectedMonth = _resolveInitialMonth(widget.engine!);
    } else {
      _initPersistedEngine();
    }
  }

  Future<void> _initPersistedEngine() async {
    try {
      final storagePath = await MobilePlatformBridge.getStorageFilePath();
      final engine = FlutterLedgerEngine(storageFilePath: storagePath);
      if (!mounted) return;
      setState(() {
        _engine = engine;
        _selectedMonth = _resolveInitialMonth(engine);
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _initError = e.toString();
      });
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.inactive ||
        state == AppLifecycleState.paused ||
        state == AppLifecycleState.detached) {
      _engine?.saveToDisk();
    }
  }

  @override
  void dispose() {
    _engine?.saveToDisk();
    WidgetsBinding.instance.removeObserver(this);
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
    final engine = _engine;
    if (engine == null) return;
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
    final engine = _engine;
    if (engine == null) return;
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
    final engine = _engine;
    if (engine == null) return;
    final res = await engine.syncWithServer();
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

  Future<void> _openSyncDialog() async {
    final engine = _engine;
    if (engine == null) return;
    await showDialog<void>(
      context: context,
      builder: (ctx) => SyncAndConflictDialog(
        engine: engine,
        onEngineChanged: _refresh,
        onPickBackupFile: widget.onPickBackupFile,
        onSaveBackupFile: widget.onSaveBackupFile,
      ),
    );
    if (mounted) {
      _selectedMonth = engine.monthlyBudgets.any(
        (b) => b['year_month'] == _selectedMonth,
      )
          ? _selectedMonth
          : _resolveInitialMonth(engine);
      _refresh();
    }
  }

  Future<void> _openMonthPickerDialog() async {
    final engine = _engine;
    if (engine == null) return;
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
      builder: (_) => _MonthPickerDialog(
        initialMonth: _selectedMonth,
        months: months,
      ),
    );
    if (chosen != null && mounted) {
      setState(() {
        _selectedMonth = chosen;
      });
    }
  }

  Widget _buildActiveTab(FlutterLedgerEngine engine) {
    switch (_tabIndex) {
      case 0:
        return OverviewTab(
          engine: engine,
          selectedMonth: _selectedMonth,
          onSettleFx: _showSettleFxDialog,
          onPullSync: _pullSync,
          onEngineChanged: _refresh,
        );
      case 1:
        return TimelineAndProjectsTab(
          engine: engine,
          onSettleFx: _showSettleFxDialog,
          onPullSync: _pullSync,
          onEngineChanged: _refresh,
        );
      case 2:
      default:
        return WalletAndEngineTab(
          engine: engine,
          selectedMonth: _selectedMonth,
          onMonthChanged: (ym) => setState(() => _selectedMonth = ym),
          onOpenSyncDialog: _openSyncDialog,
          onPullSync: _pullSync,
          onEngineChanged: _refresh,
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_initError != null) {
      return Scaffold(
        appBar: AppBar(title: const Text('初始化失败')),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: SelectableText(
              'Rust Core FFI 初始化失败：\n$_initError',
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ),
        ),
      );
    }

    final engine = _engine;
    if (engine == null) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }
    final isDark = Theme.of(context).brightness == Brightness.dark;
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
          SyncStatusPill(
            engine: engine,
            onTap: _openSyncDialog,
          ),
          if (widget.onToggleTheme != null)
            IconButton(
              visualDensity: VisualDensity.compact,
              constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
              padding: const EdgeInsets.all(4),
              tooltip: '切换深浅色主题',
              icon: Icon(
                isDark ? Icons.light_mode_outlined : Icons.dark_mode_outlined,
                size: 20,
              ),
              onPressed: widget.onToggleTheme,
            ),
          const SizedBox(width: 6),
        ],
      ),
      body: _buildActiveTab(engine),
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
            label: '卡包与引擎',
          ),
        ],
      ),
    );
  }
}

class _MonthPickerDialog extends StatefulWidget {
  const _MonthPickerDialog({
    required this.initialMonth,
    required this.months,
  });

  final String initialMonth;
  final List<String> months;

  @override
  State<_MonthPickerDialog> createState() => _MonthPickerDialogState();
}

class _MonthPickerDialogState extends State<_MonthPickerDialog> {
  late int _displayYear;
  bool _pickingYear = false;

  @override
  void initState() {
    super.initState();
    final parts = widget.initialMonth.split('-');
    _displayYear =
        int.tryParse(parts.isNotEmpty ? parts[0] : '') ?? DateTime.now().year;
  }

  String _formatYearMonth(int year, int month) =>
      '${year.toString().padLeft(4, '0')}-${month.toString().padLeft(2, '0')}';

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final todayYm = getLocalTodayDateStr().substring(0, 7);

    return AlertDialog(
      title: const Text('选择账单月份'),
      content: SizedBox(
        width: 280,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Row(
              children: <Widget>[
                IconButton(
                  tooltip: '上一年',
                  visualDensity: VisualDensity.compact,
                  constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                  padding: EdgeInsets.zero,
                  icon: const Icon(Icons.chevron_left, size: 20),
                  onPressed: _pickingYear
                      ? null
                      : () => setState(() => _displayYear -= 1),
                ),
                Expanded(
                  child: Center(
                    child: TextButton(
                      style: TextButton.styleFrom(
                        visualDensity: VisualDensity.compact,
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 4,
                        ),
                      ),
                      onPressed: () =>
                          setState(() => _pickingYear = !_pickingYear),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: <Widget>[
                          Text(
                            '$_displayYear 年',
                            style: const TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          const SizedBox(width: 2),
                          Icon(
                            _pickingYear
                                ? Icons.arrow_drop_up
                                : Icons.arrow_drop_down,
                            size: 18,
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
                IconButton(
                  tooltip: '下一年',
                  visualDensity: VisualDensity.compact,
                  constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                  padding: EdgeInsets.zero,
                  icon: const Icon(Icons.chevron_right, size: 20),
                  onPressed: _pickingYear
                      ? null
                      : () => setState(() => _displayYear += 1),
                ),
              ],
            ),
            const SizedBox(height: 8),
            if (_pickingYear)
              SizedBox(
                height: 216,
                child: YearPicker(
                  firstDate: DateTime(2000),
                  lastDate: DateTime(2100),
                  selectedDate: DateTime(_displayYear),
                  onChanged: (DateTime picked) {
                    setState(() {
                      _displayYear = picked.year;
                      _pickingYear = false;
                    });
                  },
                ),
              )
            else
              GridView.count(
                crossAxisCount: 3,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                mainAxisSpacing: 8,
                crossAxisSpacing: 8,
                childAspectRatio: 1.85,
                children: List<Widget>.generate(12, (idx) {
                  final month = idx + 1;
                  final ym = _formatYearMonth(_displayYear, month);
                  final isSelected = ym == widget.initialMonth;
                  final isToday = ym == todayYm;
                  final hasData = widget.months.contains(ym);

                  return Material(
                    color: isSelected
                        ? cs.primary
                        : cs.surfaceContainerHighest.withValues(alpha: 0.6),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                      side: isToday && !isSelected
                          ? BorderSide(color: cs.primary, width: 1.2)
                          : BorderSide.none,
                    ),
                    child: InkWell(
                      borderRadius: BorderRadius.circular(12),
                      onTap: () => Navigator.of(context).pop(ym),
                      child: Stack(
                        alignment: Alignment.center,
                        children: <Widget>[
                          Text(
                            '$month月',
                            style: TextStyle(
                              fontWeight: FontWeight.w600,
                              fontSize: 13,
                              color: isSelected ? cs.onPrimary : cs.onSurface,
                            ),
                          ),
                          if (hasData && !isSelected)
                            Positioned(
                              bottom: 5,
                              child: Container(
                                width: 4,
                                height: 4,
                                decoration: BoxDecoration(
                                  color: cs.primary,
                                  shape: BoxShape.circle,
                                ),
                              ),
                            ),
                        ],
                      ),
                    ),
                  );
                }),
              ),
          ],
        ),
      ),
      actions: <Widget>[
        TextButton(
          onPressed: () => Navigator.of(context).pop(todayYm),
          child: const Text('回到本月'),
        ),
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('取消'),
        ),
      ],
    );
  }
}
