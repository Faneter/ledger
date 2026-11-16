// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'ledger_engine.dart';
import 'platform_backup.dart';
import 'ui_helpers.dart';

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
      child: InkWell(
        borderRadius: BorderRadius.circular(999),
        onTap: onTap,
        child: Tooltip(
          message: '云端同步与差异处理',
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
    );
  }
}

class SyncAndConflictDialog extends StatefulWidget {
  const SyncAndConflictDialog({
    super.key,
    required this.engine,
    required this.onEngineChanged,
    this.onPickBackupFile,
    this.onSaveBackupFile,
  });

  final FlutterLedgerEngine engine;
  final VoidCallback onEngineChanged;
  final JsonFilePicker? onPickBackupFile;
  final JsonFileSaver? onSaveBackupFile;

  @override
  State<SyncAndConflictDialog> createState() => _SyncAndConflictDialogState();
}

class _SyncAndConflictDialogState extends State<SyncAndConflictDialog> {
  late final TextEditingController _serverUrlCtrl;
  String? _feedback;
  bool _feedbackIsError = false;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _serverUrlCtrl = TextEditingController(text: widget.engine.serverUrl);
  }

  @override
  void dispose() {
    _serverUrlCtrl.dispose();
    super.dispose();
  }

  Future<void> _runSync() async {
    setState(() {
      _busy = true;
      _feedback = null;
      _feedbackIsError = false;
    });
    final res = await widget.engine.syncWithServer(
      baseUrl: _serverUrlCtrl.text.trim(),
    );
    widget.onEngineChanged();
    if (!mounted) return;
    setState(() {
      _busy = false;
      if (res['success'] == true) {
        _feedback =
            '同步完成：推送 ${res['pushedCount']} 条操作 · 服务端接收 ${res['appliedCount']} 条 · 共 ${res['totalOplogCount']} 条日志';
        _feedbackIsError = false;
      } else {
        _feedback = (res['message'] as String?) ?? '同步未完成';
        _feedbackIsError = res['skipped'] != true;
      }
    });
  }

  Future<void> _pullFromReset() async {
    setState(() {
      _busy = true;
      _feedback = null;
      _feedbackIsError = false;
    });
    try {
      await widget.engine.pullFromServerReset(
        baseUrl: _serverUrlCtrl.text.trim(),
      );
      widget.onEngineChanged();
      if (!mounted) return;
      setState(() {
        _busy = false;
        _feedback = '已按云端最新版本刷新本地账本数据';
        _feedbackIsError = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _feedback = '拉取云端数据失败: $e';
        _feedbackIsError = true;
      });
    }
  }

  Future<void> _pushLocalOverride() async {
    setState(() {
      _busy = true;
      _feedback = null;
      _feedbackIsError = false;
    });
    try {
      final res = await widget.engine.pushLocalBundleToServer(
        baseUrl: _serverUrlCtrl.text.trim(),
      );
      widget.onEngineChanged();
      if (!mounted) return;
      setState(() {
        _busy = false;
        _feedback =
            '已用本机完整账本覆盖云端（${res['transactionsCount']} 笔流水 · ${res['oplogCount']} 条日志）';
        _feedbackIsError = false;
      });
    } catch (e) {
      widget.onEngineChanged();
      if (!mounted) return;
      setState(() {
        _busy = false;
        _feedback = '覆盖上传失败: $e';
        _feedbackIsError = true;
      });
    }
  }

  Future<void> _resolveConflict(String conflictId, String resolution) async {
    setState(() {
      _busy = true;
      _feedback = null;
      _feedbackIsError = false;
    });
    try {
      await widget.engine.resolveConflict(
        conflictId,
        resolution,
        baseUrl: _serverUrlCtrl.text.trim(),
      );
      widget.onEngineChanged();
      if (!mounted) return;
      setState(() {
        _busy = false;
        _feedback = resolution == 'KEEP_WINNER'
            ? '已保留当前胜出版本并完成同步'
            : '已采纳另一台设备的修改并覆盖同步';
        _feedbackIsError = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _feedback = '提交差异确认失败: $e';
        _feedbackIsError = true;
      });
    }
  }

  Future<void> _exportBackupFile() async {
    final json = widget.engine.exportBackupJson();
    final today = getLocalTodayDateStr();
    final suggestedName = 'geek_ledger_backup_$today.json';
    try {
      final saver = widget.onSaveBackupFile ?? MobilePlatformBridge.saveJsonFile;
      final savedName = await saver(suggestedName, json);
      if (!mounted) return;
      if (savedName == null) {
        setState(() {
          _feedback = '已取消导出 JSON 文件';
          _feedbackIsError = false;
        });
        return;
      }
      setState(() {
        _feedback = '已导出 JSON 备份文件：$savedName';
        _feedbackIsError = false;
      });
    } on MissingPluginException {
      await Clipboard.setData(ClipboardData(text: json));
      if (!mounted) return;
      setState(() {
        _feedback = '当前平台不支持系统文件保存器，已复制到剪贴板 (${json.length} 字符)';
        _feedbackIsError = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _feedback = '导出 JSON 失败: $e';
        _feedbackIsError = true;
      });
    }
  }

  Future<void> _pickAndImportBackupFile() async {
    try {
      final picker = widget.onPickBackupFile ?? MobilePlatformBridge.pickJsonFile;
      final picked = await picker();
      if (picked == null || !mounted) return;

      final summary = widget.engine.importBackupJson(picked.content);
      widget.onEngineChanged();
      setState(() {
        _feedback =
            '已导入「${picked.name}」：${summary['transactionsCount']} 笔流水、${summary['poolsCount']} 个预算池、${summary['vouchersCount']} 张卡券';
        _feedbackIsError = false;
      });
    } on MissingPluginException {
      if (!mounted) return;
      setState(() {
        _feedback = '当前平台不支持系统文件选择器，请在 Android 设备上使用文件导入';
        _feedbackIsError = true;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _feedback = '导入 JSON 文件失败: $e';
        _feedbackIsError = true;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final engine = widget.engine;
    final cs = Theme.of(context).colorScheme;
    final pendingConflicts = engine.pendingConflicts;

    return AlertDialog(
      title: const Text('云端同步与差异处理'),
      content: SizedBox(
        width: 440,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              // 0. 服务端地址设置（匹配真实服务端 /api/sync/exchange）
              TextField(
                controller: _serverUrlCtrl,
                decoration: const InputDecoration(
                  labelText: '同步服务端地址 (URL)',
                  hintText: 'http://127.0.0.1:3001 或局域网 http://192.168.x.x:3001',
                  border: OutlineInputBorder(),
                  isDense: true,
                ),
                onChanged: (v) {
                  engine.serverUrl = v.trim();
                  engine.saveToDisk();
                },
              ),
              const SizedBox(height: 10),

              // 1. 状态卡（对齐 Web SyncAndConflictModal 当前同步状态）
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
              const SizedBox(height: 10),

              // 2. 服务端重置保护告警（与 Web 一致）
              if (engine.serverResetDetected) ...<Widget>[
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: cs.errorContainer.withValues(alpha: 0.65),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: cs.error.withValues(alpha: 0.5)),
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
                        '为防止将本机旧日志静默写回或覆写数据，自动同步已挂起。请选择如何协调本机与云端状态：',
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
                            onPressed: _busy ? null : _pullFromReset,
                            child: const Text('以云端为准刷新'),
                          ),
                          FilledButton(
                            onPressed: _busy ? null : _pushLocalOverride,
                            child: const Text('用本机数据覆盖云端'),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 10),
              ],

              // 3. 仅存本地开关 + 立即同步
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('仅存本地（暂停云同步）'),
                subtitle: const Text('开启后所有操作仅记录在本地，不向服务端发请求'),
                value: engine.isOfflineMode,
                onChanged: (v) {
                  setState(() {
                    engine.isOfflineMode = v;
                  });
                  engine.saveToDisk();
                  widget.onEngineChanged();
                },
              ),

              Row(
                children: <Widget>[
                  Expanded(
                    child: FilledButton.icon(
                      onPressed:
                          (_busy || engine.isOfflineMode) ? null : _runSync,
                      icon: _busy
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.sync_rounded, size: 18),
                      label: Text(_busy ? '同步中...' : '立即与服务端同步'),
                    ),
                  ),
                ],
              ),

              if (engine.lastSyncError != null && _feedback == null) ...<Widget>[
                const SizedBox(height: 8),
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: cs.errorContainer.withValues(alpha: 0.45),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    '上次同步失败: ${engine.lastSyncError}',
                    style: TextStyle(fontSize: 12, color: cs.onErrorContainer),
                  ),
                ),
              ],

              if (_feedback != null) ...<Widget>[
                const SizedBox(height: 8),
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: _feedbackIsError
                        ? cs.errorContainer.withValues(alpha: 0.65)
                        : cs.secondaryContainer.withValues(alpha: 0.65),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    _feedback!,
                    style: TextStyle(
                      fontSize: 12,
                      color: _feedbackIsError
                          ? cs.onErrorContainer
                          : cs.onSecondaryContainer,
                    ),
                  ),
                ),
              ],

              const Divider(height: 24),

              // 4. 多端修改差异确认（真实服务端冲突队列）
              Text(
                '多端修改差异确认 (${pendingConflicts.length})',
                style: Theme.of(context)
                    .textTheme
                    .titleSmall
                    ?.copyWith(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 8),
              if (pendingConflicts.isEmpty)
                Text(
                  '暂无待处理的多端修改差异。当多个设备同时离线修改同一记录并上传时，冲突摘要将自动列在此处供您裁决。',
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall
                      ?.copyWith(color: cs.onSurfaceVariant),
                )
              else
                for (final cf in pendingConflicts)
                  Card(
                    margin: const EdgeInsets.only(bottom: 10),
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text(
                            '冲突单据: ${cf['entity_type'] ?? 'ENTITY'} · ${cf['entity_id'] ?? ''}',
                            style: const TextStyle(
                              fontWeight: FontWeight.bold,
                              fontSize: 12,
                            ),
                          ),
                          const SizedBox(height: 8),
                          _conflictSideBox(
                            context,
                            title: '服务端胜出版本 (Winner)',
                            summary:
                                (cf['winner_summary'] as String?) ?? '胜出修改',
                            highlighted: true,
                          ),
                          const SizedBox(height: 6),
                          _conflictSideBox(
                            context,
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
                                onPressed: _busy
                                    ? null
                                    : () => _resolveConflict(
                                          cf['id'] as String,
                                          'KEEP_WINNER',
                                        ),
                                child: const Text('保留当前胜出版本'),
                              ),
                              FilledButton(
                                onPressed: _busy
                                    ? null
                                    : () => _resolveConflict(
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
                  ),

              const Divider(height: 24),

              // 5. 全量推送覆盖 + JSON 备份与本地重置
              Text(
                '本地备份、全量推云与重设',
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
                    onPressed: _busy || engine.isOfflineMode
                        ? null
                        : _pushLocalOverride,
                    icon: const Icon(Icons.cloud_upload_outlined, size: 16),
                    label: const Text('用本机数据完整覆盖云端'),
                  ),
                  OutlinedButton.icon(
                    onPressed: _busy ? null : _exportBackupFile,
                    icon: const Icon(Icons.save_alt_outlined, size: 16),
                    label: const Text('导出 JSON 文件'),
                  ),
                  OutlinedButton.icon(
                    onPressed: _busy ? null : _pickAndImportBackupFile,
                    icon: const Icon(Icons.folder_open_outlined, size: 16),
                    label: const Text('选择 JSON 导入'),
                  ),
                  OutlinedButton.icon(
                    onPressed: () {
                      engine.resetToCleanState();
                      widget.onEngineChanged();
                      Navigator.of(context).pop();
                      showLedgerSnackBar(
                        context,
                        '已清空本地数据（0 预算池 / 0 流水 / 0 卡券）',
                      );
                    },
                    icon: const Icon(Icons.cleaning_services_outlined, size: 16),
                    label: const Text('清空本地数据'),
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
