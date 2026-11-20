import 'package:material_ui/material_ui.dart';

import '../ledger_engine.dart';

class SyncStatusPill extends StatelessWidget {
  const SyncStatusPill({
    super.key,
    required this.engine,
    required this.onTap,
  });

  final FlutterLedgerEngine engine;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final conflictsCount = engine.pendingConflicts.length;
    final pendingCount = engine.pendingSyncCount;

    late final Color bg;
    late final Color fg;
    late final IconData icon;
    late final String label;

    if (engine.isOfflineMode) {
      bg = cs.surfaceContainerHighest;
      fg = cs.onSurfaceVariant;
      icon = Icons.cloud_off_rounded;
      label = '仅存本地';
    } else if (engine.serverResetDetected) {
      bg = cs.errorContainer;
      fg = cs.onErrorContainer;
      icon = Icons.warning_amber_rounded;
      label = '云端重置';
    } else if (conflictsCount > 0) {
      bg = cs.errorContainer;
      fg = cs.onErrorContainer;
      icon = Icons.sync_problem_rounded;
      label = '$conflictsCount 差异';
    } else if (engine.isSyncing) {
      bg = cs.secondaryContainer;
      fg = cs.onSecondaryContainer;
      icon = Icons.sync_rounded;
      label = '同步中';
    } else if (engine.lastSyncError != null) {
      bg = cs.errorContainer;
      fg = cs.onErrorContainer;
      icon = Icons.cloud_off_rounded;
      label = '未连云端';
    } else if (engine.lastSyncAt == null) {
      bg = cs.tertiaryContainer;
      fg = cs.onTertiaryContainer;
      icon = Icons.cloud_queue_rounded;
      label = pendingCount > 0 ? '待传 $pendingCount' : '未同步';
    } else if (pendingCount > 0) {
      bg = cs.tertiaryContainer;
      fg = cs.onTertiaryContainer;
      icon = Icons.cloud_upload_outlined;
      label = '待传 $pendingCount';
    } else {
      bg = cs.primaryContainer;
      fg = cs.onPrimaryContainer;
      icon = Icons.cloud_done_outlined;
      label = '已同步';
    }

    return Padding(
      padding: const EdgeInsets.only(right: 4),
      child: Semantics(
        button: true,
        label: '云端同步状态: $label',
        child: InkWell(
          borderRadius: BorderRadius.circular(999),
          onTap: onTap,
          child: Tooltip(
            message: '前往云端同步设置',
            child: Container(
              constraints: const BoxConstraints(maxWidth: 108),
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
              decoration: BoxDecoration(
                color: bg,
                borderRadius: BorderRadius.circular(999),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Icon(icon, size: 14, color: fg),
                  const SizedBox(width: 4),
                  Flexible(
                    child: Text(
                      label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color: fg,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
