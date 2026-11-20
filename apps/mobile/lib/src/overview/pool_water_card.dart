import 'package:material_ui/material_ui.dart';

import '../ledger_engine.dart';
import '../ui_helpers.dart';
import '../widgets/common_ui.dart';

/// Banner highlighting foreign-currency transactions waiting for bank settlement.
class PendingFxBanner extends StatelessWidget {
  const PendingFxBanner({
    super.key,
    required this.pendingFxTxs,
    required this.onSettleFx,
  });

  final List<Map<String, dynamic>> pendingFxTxs;
  final Future<void> Function(Map<String, dynamic> tx) onSettleFx;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.orange.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: Colors.orange.shade400),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Icon(
                Icons.hourglass_top_rounded,
                size: 18,
                color: Colors.orange.shade800,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  '有 ${pendingFxTxs.length} 笔外币待清算（点击快速输入银行实付解冻）',
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 13,
                    color: Colors.orange.shade900,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          for (final tx in pendingFxTxs)
            Builder(
              builder: (ctx) {
                final h = tx['header'] as Map<String, dynamic>;
                return Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Row(
                    children: <Widget>[
                      Expanded(
                        child: Text(
                          '${h['merchant_or_note']} · ${h['original_currency']} ${h['original_amount']} (冻结 ¥${h['hold_amount_cny']})',
                          style: const TextStyle(fontSize: 12),
                        ),
                      ),
                      const SizedBox(width: 8),
                      FilledButton.tonalIcon(
                        onPressed: () => onSettleFx(tx),
                        icon: const Icon(Icons.currency_exchange, size: 15),
                        label: const Text('清算'),
                      ),
                    ],
                  ),
                );
              },
            ),
        ],
      ),
    );
  }
}

/// Monthly budget pool water-level status card with accessible progress bar.
class PoolWaterCard extends StatelessWidget {
  const PoolWaterCard({
    super.key,
    required this.engine,
    required this.pool,
    required this.remainingDays,
    required this.onTap,
  });

  final FlutterLedgerEngine engine;
  final Map<String, dynamic> pool;
  final int remainingDays;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final poolId = pool['pool_id'] as String;
    final defList =
        engine.budgetPools.where((p) => p['id'] == poolId).toList();
    final def = defList.isNotEmpty ? defList.first : null;
    final rollover = def?['rollover_strategy'] == 'RESET' ? '清零' : '滚存';

    final avail =
        double.tryParse(pool['total_available_budget'] as String) ?? 0;
    final spent = double.tryParse(pool['spent_net'] as String) ?? 0;
    final remaining = double.tryParse(pool['remaining_budget'] as String) ?? 0;
    final progress = avail > 0 ? (spent / avail).clamp(0.0, 1.0) : 0.0;
    final statusColor = poolHealthColor(
      context,
      remaining: remaining,
      totalAvailable: avail,
    );
    final perDay =
        ((remaining > 0 ? remaining : 0.0) / remainingDays).toStringAsFixed(2);

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(
                children: <Widget>[
                  Expanded(
                    child: Row(
                      children: <Widget>[
                        Flexible(
                          child: Text(
                            pool['pool_name'] as String,
                            style: const TextStyle(
                              fontWeight: FontWeight.w700,
                              fontSize: 15,
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        const SizedBox(width: 6),
                        LedgerBadge(
                          label: rollover,
                          backgroundColor: cs.surfaceContainerHighest,
                          foregroundColor: cs.onSurfaceVariant,
                          fontWeight: FontWeight.normal,
                          padding: const EdgeInsets.symmetric(
                            horizontal: 6,
                            vertical: 1,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Text(
                    '¥${pool['remaining_budget']}',
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.bold,
                          color: statusColor,
                        ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              AccessibleProgressBar(
                label: '${pool['pool_name']} 预算已用比例',
                value: progress,
                color: statusColor,
                backgroundColor: cs.surfaceContainerHighest,
              ),
              const SizedBox(height: 8),
              Text(
                '可用 ¥${pool['total_available_budget']} · 日均 ¥$perDay/天 · 已用 ¥${pool['spent_net']} · 优惠 ¥${pool['total_saved_discount']}',
                style: Theme.of(context)
                    .textTheme
                    .bodySmall
                    ?.copyWith(color: cs.onSurfaceVariant),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
