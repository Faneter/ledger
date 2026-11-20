import 'package:material_ui/material_ui.dart';

import '../ledger_engine.dart';
import '../ui_helpers.dart';
import '../widgets/common_ui.dart';

/// Displays eligible voucher chips, FX pre-auth warning, and live split preview sandbox.
class DslSplitPreviewSection extends StatelessWidget {
  const DslSplitPreviewSection({
    super.key,
    required this.engine,
    required this.preview,
    required this.availableVouchers,
    required this.selectedVoucherId,
    required this.onSelectVoucher,
    required this.onTogglePrimaryItem,
    required this.onPickItemTarget,
  });

  final FlutterLedgerEngine engine;
  final Map<String, dynamic>? preview;
  final List<Map<String, dynamic>> availableVouchers;
  final int? selectedVoucherId;
  final ValueChanged<int?> onSelectVoucher;
  final ValueChanged<int> onTogglePrimaryItem;
  final Future<void> Function(int index, Map<String, dynamic> item)
      onPickItemTarget;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final parsed = preview?['parsed'] as Map<String, dynamic>?;
    final parsedItems = parsed != null
        ? (parsed['items'] as List<dynamic>)
            .map((e) => Map<String, dynamic>.from(e as Map<dynamic, dynamic>))
            .toList()
        : <Map<String, dynamic>>[];
    final eligibleVouchers = preview != null
        ? (preview!['eligible_vouchers'] as List<dynamic>)
            .map((e) => Map<String, dynamic>.from(e as Map<dynamic, dynamic>))
            .toList()
        : <Map<String, dynamic>>[];
    final voucherError = preview?['voucher_error'] as String?;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        // Smart Voucher Chips (only shown when eligible vouchers exist)
        if (eligibleVouchers.isNotEmpty) ...<Widget>[
          const SizedBox(height: 10),
          Text(
            '可用卡券智能挂载',
            style: Theme.of(context)
                .textTheme
                .labelMedium
                ?.copyWith(color: cs.primary, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 6),
          Wrap(
            spacing: 8,
            runSpacing: 6,
            children: <Widget>[
              for (final v in eligibleVouchers)
                FilterChip(
                  selected: selectedVoucherId == v['id'],
                  selectedColor: cs.primaryContainer,
                  label: Text(
                    '🎟️ 可用：${v['title']} (净省 ¥${v['net_savings']})',
                    style: const TextStyle(fontSize: 12),
                  ),
                  onSelected: (selected) {
                    onSelectVoucher(selected ? (v['id'] as int) : null);
                  },
                ),
            ],
          ),
        ] else if (availableVouchers.isNotEmpty && parsed != null) ...<Widget>[
          const SizedBox(height: 8),
          Text(
            '卡包有 ${availableVouchers.length} 张可用券，达到使用门槛后将自动亮起挂载芯片',
            style: Theme.of(context)
                .textTheme
                .bodySmall
                ?.copyWith(color: cs.onSurfaceVariant),
          ),
        ],

        if (voucherError != null) ...<Widget>[
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: cs.tertiaryContainer,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(
              voucherError,
              style: TextStyle(color: cs.onTertiaryContainer, fontSize: 12),
            ),
          ),
        ],

        if (preview?['is_fx_detected'] == true) ...<Widget>[
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: BoxDecoration(
              color: Colors.orange.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: Colors.orange.withValues(alpha: 0.4)),
            ),
            child: Row(
              children: <Widget>[
                Icon(
                  Icons.currency_exchange,
                  size: 16,
                  color: Colors.orange.shade800,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    '已识别外币消费 (${parsed?['original_currency']} ${parsed?['original_amount']})，将按预授权冻结 ¥${parsed?['hold_amount_cny']} 挂起待清算',
                    style: TextStyle(
                      fontSize: 12,
                      color: Colors.orange.shade900,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],

        // Live Split Preview Sandbox
        if (parsed != null && parsedItems.isNotEmpty) ...<Widget>[
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: cs.surfaceContainerHighest.withValues(alpha: 0.45),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: cs.outlineVariant),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Row(
                  children: <Widget>[
                    Expanded(
                      child: Wrap(
                        spacing: 6,
                        runSpacing: 4,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: <Widget>[
                          Text(
                            '实时拆单沙盒',
                            style: Theme.of(context)
                                .textTheme
                                .labelLarge
                                ?.copyWith(
                                  fontWeight: FontWeight.bold,
                                  color: cs.primary,
                                ),
                          ),
                          LedgerBadge(
                            label: formatAllocationMode(
                              parsed['allocation_mode'] as String?,
                            ),
                            backgroundColor: cs.secondaryContainer,
                            foregroundColor: cs.onSecondaryContainer,
                            fontSize: 11,
                            padding: const EdgeInsets.symmetric(
                              horizontal: 7,
                              vertical: 2,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      '实付 ¥${parsed['total_net']}',
                      style: Theme.of(context).textTheme.titleSmall?.copyWith(
                            fontWeight: FontWeight.bold,
                            color: cs.primary,
                          ),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  '原价 ¥${parsed['total_gross']} · 优惠 -¥${parsed['payment_discount']} · 点击商品名设 * 主商品，点击池子改绑',
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall
                      ?.copyWith(color: cs.onSurfaceVariant, fontSize: 11),
                ),
                const SizedBox(height: 10),
                for (var i = 0; i < parsedItems.length; i++)
                  _DslPreviewItemTile(
                    engine: engine,
                    index: i,
                    item: parsedItems[i],
                    onTogglePrimary: () {
                      final isPrimary =
                          parsedItems[i]['is_primary_item'] == true;
                      onTogglePrimaryItem(isPrimary ? -1 : i);
                    },
                    onPickTarget: () => onPickItemTarget(i, parsedItems[i]),
                  ),
              ],
            ),
          ),
        ],
      ],
    );
  }
}

class _DslPreviewItemTile extends StatelessWidget {
  const _DslPreviewItemTile({
    required this.engine,
    required this.index,
    required this.item,
    required this.onTogglePrimary,
    required this.onPickTarget,
  });

  final FlutterLedgerEngine engine;
  final int index;
  final Map<String, dynamic> item;
  final VoidCallback onTogglePrimary;
  final VoidCallback onPickTarget;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final isPrimary = item['is_primary_item'] == true;
    final poolId = item['budget_pool_id'] as String?;
    final projectTagId = item['project_tag_id'] as String?;
    final projectTagName = projectTagNameById(engine, projectTagId);
    final poolLabel = projectTagName != null
        ? '🎯 #$projectTagName'
        : '💰 ${poolNameById(engine, poolId)}';
    final allocDiscount = item['allocated_discount'] as String? ?? '0.00';

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: isPrimary
            ? cs.primaryContainer.withValues(alpha: 0.45)
            : cs.surface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: isPrimary ? cs.primary : cs.outlineVariant,
        ),
      ),
      child: Row(
        children: <Widget>[
          Expanded(
            child: InkWell(
              borderRadius: BorderRadius.circular(8),
              onTap: onTogglePrimary,
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Row(
                      children: <Widget>[
                        Flexible(
                          child: Text(
                            item['item_name'] as String,
                            style: const TextStyle(
                              fontWeight: FontWeight.w700,
                              fontSize: 13,
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        const SizedBox(width: 6),
                        LedgerBadge(
                          label: isPrimary ? '★ 主商品' : '设为主商品',
                          backgroundColor: isPrimary
                              ? cs.primary
                              : cs.surfaceContainerHighest,
                          foregroundColor:
                              isPrimary ? cs.onPrimary : cs.onSurfaceVariant,
                          padding: const EdgeInsets.symmetric(
                            horizontal: 6,
                            vertical: 1,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '原价 ¥${item['item_gross']}'
                      '${allocDiscount != '0.00' ? ' · 省 ¥$allocDiscount' : ''}',
                      style: TextStyle(
                        fontSize: 11,
                        color: cs.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(width: 8),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: <Widget>[
              Text(
                '¥${item['item_net']}',
                style: TextStyle(
                  fontWeight: FontWeight.bold,
                  fontSize: 14,
                  color: cs.primary,
                ),
              ),
              const SizedBox(height: 4),
              InkWell(
                borderRadius: BorderRadius.circular(999),
                onTap: onPickTarget,
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: cs.secondaryContainer.withValues(alpha: 0.7),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    '$poolLabel ▾',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: cs.onSecondaryContainer,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
