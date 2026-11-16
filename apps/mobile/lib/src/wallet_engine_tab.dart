// ignore: deprecated_member_use
import 'package:flutter/material.dart';

import 'ledger_engine.dart';
import 'ui_helpers.dart';

class WalletAndEngineTab extends StatefulWidget {
  const WalletAndEngineTab({
    super.key,
    required this.engine,
    required this.selectedMonth,
    required this.onMonthChanged,
    required this.onOpenSyncDialog,
    required this.onPullSync,
    required this.onEngineChanged,
  });

  final FlutterLedgerEngine engine;
  final String selectedMonth;
  final ValueChanged<String> onMonthChanged;
  final VoidCallback onOpenSyncDialog;
  final Future<void> Function() onPullSync;
  final VoidCallback onEngineChanged;

  @override
  State<WalletAndEngineTab> createState() => _WalletAndEngineTabState();
}

class _WalletAndEngineTabState extends State<WalletAndEngineTab> {
  String _voucherFilter = 'ALL'; // ALL | AVAILABLE | USED
  late final TextEditingController _holdPctCtrl;
  late final TextEditingController _cashbackPctCtrl;

  @override
  void initState() {
    super.initState();
    _holdPctCtrl = TextEditingController();
    _cashbackPctCtrl = TextEditingController();
    _syncFxControllers();
  }

  void _syncFxControllers() {
    _holdPctCtrl.text = decimalRateToPercentText(
      widget.engine.settings['fx_default_hold_ratio'] ?? '1.020',
      decimals: 1,
    );
    _cashbackPctCtrl.text = decimalRateToPercentText(
      widget.engine.settings['fx_default_cashback_rate'] ?? '0.0100',
    );
  }

  @override
  void dispose() {
    _holdPctCtrl.dispose();
    _cashbackPctCtrl.dispose();
    super.dispose();
  }

  static String _nextYearMonth(String ym) {
    final parts = ym.split('-');
    if (parts.length != 2) return ym;
    var y = int.tryParse(parts[0]) ?? 2026;
    var m = int.tryParse(parts[1]) ?? 11;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    return '${y.toString().padLeft(4, '0')}-${m.toString().padLeft(2, '0')}';
  }

  Future<void> _showBuyVoucherDialog() async {
    final result = await showDialog<Map<String, String>>(
      context: context,
      builder: (ctx) => const BuyVoucherDialog(),
    );
    if (result == null || !mounted) return;
    try {
      widget.engine.upsertVoucher(
        title: result['title']?.isNotEmpty == true ? result['title'] : null,
        voucherType: result['voucherType']!,
        faceValue: result['faceValue']!,
        acquireCost: result['acquireCost']!,
        minSpend: result['minSpend']!,
      );
      widget.onEngineChanged();
      showLedgerSnackBar(context, '卡券已入库');
    } catch (e) {
      showLedgerSnackBar(context, '入库失败: $e', isError: true);
    }
  }

  Future<void> _showAddRuleDialog() async {
    final res = await showDialog<_AddRuleResult>(
      context: context,
      builder: (_) => _AddRuleDialog(budgetPools: widget.engine.budgetPools),
    );
    if (res == null || !mounted) return;
    try {
      widget.engine.upsertRecurringRule(
        title: res.title,
        cronCycle: res.cronCycle,
        triggerDay: res.triggerDay,
        currency: res.currency,
        amount: res.amount,
        budgetPoolId: res.budgetPoolId,
      );
      widget.onEngineChanged();
      showLedgerSnackBar(context, '已新增周期规则【${res.title}】');
    } catch (e) {
      showLedgerSnackBar(context, '保存规则失败: $e', isError: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final engine = widget.engine;
    final filteredVouchers = _voucherFilter == 'ALL'
        ? engine.vouchers
        : engine.vouchers.where((v) => v['status'] == _voucherFilter).toList();
    final nextMonth = _nextYearMonth(widget.selectedMonth);

    return RefreshIndicator(
      onRefresh: widget.onPullSync,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 96),
        children: <Widget>[
          // 1. Virtual Voucher Wallet (Horizontal Slider Cards)
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  '虚拟优惠券卡包 (${filteredVouchers.length})',
                  style: Theme.of(context)
                      .textTheme
                      .titleMedium
                      ?.copyWith(fontWeight: FontWeight.bold),
                ),
              ),
              FilledButton.tonalIcon(
                onPressed: _showBuyVoucherDialog,
                icon: const Icon(Icons.add, size: 18),
                label: const Text('买券/添券'),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            children: <Widget>[
              for (final opt in const <(String, String)>[
                ('ALL', '全部'),
                ('AVAILABLE', '待核销'),
                ('USED', '已使用'),
              ])
                FilterChip(
                  visualDensity: VisualDensity.compact,
                  label: Text(opt.$2),
                  selected: _voucherFilter == opt.$1,
                  onSelected: (_) => setState(() => _voucherFilter = opt.$1),
                ),
            ],
          ),
          const SizedBox(height: 10),

          if (filteredVouchers.isEmpty)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Center(
                  child: Text(
                    '暂无符合条件的卡券，点击右上角「买券/添券」入库',
                    style: TextStyle(color: cs.onSurfaceVariant),
                  ),
                ),
              ),
            )
          else
            SizedBox(
              height: 176,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: filteredVouchers.length,
                separatorBuilder: (_, __) => const SizedBox(width: 10),
                itemBuilder: (ctx, i) =>
                    _buildVoucherDeckCard(ctx, filteredVouchers[i]),
              ),
            ),

          const SizedBox(height: 20),

          // 2. Recurring Rules
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  '周期性扣款规则 (${engine.recurringRules.length})',
                  style: Theme.of(context)
                      .textTheme
                      .titleMedium
                      ?.copyWith(fontWeight: FontWeight.bold),
                ),
              ),
              TextButton.icon(
                onPressed: _showAddRuleDialog,
                icon: const Icon(Icons.add, size: 18),
                label: const Text('新增规则'),
              ),
            ],
          ),
          const SizedBox(height: 6),
          if (engine.recurringRules.isEmpty)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Center(
                  child: Text(
                    '暂无周期性扣款规则，点击右上角「新增规则」创建',
                    style: TextStyle(color: cs.onSurfaceVariant),
                  ),
                ),
              ),
            )
          else
            for (final rule in engine.recurringRules)
            Card(
              margin: const EdgeInsets.only(bottom: 8),
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Row(
                      children: <Widget>[
                        Expanded(
                          child: Text(
                            rule['title'] as String,
                            style: const TextStyle(fontWeight: FontWeight.w700),
                          ),
                        ),
                        Text(
                          '${rule['currency']} ${rule['amount']}',
                          style: TextStyle(
                            fontWeight: FontWeight.bold,
                            color: cs.primary,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '${rule['cron_cycle'] == 'MONTHLY' ? '每月' : '每年'} 第 ${rule['trigger_day']} 日 · 归属 ${poolNameById(engine, rule['budget_pool_id'] as String?)}',
                      style: Theme.of(context)
                          .textTheme
                          .bodySmall
                          ?.copyWith(color: cs.onSurfaceVariant),
                    ),
                    const SizedBox(height: 8),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: <Widget>[
                        IconButton(
                          tooltip: '删除规则',
                          icon: const Icon(Icons.delete_outline, size: 19),
                          onPressed: () {
                            engine.deleteRecurringRule(rule['id'] as int);
                            widget.onEngineChanged();
                          },
                        ),
                        const SizedBox(width: 4),
                        FilledButton.tonalIcon(
                          onPressed: () {
                            final tx =
                                engine.executeRecurringRule(rule['id'] as int);
                            final h = tx['header'] as Map<String, dynamic>;
                            widget.onEngineChanged();
                            showLedgerSnackBar(
                              context,
                              '周期账单已入账: ${h['merchant_or_note']} ¥${h['total_net']}',
                            );
                          },
                          icon: const Icon(Icons.bolt_rounded, size: 16),
                          label: const Text('立即入账'),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),

          const SizedBox(height: 16),

          // 3. Global FX Rules & Month-End Rollover
          Text(
            '外币参数与跨月滚存',
            style: Theme.of(context)
                .textTheme
                .titleMedium
                ?.copyWith(fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 8),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  Row(
                    children: <Widget>[
                      Expanded(
                        child: TextField(
                          controller: _holdPctCtrl,
                          keyboardType: const TextInputType.numberWithOptions(
                            decimal: true,
                          ),
                          decoration: const InputDecoration(
                            labelText: '默认冻结比例 (%)',
                            suffixText: '%',
                            border: OutlineInputBorder(),
                            isDense: true,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: TextField(
                          controller: _cashbackPctCtrl,
                          keyboardType: const TextInputType.numberWithOptions(
                            decimal: true,
                          ),
                          decoration: const InputDecoration(
                            labelText: '默认返现比例 (%)',
                            suffixText: '%',
                            border: OutlineInputBorder(),
                            isDense: true,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      FilledButton.tonal(
                        onPressed: () {
                          final holdPct =
                              double.tryParse(_holdPctCtrl.text.trim()) ??
                                  102.0;
                          final cbPct =
                              double.tryParse(_cashbackPctCtrl.text.trim()) ??
                                  1.0;
                          engine.updateFxSettings(
                            defaultHoldRatio:
                                (holdPct / 100).toStringAsFixed(3),
                            defaultCashbackRate:
                                (cbPct / 100).toStringAsFixed(4),
                          );
                          widget.onEngineChanged();
                          showLedgerSnackBar(context, '外币默认规则已更新');
                        },
                        child: const Text('保存'),
                      ),
                    ],
                  ),
                  const Divider(height: 20),
                  Row(
                    children: <Widget>[
                      Expanded(
                        child: Text(
                          '跨月结余滚存：${widget.selectedMonth} → $nextMonth',
                          style: const TextStyle(fontWeight: FontWeight.w600),
                        ),
                      ),
                      FilledButton.icon(
                        onPressed: () {
                          engine.executeMonthRollover(
                            widget.selectedMonth,
                            nextMonth,
                          );
                          widget.onMonthChanged(nextMonth);
                          widget.onEngineChanged();
                          showLedgerSnackBar(
                            context,
                            '已将 ${widget.selectedMonth} 结余滚存至 $nextMonth',
                          );
                        },
                        icon: const Icon(Icons.fast_forward_rounded, size: 16),
                        label: const Text('一键滚存'),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),

          const SizedBox(height: 16),

          // 4. Rust Core Engine & Sync Entry Card
          Card(
            child: ListTile(
              leading: const Icon(Icons.memory),
              title: const Text('Rust FFI Core Engine 状态正常'),
              subtitle: Text(
                'HLC 节点: ${engine.hlc.nodeId} · 本地 OpLog 条数: ${engine.syncOplog.length}',
              ),
              trailing: TextButton(
                onPressed: widget.onOpenSyncDialog,
                child: const Text('同步/冲突'),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildVoucherDeckCard(BuildContext context, Map<String, dynamic> v) {
    final cs = Theme.of(context).colorScheme;
    final isAvailable = v['status'] == 'AVAILABLE';
    final isPaid = v['voucher_type'] == 'PREPAID_COUPON';
    final face = double.tryParse((v['face_value'] as String?) ?? '0') ?? 0;
    final cost = double.tryParse((v['acquire_cost'] as String?) ?? '0') ?? 0;
    final netSaved = (face - cost) > 0 ? (face - cost).toStringAsFixed(2) : '0.00';

    return SizedBox(
      width: 248,
      child: Card(
        margin: EdgeInsets.zero,
        color: isAvailable
            ? (isPaid ? cs.primaryContainer : cs.secondaryContainer)
            : cs.surfaceContainerHighest.withValues(alpha: 0.6),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(
                children: <Widget>[
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 7,
                      vertical: 2,
                    ),
                    decoration: BoxDecoration(
                      color: cs.surface.withValues(alpha: 0.7),
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(
                      isPaid ? '有偿立减金' : '免费券',
                      style: const TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  const SizedBox(width: 6),
                  Text(
                    isAvailable ? '可用' : '${v['status']}',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                      color: isAvailable
                          ? Colors.green.shade800
                          : cs.onSurfaceVariant,
                    ),
                  ),
                  const Spacer(),
                  InkWell(
                    onTap: () {
                      widget.engine.deleteVoucher(v['id'] as int);
                      widget.onEngineChanged();
                    },
                    child: const Icon(Icons.delete_outline, size: 18),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                v['title'] as String,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontWeight: FontWeight.bold,
                  fontSize: 14,
                ),
              ),
              const Spacer(),
              Row(
                crossAxisAlignment: CrossAxisAlignment.baseline,
                textBaseline: TextBaseline.alphabetic,
                children: <Widget>[
                  Text(
                    '¥${v['face_value']}',
                    style: TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w800,
                      color: cs.primary,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      '净省 ¥$netSaved',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        color: Colors.green.shade800,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              Text(
                '购券成本 ¥${v['acquire_cost']} · 满 ¥${v['min_spend']} 可用',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 11, color: cs.onSurfaceVariant),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AddRuleResult {
  const _AddRuleResult({
    required this.title,
    required this.cronCycle,
    required this.triggerDay,
    required this.currency,
    required this.amount,
    required this.budgetPoolId,
  });

  final String title;
  final String cronCycle;
  final int triggerDay;
  final String currency;
  final String amount;
  final String? budgetPoolId;
}

class _AddRuleDialog extends StatefulWidget {
  const _AddRuleDialog({required this.budgetPools});

  final List<Map<String, dynamic>> budgetPools;

  @override
  State<_AddRuleDialog> createState() => _AddRuleDialogState();
}

class _AddRuleDialogState extends State<_AddRuleDialog> {
  final _titleCtrl = TextEditingController();
  final _amtCtrl = TextEditingController(text: '20.00');
  final _dayCtrl = TextEditingController(text: '1');
  String _cycle = 'MONTHLY';
  String _currency = 'CNY';
  String? _poolId;
  String? _error;

  @override
  void initState() {
    super.initState();
    final ids = widget.budgetPools.map((p) => p['id'] as String).toList();
    _poolId = ids.contains('POOL_FIXED')
        ? 'POOL_FIXED'
        : (ids.isNotEmpty ? ids.first : null);
  }

  @override
  void dispose() {
    _titleCtrl.dispose();
    _amtCtrl.dispose();
    _dayCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('新增周期性扣款规则'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            TextField(
              controller: _titleCtrl,
              decoration: const InputDecoration(
                labelText: '规则名称（如 校园宽带 / iCloud）',
                border: OutlineInputBorder(),
              ),
              onChanged: (_) {
                if (_error != null) setState(() => _error = null);
              },
            ),
            const SizedBox(height: 10),
            Row(
              children: <Widget>[
                Expanded(
                  flex: 2,
                  child: TextField(
                    controller: _amtCtrl,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    decoration: const InputDecoration(
                      labelText: '金额',
                      border: OutlineInputBorder(),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: DropdownButtonFormField<String>(
                    key: ValueKey<String>(_currency),
                    initialValue: _currency,
                    isExpanded: true,
                    decoration: const InputDecoration(
                      labelText: '币种',
                      border: OutlineInputBorder(),
                    ),
                    items: const <DropdownMenuItem<String>>[
                      DropdownMenuItem(value: 'CNY', child: Text('CNY')),
                      DropdownMenuItem(value: 'USD', child: Text('USD')),
                      DropdownMenuItem(value: 'JPY', child: Text('JPY')),
                      DropdownMenuItem(value: 'EUR', child: Text('EUR')),
                    ],
                    onChanged: (v) {
                      if (v != null) setState(() => _currency = v);
                    },
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              children: <Widget>[
                Expanded(
                  child: DropdownButtonFormField<String>(
                    key: ValueKey<String>(_cycle),
                    initialValue: _cycle,
                    isExpanded: true,
                    decoration: const InputDecoration(
                      labelText: '周期',
                      border: OutlineInputBorder(),
                    ),
                    items: const <DropdownMenuItem<String>>[
                      DropdownMenuItem(value: 'MONTHLY', child: Text('每月')),
                      DropdownMenuItem(value: 'YEARLY', child: Text('每年')),
                    ],
                    onChanged: (v) {
                      if (v != null) setState(() => _cycle = v);
                    },
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    controller: _dayCtrl,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                      labelText: '触发日 (1-31)',
                      border: OutlineInputBorder(),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            DropdownButtonFormField<String?>(
              key: ValueKey<String?>(_poolId),
              initialValue: _poolId,
              isExpanded: true,
              decoration: const InputDecoration(
                labelText: '关联资金池',
                border: OutlineInputBorder(),
              ),
              items: <DropdownMenuItem<String?>>[
                const DropdownMenuItem<String?>(
                  value: null,
                  child: Text('暂不绑定预算池'),
                ),
                ...widget.budgetPools.map(
                  (p) => DropdownMenuItem<String?>(
                    value: p['id'] as String,
                    child: Text(
                      p['name'] as String,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ),
              ],
              onChanged: (v) => setState(() => _poolId = v),
            ),
            if (_error != null) ...<Widget>[
              const SizedBox(height: 8),
              Text(
                _error!,
                style: TextStyle(
                  color: Theme.of(context).colorScheme.error,
                  fontSize: 12,
                ),
              ),
            ],
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
            final title = _titleCtrl.text.trim();
            if (title.isEmpty) {
              setState(() => _error = '请输入规则名称');
              return;
            }
            if ((double.tryParse(_amtCtrl.text.trim()) ?? 0) <= 0) {
              setState(() => _error = '请输入大于 0 的有效金额');
              return;
            }
            Navigator.of(context).pop(
              _AddRuleResult(
                title: title,
                cronCycle: _cycle,
                triggerDay: (int.tryParse(_dayCtrl.text.trim()) ?? 1)
                    .clamp(1, 31),
                currency: _currency,
                amount: _amtCtrl.text.trim(),
                budgetPoolId: _poolId,
              ),
            );
          },
          child: const Text('保存规则'),
        ),
      ],
    );
  }
}

class BuyVoucherDialog extends StatefulWidget {
  const BuyVoucherDialog({super.key});

  @override
  State<BuyVoucherDialog> createState() => _BuyVoucherDialogState();
}

class _BuyVoucherDialogState extends State<BuyVoucherDialog> {
  late final TextEditingController _titleCtrl;
  late final TextEditingController _faceCtrl;
  late final TextEditingController _costCtrl;
  late final TextEditingController _minCtrl;
  String _voucherType = 'PREPAID_COUPON';

  @override
  void initState() {
    super.initState();
    _titleCtrl = TextEditingController();
    _faceCtrl = TextEditingController(text: '15.00');
    _costCtrl = TextEditingController(text: '8.90');
    _minCtrl = TextEditingController(text: '20.00');
  }

  @override
  void dispose() {
    _titleCtrl.dispose();
    _faceCtrl.dispose();
    _costCtrl.dispose();
    _minCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('购买 / 新增卡券'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            DropdownButtonFormField<String>(
              key: ValueKey<String>(_voucherType),
              initialValue: _voucherType,
              isExpanded: true,
              decoration: const InputDecoration(labelText: '卡券类型'),
              items: const <DropdownMenuItem<String>>[
                DropdownMenuItem<String>(
                  value: 'PREPAID_COUPON',
                  child: Text(
                    '有偿购入立减金 (成本核销结转)',
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                DropdownMenuItem<String>(
                  value: 'FREE_COUPON',
                  child: Text('免费领券'),
                ),
              ],
              onChanged: (v) {
                if (v != null) {
                  setState(() {
                    _voucherType = v;
                    if (v == 'FREE_COUPON') {
                      _costCtrl.text = '0.00';
                    }
                  });
                }
              },
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _titleCtrl,
              decoration: const InputDecoration(
                labelText: '名称/前缀 (选填，留空自动生成)',
              ),
            ),
            TextField(
              controller: _faceCtrl,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: '面额 (CNY)'),
            ),
            TextField(
              controller: _costCtrl,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: '购券成本 (CNY)'),
            ),
            TextField(
              controller: _minCtrl,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: '使用门槛 (CNY)'),
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
          onPressed: () => Navigator.of(context).pop(<String, String>{
            'title': _titleCtrl.text.trim(),
            'voucherType': _voucherType,
            'faceValue': _faceCtrl.text.trim(),
            'acquireCost': _costCtrl.text.trim(),
            'minSpend': _minCtrl.text.trim(),
          }),
          child: const Text('入库'),
        ),
      ],
    );
  }
}
