import 'package:material_ui/material_ui.dart';

import '../ledger_engine.dart';
import '../widgets/common_ui.dart';

/// Cloud HLC sync configuration, status summary, server reset recovery, and conflict UI.
class CloudSyncSection extends StatelessWidget {
  const CloudSyncSection({
    super.key,
    required this.sectionKey,
    required this.engine,
    required this.serverUrlCtrl,
    required this.busy,
    required this.syncFeedback,
    required this.syncFeedbackIsError,
    required this.onRunSync,
    required this.onPullFromReset,
    required this.onPushLocalOverride,
    required this.onResolveConflict,
    required this.onOfflineModeChanged,
  });

  final GlobalKey sectionKey;
  final FlutterLedgerEngine engine;
  final TextEditingController serverUrlCtrl;
  final bool busy;
  final String? syncFeedback;
  final bool syncFeedbackIsError;
  final VoidCallback onRunSync;
  final VoidCallback onPullFromReset;
  final VoidCallback onPushLocalOverride;
  final void Function(String conflictId, String resolution) onResolveConflict;
  final ValueChanged<bool> onOfflineModeChanged;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final pendingConflicts = engine.pendingConflicts;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Container(
          key: sectionKey,
          child: const LedgerSectionHeader(
            title: '云同步与服务器',
            icon: Icons.cloud_sync_outlined,
          ),
        ),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                TextField(
                  controller: serverUrlCtrl,
                  decoration: const InputDecoration(
                    labelText: '同步服务端地址 (URL)',
                    hintText: 'http://127.0.0.1:3001 或局域网 http://192.168.x.x:3001',
                    border: OutlineInputBorder(),
                    isDense: true,
                  ),
                  onChanged: (v) {
                    engine.serverUrl = v.trim();
                    engine.scheduleSave();
                  },
                ),
                const SizedBox(height: 10),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: cs.surfaceContainerHighest.withValues(alpha: 0.45),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        '当前设备节点: ${engine.hlc.nodeId}',
                        style: const TextStyle(
                          fontWeight: FontWeight.w600,
                          fontSize: 13,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        engine.lastSyncAt != null
                            ? '最近云端同步: ${engine.lastSyncAt}'
                            : '尚未完成过云端同步',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      Text(
                        '本地累计日志: ${engine.syncOplog.length} 条 · 待推送: ${engine.pendingSyncCount} 条 · 待确认差异: ${pendingConflicts.length} 处',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      if (engine.serverEpochId != null)
                        Text(
                          '服务端 Epoch: ${engine.serverEpochId}',
                          style: Theme.of(context)
                              .textTheme
                              .bodySmall
                              ?.copyWith(color: cs.onSurfaceVariant),
                        ),
                    ],
                  ),
                ),
                if (engine.serverResetDetected) ...<Widget>[
                  const SizedBox(height: 10),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: cs.errorContainer.withValues(alpha: 0.65),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: cs.error.withValues(alpha: 0.5),
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          '检测到服务端数据曾重置或恢复',
                          style: TextStyle(
                            fontWeight: FontWeight.bold,
                            color: cs.onErrorContainer,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          '为防止将本机旧日志静默写回或覆写数据，自动同步已挂起。请选择处理方式：',
                          style: TextStyle(
                            fontSize: 12,
                            color: cs.onErrorContainer,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Wrap(
                          spacing: 8,
                          runSpacing: 6,
                          children: <Widget>[
                            OutlinedButton(
                              onPressed: busy ? null : onPullFromReset,
                              child: const Text('以云端为准刷新'),
                            ),
                            FilledButton(
                              onPressed: busy ? null : onPushLocalOverride,
                              child: const Text('用本机数据覆盖云端'),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
                const SizedBox(height: 4),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('仅存本地（暂停云同步）'),
                  subtitle: const Text('开启后所有操作仅记录在本地，不向服务端发请求'),
                  value: engine.isOfflineMode,
                  onChanged: onOfflineModeChanged,
                ),
                FilledButton.icon(
                  onPressed: (busy || engine.isOfflineMode) ? null : onRunSync,
                  icon: busy
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.sync_rounded, size: 18),
                  label: Text(busy ? '同步中...' : '立即与服务端同步'),
                ),
                if (engine.lastSyncError != null &&
                    syncFeedback == null) ...<Widget>[
                  const SizedBox(height: 8),
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: cs.errorContainer.withValues(alpha: 0.45),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Text(
                      '上次同步失败: ${engine.lastSyncError}',
                      style: TextStyle(
                        fontSize: 12,
                        color: cs.onErrorContainer,
                      ),
                    ),
                  ),
                ],
                if (syncFeedback != null) ...<Widget>[
                  const SizedBox(height: 8),
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: syncFeedbackIsError
                          ? cs.errorContainer.withValues(alpha: 0.55)
                          : cs.primaryContainer.withValues(alpha: 0.45),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Text(
                      syncFeedback!,
                      style: TextStyle(
                        fontSize: 12,
                        color: syncFeedbackIsError
                            ? cs.onErrorContainer
                            : cs.onPrimaryContainer,
                      ),
                    ),
                  ),
                ],
                if (pendingConflicts.isNotEmpty) ...<Widget>[
                  const Divider(height: 24),
                  Text(
                    '待确认同步差异 (${pendingConflicts.length})',
                    style: Theme.of(context).textTheme.titleSmall?.copyWith(
                          color: cs.error,
                          fontWeight: FontWeight.bold,
                        ),
                  ),
                  const SizedBox(height: 8),
                  for (final cf in pendingConflicts)
                    Container(
                      margin: const EdgeInsets.only(bottom: 10),
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color:
                            cs.surfaceContainerHighest.withValues(alpha: 0.35),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: cs.error.withValues(alpha: 0.45),
                        ),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text(
                            '${cf['conflict_type']} · ${cf['entity_id']}',
                            style: const TextStyle(
                              fontWeight: FontWeight.bold,
                              fontSize: 13,
                            ),
                          ),
                          const SizedBox(height: 8),
                          _ConflictSideBox(
                            title: '服务端胜出版本 (Winner)',
                            summary:
                                (cf['winner_summary'] as String?) ?? '胜出修改',
                            highlighted: true,
                          ),
                          const SizedBox(height: 6),
                          _ConflictSideBox(
                            title: '另一台设备提交 (Loser)',
                            summary:
                                (cf['loser_summary'] as String?) ?? '较早/并发修改',
                            highlighted: false,
                          ),
                          const SizedBox(height: 8),
                          Wrap(
                            spacing: 8,
                            runSpacing: 6,
                            children: <Widget>[
                              OutlinedButton(
                                onPressed: busy
                                    ? null
                                    : () => onResolveConflict(
                                          cf['id'] as String,
                                          'KEEP_WINNER',
                                        ),
                                child: const Text('保留当前胜出版本'),
                              ),
                              FilledButton(
                                onPressed: busy
                                    ? null
                                    : () => onResolveConflict(
                                          cf['id'] as String,
                                          'USE_LOSER',
                                        ),
                                child: const Text('采用另一端修改'),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _ConflictSideBox extends StatelessWidget {
  const _ConflictSideBox({
    required this.title,
    required this.summary,
    required this.highlighted,
  });

  final String title;
  final String summary;
  final bool highlighted;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: highlighted
            ? cs.primaryContainer.withValues(alpha: 0.4)
            : cs.surfaceContainerHighest.withValues(alpha: 0.4),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: highlighted ? cs.primary : cs.outlineVariant,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            title,
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.bold,
              color: highlighted ? cs.primary : cs.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 4),
          Text(summary, style: const TextStyle(fontSize: 12)),
        ],
      ),
    );
  }
}
