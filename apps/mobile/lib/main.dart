import 'package:material_ui/material_ui.dart';

import 'src/ledger_engine.dart';
import 'src/overview_tab.dart';
import 'src/platform_backup.dart';
import 'src/quick_record_sheet.dart';
import 'src/settings_page.dart';
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
    this.monetSeedArgb,
    this.onPickBackupFile,
    this.onSaveBackupFile,
  });

  final FlutterLedgerEngine? engine;
  final int? monetSeedArgb;
  final JsonFilePicker? onPickBackupFile;
  final JsonFileSaver? onSaveBackupFile;

  @override
  State<GeekLedgerApp> createState() => _GeekLedgerAppState();
}

class _GeekLedgerAppState extends State<GeekLedgerApp>
    with WidgetsBindingObserver {
  FlutterLedgerEngine? _ownedEngine;
  EngineChangeNotifier? _engineNotifier;
  String? _initError;
  int? _monetSeedArgb;

  FlutterLedgerEngine? get _activeEngine => widget.engine ?? _ownedEngine;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _monetSeedArgb =
        widget.monetSeedArgb ?? MobilePlatformBridge.getMonetSeedColorSync();
    if (widget.engine == null) {
      _initOwnedEngineSync();
    }
    _attachEngineNotifier(_activeEngine);
  }

  @override
  void didUpdateWidget(covariant GeekLedgerApp oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.engine != widget.engine) {
      _attachEngineNotifier(_activeEngine);
    }
    if (widget.monetSeedArgb != oldWidget.monetSeedArgb) {
      _monetSeedArgb = widget.monetSeedArgb ??
          MobilePlatformBridge.getMonetSeedColorSync();
    }
  }

  void _initOwnedEngineSync() {
    try {
      final storagePath = MobilePlatformBridge.getStorageFilePathSync();
      final engine = FlutterLedgerEngine(storageFilePath: storagePath);
      final currentYm = getLocalTodayDateStr().substring(0, 7);
      engine.ensureAutoRolloverForMonth(currentYm);
      _ownedEngine = engine;
    } catch (e) {
      _initError = e.toString();
    }
  }

  void _attachEngineNotifier(FlutterLedgerEngine? engine) {
    if (_engineNotifier?.engine == engine) return;
    _engineNotifier?.dispose();
    _engineNotifier = engine == null ? null : EngineChangeNotifier(engine);
  }

  void _refreshMonetColor() {
    if (widget.monetSeedArgb != null) return;
    final monetArgb = MobilePlatformBridge.getMonetSeedColorSync();
    if (mounted && monetArgb != _monetSeedArgb) {
      setState(() => _monetSeedArgb = monetArgb);
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _refreshMonetColor();
    } else if (state == AppLifecycleState.inactive ||
        state == AppLifecycleState.paused ||
        state == AppLifecycleState.detached) {
      _activeEngine?.saveToDisk();
    }
  }

  @override
  void dispose() {
    _engineNotifier?.dispose();
    if (_ownedEngine != null) {
      _ownedEngine!.dispose();
    } else {
      widget.engine?.saveToDisk();
    }
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  ThemeMode _resolveThemeMode() {
    final pref = _activeEngine?.themeModePreference ?? 'system';
    switch (pref) {
      case 'light':
        return ThemeMode.light;
      case 'dark':
        return ThemeMode.dark;
      case 'system':
      default:
        return ThemeMode.system;
    }
  }

  Color _resolveSeedColor() {
    final engine = _activeEngine;
    final useMonet = engine?.useMonetColor ?? true;
    final effectiveMonet = widget.monetSeedArgb ?? _monetSeedArgb;
    if (useMonet && effectiveMonet != null) {
      return Color(effectiveMonet);
    }
    return const Color(0xFF0F766E);
  }

  ThemeData _buildTheme(Brightness brightness, Color seedColor) {
    final scheme = ColorScheme.fromSeed(
      seedColor: seedColor,
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

  Widget _buildMaterialApp(FlutterLedgerEngine? engine) {
    final seedColor = _resolveSeedColor();
    final themeMode = _resolveThemeMode();

    return MaterialApp(
      title: 'Geek Ledger',
      debugShowCheckedModeBanner: false,
      themeMode: themeMode,
      theme: _buildTheme(Brightness.light, seedColor),
      darkTheme: _buildTheme(Brightness.dark, seedColor),
      home: _initError != null
          ? Scaffold(
              appBar: AppBar(title: const Text('初始化失败')),
              body: Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: SelectableText(
                    'Rust Core FFI 初始化失败：\n$_initError',
                    style: const TextStyle(color: Colors.red),
                  ),
                ),
              ),
            )
          : LedgerHomeScreen(
              engine: engine!,
              monetSeedArgb: widget.monetSeedArgb ?? _monetSeedArgb,
              onAppearanceChanged: () => setState(() {}),
              onPickBackupFile: widget.onPickBackupFile,
              onSaveBackupFile: widget.onSaveBackupFile,
            ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final engine = _activeEngine;
    final notifier = _engineNotifier;
    if (notifier == null || engine == null) {
      return _buildMaterialApp(engine);
    }
    return ListenableBuilder(
      listenable: notifier,
      builder: (context, _) => _buildMaterialApp(engine),
    );
  }
}

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

  @override
  void initState() {
    super.initState();
    _selectedMonth = _resolveInitialMonth(widget.engine);
    widget.engine.ensureAutoRolloverForMonth(_selectedMonth);
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
      builder: (_) => _MonthPickerDialog(
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
          onPullSync: _pullSync,
          onEngineChanged: _refresh,
        );
    }
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
          SyncStatusPill(
            engine: engine,
            onTap: () => _openSettings(focusSync: true),
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
            label: '卡包与周期',
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
