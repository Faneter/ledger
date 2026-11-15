// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'ledger_engine.dart';
import 'ui_helpers.dart';

/// Compact AppBar status indicator pill showing green synced, blue pending, orange conflicts, or offline.
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
    final conflictCount = engine.pendingConflicts.length;
    final pendingCount = engine.pendingSyncCount;

    final Color dotColor;
    final Color bgColor;
    final Color fgColor;
    final String label;

    if (conflictCount > 0) {
      dotColor = Colors.orange.shade700;
      bgColor = Colors.orange.withValues(alpha: 0.16);
      fgColor = Colors.orange.shade900;
      label = '$conflictCount 处差异';
    } else if (engine.isOfflineMode) {
      dotColor = cs.outline;
      bgColor = cs.surfaceContainerHighest;
      fgColor = cs.onSurfaceVariant;
      label = '仅本地';
    } else if (pendingCount > 0) {
      dotColor = Colors.blue.shade600;
      bgColor = Colors.blue.withValues(alpha: 0.14);
      fgColor = Colors.blue.shade800;
      label = '待同步 $pendingCount';
    } else {
      dotColor = Colors.green.shade600;
      bgColor = Colors.green.withValues(alpha: 0.14);
      fgColor = Colors.green.shade800;
      label = '已同步';
    }

    return Padding(
      padding: const EdgeInsets.only(right: 4),
      child: Material(
        color: bgColor,
        borderRadius: BorderRadius.circular(999),
        child: InkWell(
          borderRadius: BorderRadius.circular(999),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Container(
                  width: 8,
                  height: 8,
                  decoration: BoxDecoration(
                    color: dotColor,
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: 6),
                Text(
                  label,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: fgColor,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Modal dialog for HLC sync status, offline toggle, conflict resolution, and JSON backup/restore.
class SyncAndConflictDialog extends StatefulWidget {
  const SyncAndConflictDialog({
    super.key,
    required this.engine,
    required this.onEngineChanged,
  });

  final FlutterLedgerEngine engine;
  final VoidCallback onEngineChanged;

  @override
  State<SyncAndConflictDialog> createState() => _SyncAndConflictDialogState();
}

class _SyncAndConflictDialogState extends State<SyncAndConflictDialog> {
  String? _feedback;

  Future<void> _exportToClipboard() async {
    final json = widget.engine.exportBackupJson();
    await Clipboard.setData(ClipboardData(text: json));
    if (!mounted) return;
    setState(() {
      _feedback = '已将完整账本 JSON 备份复制到剪贴板 (${json.length} 字符)';
    });
  }

  Future<void> _openImportDialog() async {
    final ctrl = TextEditingController();
    final imported = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('导入 JSON 备份'),
        content: TextField(
          controller: ctrl,
          maxLines: 6,
          decoration: const InputDecoration(
            hintText: '粘贴之前导出的 GeekLedger JSON 内容...',
            border: OutlineInputBorder(),
          ),
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(ctrl.text.trim()),
            child: const Text('导入覆盖'),
          ),
        ],
      ),
    );
    ctrl.dispose();

    if (imported == null || imported.isEmpty || !mounted) return;
    try {
      final summary = widget.engine.importBackupJson(imported);
      widget.onEngineChanged();
      setState(() {
        _feedback =
            '导入成功：${summary['transactionsCount']} 笔流水、${summary['poolsCount']} 个预算池、${summary['vouchersCount']} 张卡券';
      });
    } catch (e) {
      setState(() {
        _feedback = '导入失败: $e';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final engine = widget.engine;
    final cs = Theme.of(context).colorScheme;
    final pendingConflicts = engine.pendingConflicts;

    return AlertDialog(
      title: const Text('HLC 多端同步与冲突裁决'),
      content: SizedBox(
        width: 420,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              if (_feedback != null)
                Container(
                  margin: const EdgeInsets.only(bottom: 12),
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: cs.primaryContainer,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    _feedback!,
                    style: TextStyle(color: cs.onPrimaryContainer, fontSize: 12),
                  ),
                ),

              // HLC status summary card
              Material(
                color: cs.surfaceContainerHighest.withValues(alpha: 0.45),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                  side: BorderSide(color: cs.outlineVariant),
                ),
                clipBehavior: Clip.antiAlias,
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        'HLC 节点: ${engine.hlc.nodeId}',
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '累计 OpLog: ${engine.syncOplog.length} 条 · 待推送: ${engine.pendingSyncCount} 条',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      const SizedBox(height: 4),
                      Text(
                        engine.lastSyncAt != null
                            ? '上次同步: ${engine.lastSyncAt}'
                            : '尚未执行同步（本地变更已安全保存）',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      const SizedBox(height: 10),
                      Row(
                        children: <Widget>[
                          Expanded(
                            child: FilledButton.icon(
                              onPressed: engine.isOfflineMode
                                  ? null
                                  : () {
                                      final res = engine.syncNow();
                                      widget.onEngineChanged();
                                      setState(() {
                                        _feedback =
                                            '同步完成：已对齐 ${res['pushedCount']} 条增量 OpLog';
                                      });
                                    },
                              icon: const Icon(Icons.sync, size: 18),
                              label: const Text('立即同步'),
                            ),
                          ),
                        ],
                      ),
                      SwitchListTile(
                        contentPadding: EdgeInsets.zero,
                        dense: true,
                        title: const Text('仅在本地保存（暂停同步）'),
                        value: engine.isOfflineMode,
                        onChanged: (v) {
                          engine.isOfflineMode = v;
                          widget.onEngineChanged();
                          setState(() {
                            _feedback = v ? '已切换为仅本地模式' : '已恢复同步模式';
                          });
                        },
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 14),

              // Multi-device conflict center
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: <Widget>[
                  Text(
                    '并发冲突裁决 (${pendingConflicts.length})',
                    style: Theme.of(context)
                        .textTheme
                        .titleSmall
                        ?.copyWith(fontWeight: FontWeight.bold),
                  ),
                  if (pendingConflicts.isEmpty)
                    TextButton(
                      onPressed: () {
                        engine.simulateConflictForDemo();
                        widget.onEngineChanged();
                        setState(() {});
                      },
                      child: const Text('模拟冲突演示'),
                    ),
                ],
              ),
              const SizedBox(height: 6),
              if (pendingConflicts.isEmpty)
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Colors.green.withValues(alpha: 0.08),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(
                      color: Colors.green.withValues(alpha: 0.3),
                    ),
                  ),
                  child: const Row(
                    children: <Widget>[
                      Icon(Icons.check_circle_outline,
                          color: Colors.green, size: 18),
                      SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          '当前各端数据一致，无修改冲突。',
                          style: TextStyle(fontSize: 13),
                        ),
                      ),
                    ],
                  ),
                )
              else
                for (final cf in pendingConflicts)
                  Card(
                    margin: const EdgeInsets.only(bottom: 8),
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          const Text(
                            '检测到多端同时修改差异',
                            style: TextStyle(fontWeight: FontWeight.bold),
                          ),
                          const SizedBox(height: 8),
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: <Widget>[
                              Expanded(
                                child: _conflictSideBox(
                                  context,
                                  title: '手机端 (保留)',
                                  summary: cf['winner_summary'] as String,
                                  highlighted: true,
                                ),
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: _conflictSideBox(
                                  context,
                                  title: '云端/桌面端',
                                  summary: cf['loser_summary'] as String,
                                  highlighted: false,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 8),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.end,
                            children: <Widget>[
                              OutlinedButton(
                                onPressed: () {
                                  engine.resolveConflict(
                                    cf['id'] as String,
                                    'USE_LOSER',
                                  );
                                  widget.onEngineChanged();
                                  setState(() {
                                    _feedback = '已采用云端版本';
                                  });
                                },
                                child: const Text('采用云端版'),
                              ),
                              const SizedBox(width: 8),
                              FilledButton(
                                onPressed: () {
                                  engine.resolveConflict(
                                    cf['id'] as String,
                                    'KEEP_WINNER',
                                  );
                                  widget.onEngineChanged();
                                  setState(() {
                                    _feedback = '已保留手机版本';
                                  });
                                },
                                child: const Text('保留手机版'),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),

              const Divider(height: 24),
              Text(
                '本地灾备与数据初始化',
                style: Theme.of(context)
                    .textTheme
                    .titleSmall
                    ?.copyWith(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: <Widget>[
                  OutlinedButton.icon(
                    onPressed: _exportToClipboard,
                    icon: const Icon(Icons.copy_all_outlined, size: 16),
                    label: const Text('导出 JSON'),
                  ),
                  OutlinedButton.icon(
                    onPressed: _openImportDialog,
                    icon: const Icon(Icons.upload_file_outlined, size: 16),
                    label: const Text('导入 JSON'),
                  ),
                  OutlinedButton.icon(
                    onPressed: () {
                      engine.resetToCleanState();
                      widget.onEngineChanged();
                      Navigator.of(context).pop();
                      showLedgerSnackBar(context, '已恢复为纯净初始账本（0 流水 / 0 卡券）');
                    },
                    icon: const Icon(Icons.cleaning_services_outlined, size: 16),
                    label: const Text('恢复纯净账本'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
      actions: <Widget>[
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('完成'),
        ),
      ],
    );
  }

  Widget _conflictSideBox(
    BuildContext context, {
    required String title,
    required String summary,
    required bool highlighted,
  }) {
    final cs = Theme.of(context).colorScheme;
    return Container(
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
