import 'package:material_ui/material_ui.dart';

import '../ledger_engine.dart';
import '../ui_helpers.dart';
import '../widgets/common_ui.dart';

/// Expandable timeline transaction card with swipe-to-delete and child split-item rebinding.
class TransactionCard extends StatelessWidget {
  const TransactionCard({
    super.key,
    required this.engine,
    required this.tx,
    required this.isExpanded,
    required this.onToggleExpand,
    required this.onDelete,
    required this.onEdit,
    required this.onSettleFx,
    required this.onRebindItem,
  });

  final FlutterLedgerEngine engine;
  final Map<String, dynamic> tx;
  final bool isExpanded;
  final VoidCallback onToggleExpand;
  final VoidCallback onDelete;
  final VoidCallback onEdit;
  final VoidCallback onSettleFx;
  final Future<void> Function(int index, Map<String, dynamic> item) onRebindItem;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final h = tx['header'] as Map<String, dynamic>;
    final txId = h['id'] as String;
    final items = (tx['items'] as List<dynamic>).cast<Map<String, dynamic>>();
    final isPendingFx = h['settlement_status'] == 'PENDING_HOLD';
    final isIncome = h['tx_type'] == 'INCOME';
    final hasDiscount =
        (double.tryParse((h['payment_discount'] as String?) ?? '0') ?? 0) > 0;
    final hasVoucher = h['applied_voucher_id'] != null;

    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Dismissible(
        key: ValueKey<String>('tx_dismiss_$txId'),
        direction: DismissDirection.endToStart,
        background: Container(
          alignment: Alignment.centerRight,
          padding: const EdgeInsets.only(right: 20),
          decoration: BoxDecoration(
            color: cs.errorContainer,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Icon(Icons.delete_outline, color: cs.onErrorContainer),
        ),
        onDismissed: (_) => onDelete(),
        child: Card(
          margin: EdgeInsets.zero,
          child: InkWell(
            borderRadius: BorderRadius.circular(12),
            onTap: onToggleExpand,
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            Text(
                              h['merchant_or_note'] as String,
                              style: const TextStyle(
                                fontWeight: FontWeight.w700,
                                fontSize: 15,
                              ),
                            ),
                            const SizedBox(height: 3),
                            Text(
                              '${h['tx_date']} · ${h['tx_type']} · 原价 ¥${h['total_gross']}'
                              '${isPendingFx ? ' · 待清算(冻结¥${h['hold_amount_cny']})' : ''}',
                              style: Theme.of(context)
                                  .textTheme
                                  .bodySmall
                                  ?.copyWith(color: cs.onSurfaceVariant),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 8),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: <Widget>[
                          Text(
                            isIncome
                                ? '+¥${h['total_net']}'
                                : '¥${h['total_net']}',
                            style: TextStyle(
                              fontWeight: FontWeight.bold,
                              fontSize: 16,
                              color: isIncome ? Colors.green.shade700 : null,
                            ),
                          ),
                          if (hasDiscount)
                            Text(
                              '省 ¥${h['payment_discount']}',
                              style: TextStyle(
                                fontSize: 11,
                                color: Colors.green.shade700,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                        ],
                      ),
                      if (isPendingFx)
                        IconButton(
                          tooltip: '外币清算',
                          icon: const Icon(Icons.currency_exchange, size: 20),
                          onPressed: onSettleFx,
                        ),
                      IconButton(
                        tooltip: '删除流水',
                        icon: const Icon(Icons.delete_outline, size: 20),
                        onPressed: onDelete,
                      ),
                    ],
                  ),

                  // Collapsed allocation pills (parent-child capsule summary)
                  if (items.isNotEmpty || hasVoucher) ...<Widget>[
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: <Widget>[
                        if (hasVoucher)
                          LedgerBadge(
                            label: '🎟️ 已核销立减金',
                            backgroundColor:
                                Colors.green.withValues(alpha: 0.14),
                            foregroundColor: Colors.green.shade900,
                            fontSize: 11,
                            padding: const EdgeInsets.symmetric(
                              horizontal: 8,
                              vertical: 3,
                            ),
                          ),
                        if (items.length > 1)
                          for (final it in items)
                            LedgerBadge(
                              label: '${it['item_name']} ¥${it['item_net']}',
                              backgroundColor:
                                  cs.secondaryContainer.withValues(alpha: 0.7),
                              foregroundColor: cs.onSecondaryContainer,
                              fontSize: 11,
                              padding: const EdgeInsets.symmetric(
                                horizontal: 8,
                                vertical: 3,
                              ),
                            )
                        else if (items.length == 1)
                          LedgerBadge(
                            label: items[0]['project_tag_id'] != null
                                ? '🎯 #${projectTagNameById(engine, items[0]['project_tag_id'] as String?)}'
                                : '💰 ${poolNameById(engine, items[0]['budget_pool_id'] as String?)}',
                            backgroundColor: cs.surfaceContainerHighest,
                            foregroundColor: cs.onSurfaceVariant,
                            fontSize: 11,
                            padding: const EdgeInsets.symmetric(
                              horizontal: 8,
                              vertical: 3,
                            ),
                          ),
                      ],
                    ),
                  ],

                  // In-place Expanded Split Details Drawer
                  if (isExpanded) ...<Widget>[
                    const Divider(height: 20),
                    if (h['raw_input_text'] != null &&
                        h['raw_input_text'] != h['merchant_or_note']) ...<Widget>[
                      Text(
                        '❯_ ${h['raw_input_text']}',
                        style: TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 11,
                          color: cs.onSurfaceVariant,
                        ),
                      ),
                      const SizedBox(height: 8),
                    ],
                    for (var i = 0; i < items.length; i++)
                      _buildExpandedChildRow(context, i, items[i]),
                    const SizedBox(height: 6),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: <Widget>[
                        TextButton.icon(
                          onPressed: onEdit,
                          icon: const Icon(Icons.edit_outlined, size: 16),
                          label: const Text('编辑主账单'),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildExpandedChildRow(
    BuildContext context,
    int index,
    Map<String, dynamic> it,
  ) {
    final cs = Theme.of(context).colorScheme;
    final poolId = it['budget_pool_id'] as String?;
    final tagId = it['project_tag_id'] as String?;
    final tagName = projectTagNameById(engine, tagId);
    final label = tagName != null
        ? '🎯 #$tagName'
        : '💰 ${poolNameById(engine, poolId)}';

    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: cs.surfaceContainerHighest.withValues(alpha: 0.4),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  '${it['item_name']}${it['is_primary_item'] == true ? ' (★ 主商品)' : ''}',
                  style: const TextStyle(
                    fontWeight: FontWeight.w600,
                    fontSize: 13,
                  ),
                ),
                Text(
                  '原价 ¥${it['item_gross']} · 分摊省 ¥${it['allocated_discount']} · 净 ¥${it['item_net']}',
                  style: TextStyle(fontSize: 11, color: cs.onSurfaceVariant),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          InkWell(
            borderRadius: BorderRadius.circular(999),
            onTap: () => onRebindItem(index, it),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
              decoration: BoxDecoration(
                color: cs.primaryContainer,
                borderRadius: BorderRadius.circular(999),
              ),
              child: Text(
                '$label ▾',
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  color: cs.onPrimaryContainer,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
