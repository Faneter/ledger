import 'package:material_ui/material_ui.dart';

import 'ledger_engine.dart';
import 'ui_helpers.dart';
import 'wallet/add_rule_dialog.dart';
import 'wallet/buy_voucher_dialog.dart';
import 'widgets/common_ui.dart';

export 'wallet/buy_voucher_dialog.dart' show BuyVoucherDialog;

class WalletAndEngineTab extends StatefulWidget {
  const WalletAndEngineTab({
    super.key,
    required this.engine,
    required this.onPullSync,
    required this.onEngineChanged,
  });

  final FlutterLedgerEngine engine;
  final Future<void> Function() onPullSync;
  final VoidCallback onEngineChanged;

  @override
  State<WalletAndEngineTab> createState() => _WalletAndEngineTabState();
}

class _WalletAndEngineTabState extends State<WalletAndEngineTab> {
  String _voucherFilter = 'ALL'; // ALL | AVAILABLE | USED

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
    final res = await showDialog<AddRuleResult>(
      context: context,
      builder: (_) => AddRuleDialog(budgetPools: widget.engine.budgetPools),
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

    return RefreshIndicator(
      onRefresh: widget.onPullSync,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 96),
        children: <Widget>[
          // 1. Virtual Voucher Wallet (Horizontal Slider Cards)
          LedgerSectionHeader(
            title: '虚拟优惠券卡包 (${filteredVouchers.length})',
            trailing: FilledButton.tonalIcon(
              onPressed: _showBuyVoucherDialog,
              icon: const Icon(Icons.add, size: 18),
              label: const Text('买券/添券'),
            ),
          ),
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
            const LedgerEmptyStateCard(
              title: '暂无符合条件的卡券，点击右上角「买券/添券」入库',
              padding: EdgeInsets.all(24),
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
          LedgerSectionHeader(
            title: '周期性扣款规则 (${engine.recurringRules.length})',
            bottomPadding: 6,
            trailing: TextButton.icon(
              onPressed: _showAddRuleDialog,
              icon: const Icon(Icons.add, size: 18),
              label: const Text('新增规则'),
            ),
          ),
          if (engine.recurringRules.isEmpty)
            const LedgerEmptyStateCard(
              title: '暂无周期性扣款规则，点击右上角「新增规则」创建',
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
                              style:
                                  const TextStyle(fontWeight: FontWeight.w700),
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
                  LedgerBadge(
                    label: isPaid ? '有偿立减金' : '免费券',
                    backgroundColor: cs.surface.withValues(alpha: 0.7),
                    foregroundColor: cs.onSurface,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 7,
                      vertical: 2,
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
