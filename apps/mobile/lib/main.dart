// ignore: deprecated_member_use
import 'package:flutter/material.dart';

import 'src/ledger_engine.dart';
import 'src/overview_tab.dart';
import 'src/quick_record_sheet.dart';
import 'src/sync_dialog.dart';
import 'src/timeline_tab.dart';
import 'src/ui_helpers.dart';
import 'src/wallet_engine_tab.dart';

void main() {
  runApp(const GeekLedgerApp());
}

class GeekLedgerApp extends StatefulWidget {
  const GeekLedgerApp({super.key, this.engine});

  final FlutterLedgerEngine? engine;

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
  });

  final FlutterLedgerEngine? engine;
  final ThemeMode themeMode;
  final VoidCallback? onToggleTheme;

  @override
  State<LedgerHomeScreen> createState() => _LedgerHomeScreenState();
}

class _LedgerHomeScreenState extends State<LedgerHomeScreen> {
  FlutterLedgerEngine? _engine;
  String? _initError;
  int _tabIndex = 0;
  String _selectedMonth = getLocalTodayDateStr().substring(0, 7);

  final TextEditingController _dslController = TextEditingController();
  int? _selectedVoucherId;

  @override
  void initState() {
    super.initState();
    try {
      final engine = widget.engine ?? FlutterLedgerEngine();
      _engine = engine;
      _selectedMonth = _resolveInitialMonth(engine);
    } catch (e) {
      _initError = e.toString();
    }
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

  @override
  void dispose() {
    _dslController.dispose();
    super.dispose();
  }

  void _refresh() {
    if (!mounted) return;
    setState(() {});
  }

  void _submitInlineDsl() {
    final engine = _engine;
    final raw = _dslController.text.trim();
    if (engine == null || raw.isEmpty) return;

    try {
      final tx = engine.recordFromDsl(
        raw,
        appliedVoucherId: _selectedVoucherId,
      );
      final h = tx['header'] as Map<String, dynamic>;
      _selectedMonth = (h['tx_date'] as String).substring(0, 7);
      _dslController.clear();
      setState(() {
        _selectedVoucherId = null;
      });
      showLedgerSnackBar(
        context,
        '已记账: ${h['merchant_or_note']} ¥${h['total_net']}',
      );
    } catch (e) {
      showLedgerSnackBar(context, '解析失败: $e', isError: true);
    }
  }

  Future<void> _openQuickRecordSheet({
    String initialMode = 'dsl',
  }) async {
    final engine = _engine;
    if (engine == null) return;
    final prefill = _dslController.text.trim();
    final tx = await showQuickRecordModal(
      context,
      engine,
      initialMode: initialMode,
      initialDsl: prefill.isNotEmpty ? prefill : null,
    );
    if (tx == null || !mounted) return;
    final h = tx['header'] as Map<String, dynamic>;
    _selectedMonth = (h['tx_date'] as String).substring(0, 7);
    if (prefill.isNotEmpty) {
      _dslController.clear();
    }
    setState(() {
      _selectedVoucherId = null;
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
          dslController: _dslController,
          selectedVoucherId: _selectedVoucherId,
          onVoucherChanged: (id) => setState(() => _selectedVoucherId = id),
          onSubmitInlineDsl: _submitInlineDsl,
          onOpenQuickSheet: () => _openQuickRecordSheet(),
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
        appBar: AppBar(title: const Text('Geek Ledger · 初始化失败')),
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

    final engine = _engine!;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final cs = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        titleSpacing: 10,
        title: const Text(
          'Geek Ledger',
          overflow: TextOverflow.ellipsis,
          style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
        ),
        actions: <Widget>[
          Padding(
            padding: const EdgeInsets.only(right: 4),
            child: InkWell(
              borderRadius: BorderRadius.circular(999),
              onTap: _openMonthPickerDialog,
              child: Tooltip(
                message: '切换账单月份',
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: cs.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      Text(
                        _selectedMonth,
                        style: const TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(width: 1),
                      const Icon(Icons.arrow_drop_down, size: 15),
                    ],
                  ),
                ),
              ),
            ),
          ),
          SyncStatusPill(
            engine: engine,
            onTap: _openSyncDialog,
          ),
          if (widget.onToggleTheme != null)
            IconButton(
              visualDensity: VisualDensity.compact,
              constraints: const BoxConstraints(minWidth: 34, minHeight: 34),
              padding: const EdgeInsets.all(4),
              tooltip: '切换深浅色主题',
              icon: Icon(
                isDark ? Icons.light_mode_outlined : Icons.dark_mode_outlined,
                size: 19,
              ),
              onPressed: widget.onToggleTheme,
            ),
          IconButton(
            visualDensity: VisualDensity.compact,
            constraints: const BoxConstraints(minWidth: 34, minHeight: 34),
            padding: const EdgeInsets.all(4),
            tooltip: '重设至 2026-11 默认种子',
            icon: const Icon(Icons.restart_alt, size: 19),
            onPressed: () {
              engine.resetToDefaultSeed();
              _dslController.clear();
              setState(() {
                _selectedVoucherId = null;
                _selectedMonth = _resolveInitialMonth(engine);
              });
              showLedgerSnackBar(context, '已重设至 2026-11 默认种子');
            },
          ),
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
  late final TextEditingController _customCtrl;
  String? _error;

  @override
  void initState() {
    super.initState();
    _customCtrl = TextEditingController(text: widget.initialMonth);
  }

  @override
  void dispose() {
    _customCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('切换账单月份'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: widget.months.map((ym) {
                return ChoiceChip(
                  label: Text(ym),
                  selected: ym == widget.initialMonth,
                  onSelected: (_) => Navigator.of(context).pop(ym),
                );
              }).toList(),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _customCtrl,
              decoration: InputDecoration(
                labelText: '或输入月份 (YYYY-MM)',
                border: const OutlineInputBorder(),
                errorText: _error,
              ),
              onChanged: (_) {
                if (_error != null) setState(() => _error = null);
              },
            ),
          ],
        ),
      ),
      actions: <Widget>[
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('取消'),
        ),
        FilledButton(
          onPressed: () {
            final text = _customCtrl.text.trim();
            if (!RegExp(r'^\d{4}-\d{2}$').hasMatch(text)) {
              setState(() => _error = '请输入 YYYY-MM 格式，如 2026-12');
              return;
            }
            final m = int.tryParse(text.substring(5, 7)) ?? 0;
            if (m < 1 || m > 12) {
              setState(() => _error = '月份需在 01-12 之间');
              return;
            }
            Navigator.of(context).pop(text);
          },
          child: const Text('确定'),
        ),
      ],
    );
  }
}
