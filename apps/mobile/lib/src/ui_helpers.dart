// ignore: deprecated_member_use
import 'package:flutter/material.dart';

import 'ledger_engine.dart';

/// Looks up the display name for a budget pool ID.
String poolNameById(FlutterLedgerEngine engine, String? poolId) {
  if (poolId == null || poolId.isEmpty) return '未分配池';
  for (final p in engine.budgetPools) {
    if (p['id'] == poolId) return p['name'] as String;
  }
  return poolId;
}

/// Looks up the display name for a project tag ID.
String? projectTagNameById(FlutterLedgerEngine engine, String? tagId) {
  if (tagId == null || tagId.isEmpty) return null;
  for (final t in engine.projectTags) {
    if (t['id'] == tagId) return t['name'] as String;
  }
  return tagId;
}

/// Maps a budget pool definition to a concise `#tag` accepted by Rust DSL parser.
String dslTagForPool(Map<String, dynamic> pool) {
  switch (pool['id']) {
    case 'POOL_DAILY':
      return '#饮食';
    case 'POOL_FLEX':
      return '#弹性';
    case 'POOL_FIXED':
      return '#固定';
    case 'POOL_EMERGENCY':
      return '#医疗';
    default:
      return '#${pool['name']}';
  }
}

/// Computes health color for a budget pool: overspent -> red, <20% left -> orange, else primary.
Color poolHealthColor(
  BuildContext context, {
  required double remaining,
  required double totalAvailable,
}) {
  if (remaining < 0) return Theme.of(context).colorScheme.error;
  if (totalAvailable > 0 && (remaining / totalAvailable) < 0.2) {
    return Colors.orange.shade700;
  }
  return Theme.of(context).colorScheme.primary;
}

/// Formats allocation mode code into human-readable Chinese label.
String formatAllocationMode(String? mode) {
  switch (mode) {
    case 'PRIMARY_ITEM':
      return '主商品独享优惠';
    case 'PROPORTIONAL':
      return '多品等比分摊';
    case 'MANUAL':
      return '手动分摊';
    default:
      return '单笔直出';
  }
}

/// Formats a decimal string to percentage text, e.g. `'1.020'` -> `'102'`.
String decimalRateToPercentText(String rawRate, {int decimals = 2}) {
  final parsed = double.tryParse(rawRate) ?? 0;
  final pct = parsed * 100;
  final fixed = pct.toStringAsFixed(decimals);
  if (!fixed.contains('.')) return fixed;
  return fixed.replaceFirst(RegExp(r'0+$'), '').replaceFirst(RegExp(r'\.$'), '');
}

/// Shows a unified bottom sheet to pick either a budget pool or a project tag for an item.
/// Returns `{'budget_pool_id': ..., 'project_tag_id': ...}` or `null` when dismissed.
Future<Map<String, String?>?> showTargetPickerSheet(
  BuildContext context,
  FlutterLedgerEngine engine, {
  String? currentPoolId,
  String? currentProjectTagId,
  String title = '调整归属预算池 / 专项',
}) {
  return showModalBottomSheet<Map<String, String?>>(
    context: context,
    showDragHandle: true,
    isScrollControlled: true,
    builder: (ctx) {
      final cs = Theme.of(ctx).colorScheme;
      final activeTags =
          engine.projectTags.where((t) => t['is_active'] != false).toList();
      return SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxHeight: MediaQuery.sizeOf(ctx).height * 0.65,
          ),
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  title,
                  style: Theme.of(ctx)
                      .textTheme
                      .titleMedium
                      ?.copyWith(fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 12),
                Text(
                  '月度预算资金池',
                  style: Theme.of(ctx)
                      .textTheme
                      .labelMedium
                      ?.copyWith(color: cs.onSurfaceVariant),
                ),
                const SizedBox(height: 6),
                for (final pool in engine.budgetPools)
                  ListTile(
                    dense: true,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                    selected: currentProjectTagId == null &&
                        currentPoolId == pool['id'],
                    leading: const Icon(Icons.savings_outlined),
                    title: Text(pool['name'] as String),
                    subtitle: pool['description'] != null
                        ? Text(
                            pool['description'] as String,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          )
                        : null,
                    trailing: currentProjectTagId == null &&
                            currentPoolId == pool['id']
                        ? Icon(Icons.check_circle, color: cs.primary)
                        : null,
                    onTap: () => Navigator.of(ctx).pop(<String, String?>{
                      'budget_pool_id': pool['id'] as String,
                      'project_tag_id': null,
                    }),
                  ),
                if (activeTags.isNotEmpty) ...<Widget>[
                  const Divider(height: 20),
                  Text(
                    '跨期专项立项',
                    style: Theme.of(ctx)
                        .textTheme
                        .labelMedium
                        ?.copyWith(color: cs.onSurfaceVariant),
                  ),
                  const SizedBox(height: 6),
                  for (final tag in activeTags)
                    ListTile(
                      dense: true,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                      selected: currentProjectTagId == tag['id'],
                      leading: Icon(Icons.flag_outlined, color: cs.secondary),
                      title: Text('#${tag['name']}'),
                      subtitle: tag['target_budget'] != null
                          ? Text('目标预算 ¥${tag['target_budget']}')
                          : null,
                      trailing: currentProjectTagId == tag['id']
                          ? Icon(Icons.check_circle, color: cs.secondary)
                          : null,
                      onTap: () => Navigator.of(ctx).pop(<String, String?>{
                        'budget_pool_id': 'POOL_FLEX',
                        'project_tag_id': tag['id'] as String,
                      }),
                    ),
                ],
              ],
            ),
          ),
        ),
      );
    },
  );
}

/// Shows snackbar safely on the nearest [ScaffoldMessenger].
void showLedgerSnackBar(
  BuildContext context,
  String message, {
  bool isError = false,
  String? actionLabel,
  VoidCallback? onAction,
  Duration duration = const Duration(seconds: 3),
}) {
  final messenger = ScaffoldMessenger.maybeOf(context);
  if (messenger == null) return;
  messenger
    ..clearSnackBars()
    ..showSnackBar(
      SnackBar(
        content: Text(message),
        duration: duration,
        backgroundColor: isError ? Theme.of(context).colorScheme.error : null,
        action: (actionLabel != null && onAction != null)
            ? SnackBarAction(label: actionLabel, onPressed: onAction)
            : null,
      ),
    );
}

/// Mastercard foreign currency settlement dialog supporting both settled CNY and cashback %.
class SettleFxDialog extends StatefulWidget {
  const SettleFxDialog({
    super.key,
    required this.merchantOrNote,
    required this.originalCurrency,
    required this.originalAmount,
    required this.holdAmountCny,
    required this.initialSettledAmount,
    required this.initialCashbackRate,
  });

  final String merchantOrNote;
  final String originalCurrency;
  final String originalAmount;
  final String holdAmountCny;
  final String initialSettledAmount;
  final String initialCashbackRate;

  @override
  State<SettleFxDialog> createState() => _SettleFxDialogState();
}

class _SettleFxDialogState extends State<SettleFxDialog> {
  late final TextEditingController _amountCtrl;
  late final TextEditingController _cashbackPctCtrl;

  @override
  void initState() {
    super.initState();
    _amountCtrl = TextEditingController(text: widget.initialSettledAmount);
    _cashbackPctCtrl = TextEditingController(
      text: decimalRateToPercentText(widget.initialCashbackRate),
    );
  }

  @override
  void dispose() {
    _amountCtrl.dispose();
    _cashbackPctCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('万事达外币预授权清算'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              '${widget.merchantOrNote} (${widget.originalCurrency} ${widget.originalAmount})',
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 4),
            Text(
              '预授权冻结: ¥${widget.holdAmountCny}',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _amountCtrl,
              autofocus: true,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(
                labelText: '银行实际入账人民币金额 (CNY)',
                prefixText: '¥ ',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _cashbackPctCtrl,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(
                labelText: '外币返现比例 (%)',
                suffixText: '%',
                border: OutlineInputBorder(),
              ),
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
            final amt = _amountCtrl.text.trim();
            final numAmt = double.tryParse(amt);
            if (numAmt == null || numAmt <= 0) return;
            final pctNum = double.tryParse(_cashbackPctCtrl.text.trim()) ?? 1.0;
            final rateStr = (pctNum / 100).toStringAsFixed(4);
            Navigator.of(context).pop(<String, String>{
              'settledAmountCny': amt,
              'cashbackRate': rateStr,
            });
          },
          child: const Text('确认入账'),
        ),
      ],
    );
  }
}
