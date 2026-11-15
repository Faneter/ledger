import 'package:flutter/material.dart';

import 'src/ledger_engine.dart';
import 'src/rust_bridge.dart';

void main() {
  runApp(const GeekLedgerApp());
}

class GeekLedgerApp extends StatelessWidget {
  const GeekLedgerApp({super.key, this.engine});

  final FlutterLedgerEngine? engine;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Geek Student Ledger',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorSchemeSeed: const Color(0xFF0F766E),
        useMaterial3: true,
      ),
      home: LedgerHomeScreen(engine: engine),
    );
  }
}

class LedgerHomeScreen extends StatefulWidget {
  const LedgerHomeScreen({super.key, this.engine});

  final FlutterLedgerEngine? engine;

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
      _engine = widget.engine ?? FlutterLedgerEngine();
    } catch (e) {
      _initError = e.toString();
    }
  }

  @override
  void dispose() {
    _dslController.dispose();
    super.dispose();
  }

  void _showMessage(String msg, {bool isError = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(msg),
        backgroundColor: isError ? Theme.of(context).colorScheme.error : null,
      ),
    );
  }

  void _submitDsl() {
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
      _showMessage('已记账: ${h['merchant_or_note']} ¥${h['total_net']}');
    } catch (e) {
      _showMessage('解析失败: $e', isError: true);
    }
  }

  Future<void> _showSettleFxDialog(Map<String, dynamic> tx) async {
    final engine = _engine;
    if (engine == null) return;
    final h = tx['header'] as Map<String, dynamic>;
    final controller =
        TextEditingController(text: (h['total_gross'] as String?) ?? '');
    final settledStr = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('万事达外币预授权清算'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text('${h['merchant_or_note']} (${h['original_currency']} ${h['original_amount']})'),
            const SizedBox(height: 8),
            TextField(
              controller: controller,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(
                labelText: '银行实际入账人民币金额 (CNY)',
                border: OutlineInputBorder(),
              ),
            ),
          ],
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(controller.text.trim()),
            child: const Text('确认入账'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (settledStr == null || settledStr.isEmpty) return;
    try {
      engine.settleMastercardTransaction(h['id'] as String, settledStr);
      setState(() {});
      _showMessage('外币清算完成');
    } catch (e) {
      _showMessage('清算失败: $e', isError: true);
    }
  }

  Future<void> _showBuyVoucherDialog() async {
    final engine = _engine;
    if (engine == null) return;
    final faceCtrl = TextEditingController(text: '15.00');
    final costCtrl = TextEditingController(text: '8.90');
    final minCtrl = TextEditingController(text: '20.00');
    var vType = 'PREPAID_COUPON';

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: const Text('购买 / 新增卡券'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              DropdownButtonFormField<String>(
                value: vType,
                decoration: const InputDecoration(labelText: '卡券类型'),
                items: const <DropdownMenuItem<String>>[
                  DropdownMenuItem<String>(
                    value: 'PREPAID_COUPON',
                    child: Text('有偿购入立减金 (成本核销结转)'),
                  ),
                  DropdownMenuItem<String>(
                    value: 'FREE_COUPON',
                    child: Text('免费领券'),
                  ),
                ],
                onChanged: (v) {
                  if (v != null) {
                    setDialogState(() => vType = v);
                  }
                },
              ),
              const SizedBox(height: 8),
              TextField(
                controller: faceCtrl,
                decoration: const InputDecoration(labelText: '面额 (CNY)'),
              ),
              TextField(
                controller: costCtrl,
                decoration: const InputDecoration(labelText: '购券成本 (CNY)'),
              ),
              TextField(
                controller: minCtrl,
                decoration: const InputDecoration(labelText: '使用门槛 (CNY)'),
              ),
            ],
          ),
          actions: <Widget>[
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: const Text('取消'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(ctx).pop(true),
              child: const Text('入库'),
            ),
          ],
        ),
      ),
    );

    if (confirmed == true) {
      try {
        engine.upsertVoucher(
          voucherType: vType,
          faceValue: faceCtrl.text.trim(),
          acquireCost: costCtrl.text.trim(),
          minSpend: minCtrl.text.trim(),
        );
        setState(() {});
        _showMessage('卡券已入库');
      } catch (e) {
        _showMessage('入库失败: $e', isError: true);
      }
    }
    faceCtrl.dispose();
    costCtrl.dispose();
    minCtrl.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_initError != null || _engine == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Geek Student Ledger')),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Text(
              'Rust Core FFI 初始化失败:\n${_initError ?? "Unknown error"}',
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ),
        ),
      );
    }

    final engine = _engine!;
    final dashboard = engine.getMonthlyBudgetDashboard(_selectedMonth);
    final dailySummary = engine.getDailyBudgetSummary(_selectedMonth);
    final pools = (dashboard['pools'] as List<dynamic>)
        .cast<Map<String, dynamic>>();
    final recentTxs = engine.getRecentTransactions(50);
    final availableVouchers = engine.vouchers
        .where((v) => v['status'] == 'AVAILABLE')
        .toList();
    final assets = engine.getFixedAssetsWithCost();

    final pages = <Widget>[
      _buildOverviewTab(engine, dashboard, dailySummary, pools, availableVouchers),
      _buildTransactionsTab(engine, recentTxs),
      _buildVouchersTab(engine),
      _buildAssetsAndSyncTab(engine, assets),
    ];

    return Scaffold(
      appBar: AppBar(
        title: const Text('Geek Ledger · Rust FFI'),
        actions: <Widget>[
          IconButton(
            tooltip: '重设至 2026-11 默认种子',
            icon: const Icon(Icons.restart_alt),
            onPressed: () {
              engine.resetToDefaultSeed();
              setState(() {
                _selectedMonth = '2026-11';
                _selectedVoucherId = null;
              });
              _showMessage('已恢复 2026-11 种子状态');
            },
          ),
        ],
      ),
      body: pages[_tabIndex],
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tabIndex,
        onDestinationSelected: (idx) => setState(() => _tabIndex = idx),
        destinations: const <NavigationDestination>[
          NavigationDestination(icon: Icon(Icons.dashboard_outlined), label: '预算看板'),
          NavigationDestination(icon: Icon(Icons.receipt_long_outlined), label: '流水'),
          NavigationDestination(icon: Icon(Icons.confirmation_number_outlined), label: '卡包'),
          NavigationDestination(icon: Icon(Icons.devices_other_outlined), label: '资产与同步'),
        ],
      ),
    );
  }

  Widget _buildOverviewTab(
    FlutterLedgerEngine engine,
    Map<String, dynamic> dashboard,
    Map<String, dynamic> dailySummary,
    List<Map<String, dynamic>> pools,
    List<Map<String, dynamic>> availableVouchers,
  ) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: <Widget>[
        Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                const Text(
                  '极速记账 DSL（Rust 引擎解析）',
                  style: TextStyle(fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: _dslController,
                  decoration: InputDecoration(
                    hintText: '例: 咸蛋黄拌面 16.8-0.15 #饮食 或 Porkbun \$4.35 冻结31.95',
                    border: const OutlineInputBorder(),
                    suffixIcon: IconButton(
                      icon: const Icon(Icons.send),
                      onPressed: _submitDsl,
                    ),
                  ),
                  onSubmitted: (_) => _submitDsl(),
                ),
                if (availableVouchers.isNotEmpty) ...<Widget>[
                  const SizedBox(height: 8),
                  DropdownButtonFormField<int?>(
                    value: _selectedVoucherId,
                    decoration: const InputDecoration(
                      labelText: '叠加卡券核销（可选）',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                    items: <DropdownMenuItem<int?>>[
                      const DropdownMenuItem<int?>(
                        value: null,
                        child: Text('不使用卡券'),
                      ),
                      ...availableVouchers.map(
                        (v) => DropdownMenuItem<int?>(
                          value: v['id'] as int,
                          child: Text(
                            '${v['title']} (成本 ¥${v['acquire_cost']} / 满 ¥${v['min_spend']})',
                          ),
                        ),
                      ),
                    ],
                    onChanged: (val) => setState(() => _selectedVoucherId = val),
                  ),
                ],
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        Card(
          color: Theme.of(context).colorScheme.primaryContainer,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  dailySummary['poolName'] as String,
                  style: Theme.of(context).textTheme.titleSmall,
                ),
                const SizedBox(height: 6),
                Text(
                  '今日可用: ¥${dailySummary['dailyAvailableAmount']} / 天',
                  style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                ),
                const SizedBox(height: 4),
                Text('公式: ${dailySummary['formula']} · 累计省钱 ¥${dailySummary['totalSavedWool']}'),
                const SizedBox(height: 6),
                Text(
                  '$_selectedMonth 总预算 ¥${dashboard['totalMonthlyBudget']} · 已支净额 ¥${dashboard['totalMonthlySpent']}',
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        for (final pool in pools)
          Card(
            child: ListTile(
              title: Text(pool['pool_name'] as String),
              subtitle: Text(
                '可用 ¥${pool['total_available_budget']} · 已用 ¥${pool['spent_net']} · 优惠 ¥${pool['total_saved_discount']}',
              ),
              trailing: Text(
                '¥${pool['remaining_budget']}',
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
              ),
            ),
          ),
      ],
    );
  }

  Widget _buildTransactionsTab(
    FlutterLedgerEngine engine,
    List<Map<String, dynamic>> txs,
  ) {
    if (txs.isEmpty) {
      return const Center(child: Text('暂无交易流水，去预算看板记一笔吧'));
    }
    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: txs.length,
      separatorBuilder: (_, __) => const SizedBox(height: 8),
      itemBuilder: (ctx, i) {
        final tx = txs[i];
        final h = tx['header'] as Map<String, dynamic>;
        final isPendingFx = h['settlement_status'] == 'PENDING_HOLD';
        return Card(
          child: ListTile(
            title: Text(h['merchant_or_note'] as String),
            subtitle: Text(
              '${h['tx_date']} · ${h['tx_type']} · 原价 ¥${h['total_gross']}'
              '${isPendingFx ? ' · 待清算(冻结¥${h['hold_amount_cny']})' : ''}',
            ),
            trailing: Row(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  '¥${h['total_net']}',
                  style: const TextStyle(fontWeight: FontWeight.bold),
                ),
                if (isPendingFx)
                  IconButton(
                    tooltip: '外币清算',
                    icon: const Icon(Icons.currency_exchange),
                    onPressed: () => _showSettleFxDialog(tx),
                  ),
                IconButton(
                  tooltip: '删除流水',
                  icon: const Icon(Icons.delete_outline),
                  onPressed: () {
                    engine.deleteTransaction(h['id'] as String);
                    setState(() {});
                  },
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildVouchersTab(FlutterLedgerEngine engine) {
    return Scaffold(
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _showBuyVoucherDialog,
        icon: const Icon(Icons.add),
        label: const Text('买券/添券'),
      ),
      body: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: engine.vouchers.length,
        itemBuilder: (ctx, i) {
          final v = engine.vouchers[i];
          return Card(
            child: ListTile(
              title: Text(v['title'] as String),
              subtitle: Text(
                '${v['voucher_type']} · 面额 ¥${v['face_value']} · 成本 ¥${v['acquire_cost']} · 状态 ${v['status']}',
              ),
              trailing: IconButton(
                icon: const Icon(Icons.delete_outline),
                onPressed: () {
                  engine.deleteVoucher(v['id'] as int);
                  setState(() {});
                },
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildAssetsAndSyncTab(
    FlutterLedgerEngine engine,
    List<Map<String, dynamic>> assets,
  ) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: <Widget>[
        Card(
          child: ListTile(
            leading: const Icon(Icons.memory),
            title: const Text('Rust FFI Core Engine 状态正常'),
            subtitle: Text(
              'HLC 节点: ${engine.hlc.nodeId} · 本地 OpLog 条数: ${engine.syncOplog.length}',
            ),
          ),
        ),
        const SizedBox(height: 12),
        for (final asset in assets)
          Card(
            child: ListTile(
              title: Text(asset['asset_name'] as String),
              subtitle: Text(
                '购于 ${asset['purchase_date']} · 已持有 ${asset['days_held']} 天 · 目标 ¥${asset['target_daily_cost']}/天',
              ),
              trailing: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.end,
                children: <Widget>[
                  Text(
                    '¥${asset['current_daily_cost']}/天',
                    style: const TextStyle(fontWeight: FontWeight.bold),
                  ),
                  if (asset['status'] == 'IN_USE')
                    Text(
                      '${RustCoreBridge.instance().formatCny(asset['net_cost'] as Object)} 元净成本',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}
