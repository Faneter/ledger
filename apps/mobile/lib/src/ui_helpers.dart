import 'package:flutter/scheduler.dart';
import 'package:material_ui/material_ui.dart';

import 'ledger_engine.dart';

export 'widgets/settle_fx_dialog.dart';

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
                if (engine.budgetPools.isEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 6),
                    child: Text(
                      '暂无月度预算池',
                      style: Theme.of(ctx)
                          .textTheme
                          .bodySmall
                          ?.copyWith(color: cs.onSurfaceVariant),
                    ),
                  )
                else
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
                ListTile(
                  dense: true,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                  selected: currentProjectTagId == null && currentPoolId == null,
                  leading: const Icon(Icons.layers_clear_outlined),
                  title: const Text('暂不绑定预算池（自由流水）'),
                  trailing: currentProjectTagId == null && currentPoolId == null
                      ? Icon(Icons.check_circle, color: cs.primary)
                      : null,
                  onTap: () => Navigator.of(ctx).pop(<String, String?>{
                    'budget_pool_id': null,
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
                        'budget_pool_id':
                            engine.budgetPools.any((p) => p['id'] == 'POOL_FLEX')
                                ? 'POOL_FLEX'
                                : null,
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

/// Bridges pure-Dart [FlutterLedgerEngine] observer callbacks into a Flutter [ChangeNotifier]
/// while safely deferring notifications that happen during a build phase.
class EngineChangeNotifier extends ChangeNotifier {
  EngineChangeNotifier(this.engine) {
    engine.addListener(_onEngineChanged);
  }

  final FlutterLedgerEngine engine;
  bool _disposed = false;

  void _onEngineChanged() {
    if (_disposed) return;
    if (SchedulerBinding.instance.schedulerPhase ==
        SchedulerPhase.persistentCallbacks) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!_disposed) {
          notifyListeners();
        }
      });
    } else {
      notifyListeners();
    }
  }

  @override
  void dispose() {
    _disposed = true;
    engine.removeListener(_onEngineChanged);
    super.dispose();
  }
}

/// Returns effective order discount (`total_gross - total_net`, clamped >= 0) in integer cents.
/// Using `total_gross - total_net` guarantees exact agreement with pool/project `allocated_discount`
/// sums even on legacy headers edited before `platform_discount` clearing was added.
int headerTotalDiscountCents(Map<String, dynamic> header) {
  if (header['tx_type'] == 'INCOME') return 0;
  final gross =
      double.tryParse((header['total_gross'] as String?) ?? '0') ?? 0;
  final net = double.tryParse((header['total_net'] as String?) ?? '0') ?? 0;
  final diffCents = (gross * 100).round() - (net * 100).round();
  return diffCents > 0 ? diffCents : 0;
}
