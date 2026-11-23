import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import 'ledger_engine.dart';
import 'platform_backup.dart';
import 'settings/appearance_fx_sections.dart';
import 'settings/cloud_sync_section.dart';
import 'ui_helpers.dart';
import 'widgets/common_ui.dart';

export 'settings/sync_status_pill.dart' show SyncStatusPill;

class SettingsPage extends StatefulWidget {
  const SettingsPage({
    super.key,
    required this.engine,
    required this.onEngineChanged,
    required this.onAppearanceChanged,
    this.monetSeedArgb,
    this.focusSyncSection = false,
    this.onPickBackupFile,
    this.onSaveBackupFile,
  });

  final FlutterLedgerEngine engine;
  final VoidCallback onEngineChanged;
  final VoidCallback onAppearanceChanged;
  final int? monetSeedArgb;
  final bool focusSyncSection;
  final JsonFilePicker? onPickBackupFile;
  final JsonFileSaver? onSaveBackupFile;

  @override
  State<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends State<SettingsPage> {
  final GlobalKey _syncSectionKey = GlobalKey();
  late final TextEditingController _serverUrlCtrl;
  late final TextEditingController _holdPctCtrl;
  late final TextEditingController _cashbackPctCtrl;

  String? _syncFeedback;
  bool _syncFeedbackIsError = false;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _serverUrlCtrl = TextEditingController(text: widget.engine.serverUrl);
    _holdPctCtrl = TextEditingController(
      text: decimalRateToPercentText(
        widget.engine.settings['fx_default_hold_ratio'] ?? '1.020',
        decimals: 1,
      ),
    );
    _cashbackPctCtrl = TextEditingController(
      text: decimalRateToPercentText(
        widget.engine.settings['fx_default_cashback_rate'] ?? '0.0100',
      ),
    );

    if (widget.focusSyncSection) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        final ctx = _syncSectionKey.currentContext;
        if (ctx != null && mounted) {
          final reduceMotion =
              MediaQuery.maybeOf(context)?.reduceMotion ?? false;
          Scrollable.ensureVisible(
            ctx,
            duration: reduceMotion
                ? Duration.zero
                : const Duration(milliseconds: 280),
            curve: Curves.easeOutCubic,
            alignment: 0.05,
          );
        }
      });
    }
  }

  @override
  void dispose() {
    _serverUrlCtrl.dispose();
    _holdPctCtrl.dispose();
    _cashbackPctCtrl.dispose();
    super.dispose();
  }

  Future<void> _runSync() async {
    setState(() {
      _busy = true;
      _syncFeedback = null;
      _syncFeedbackIsError = false;
    });
    final res = await widget.engine.syncWithServer(
      baseUrl: _serverUrlCtrl.text.trim(),
    );
    widget.onEngineChanged();
    if (!mounted) return;
    setState(() {
      _busy = false;
      if (res['success'] == true) {
        _syncFeedback =
            '同步完成：推送 ${res['pushedCount']} 条操作 · 服务端接收 ${res['appliedCount']} 条 · 共 ${res['totalOplogCount']} 条日志';
        _syncFeedbackIsError = false;
      } else {
        _syncFeedback = (res['message'] as String?) ?? '同步未完成';
        _syncFeedbackIsError = res['skipped'] != true;
      }
    });
  }

  Future<void> _pullFromReset() async {
    setState(() {
      _busy = true;
      _syncFeedback = null;
      _syncFeedbackIsError = false;
    });
    try {
      await widget.engine.pullFromServerReset(
        baseUrl: _serverUrlCtrl.text.trim(),
      );
      widget.onEngineChanged();
      if (!mounted) return;
      setState(() {
        _busy = false;
        _syncFeedback = '已按云端最新版本刷新本地账本数据';
        _syncFeedbackIsError = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _syncFeedback = '拉取云端数据失败: $e';
        _syncFeedbackIsError = true;
      });
    }
  }

  Future<void> _pushLocalOverride() async {
    setState(() {
      _busy = true;
      _syncFeedback = null;
      _syncFeedbackIsError = false;
    });
    try {
      final res = await widget.engine.pushLocalBundleToServer(
        baseUrl: _serverUrlCtrl.text.trim(),
      );
      widget.onEngineChanged();
      if (!mounted) return;
      setState(() {
        _busy = false;
        _syncFeedback =
            '已用本机完整账本覆盖云端（${res['transactionsCount']} 笔流水 · ${res['oplogCount']} 条日志）';
        _syncFeedbackIsError = false;
      });
    } catch (e) {
      widget.onEngineChanged();
      if (!mounted) return;
      setState(() {
        _busy = false;
        _syncFeedback = '覆盖上传失败: $e';
        _syncFeedbackIsError = true;
      });
    }
  }

  Future<void> _resolveConflict(String conflictId, String resolution) async {
    setState(() {
      _busy = true;
      _syncFeedback = null;
      _syncFeedbackIsError = false;
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
        _syncFeedback = resolution == 'KEEP_WINNER'
            ? '已保留当前胜出版本并完成同步'
            : '已采纳另一台设备的修改并覆盖同步';
        _syncFeedbackIsError = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _syncFeedback = '提交差异确认失败: $e';
        _syncFeedbackIsError = true;
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
          _syncFeedback = '已取消导出 JSON 文件';
          _syncFeedbackIsError = false;
        });
        return;
      }
      setState(() {
        _syncFeedback = '已导出 JSON 备份文件：$savedName';
        _syncFeedbackIsError = false;
      });
    } on MissingPluginException {
      await Clipboard.setData(ClipboardData(text: json));
      if (!mounted) return;
      setState(() {
        _syncFeedback = '当前平台不支持系统文件保存器，已复制到剪贴板 (${json.length} 字符)';
        _syncFeedbackIsError = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _syncFeedback = '导出 JSON 失败: $e';
        _syncFeedbackIsError = true;
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
      widget.onAppearanceChanged();
      setState(() {
        _syncFeedback =
            '已导入「${picked.name}」：${summary['transactionsCount']} 笔流水、${summary['poolsCount']} 个预算池';
        _syncFeedbackIsError = false;
      });
    } on MissingPluginException {
      if (!mounted) return;
      setState(() {
        _syncFeedback = '当前平台不支持系统文件选择器，请在 Android 设备上使用文件导入';
        _syncFeedbackIsError = true;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _syncFeedback = '导入 JSON 文件失败: $e';
        _syncFeedbackIsError = true;
      });
    }
  }

  void _saveFxSettings() {
    final holdPct = double.tryParse(_holdPctCtrl.text.trim()) ?? 102.0;
    final cbPct = double.tryParse(_cashbackPctCtrl.text.trim()) ?? 1.0;
    widget.engine.updateFxSettings(
      defaultHoldRatio: (holdPct / 100).toStringAsFixed(3),
      defaultCashbackRate: (cbPct / 100).toStringAsFixed(4),
    );
    widget.onEngineChanged();
    showLedgerSnackBar(context, '外币默认参数已更新');
  }

  @override
  Widget build(BuildContext context) {
    final engine = widget.engine;

    return Scaffold(
      appBar: AppBar(
        title: const Text('设置'),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
        children: <Widget>[
          // 1. 外观与主题设置（跟随系统明暗 + 莫奈取色）
          AppearanceSettingsSection(
            engine: engine,
            monetSeedArgb: widget.monetSeedArgb,
            onAppearanceChanged: widget.onAppearanceChanged,
            onLocalChanged: () => setState(() {}),
          ),

          const SizedBox(height: 20),

          // 2. 外币默认参数（从 Tab 3 迁移至此）
          FxSettingsSection(
            holdPctCtrl: _holdPctCtrl,
            cashbackPctCtrl: _cashbackPctCtrl,
            onSave: _saveFxSettings,
          ),

          const SizedBox(height: 20),

          // 3. 云同步与服务器设置
          CloudSyncSection(
            sectionKey: _syncSectionKey,
            engine: engine,
            serverUrlCtrl: _serverUrlCtrl,
            busy: _busy,
            syncFeedback: _syncFeedback,
            syncFeedbackIsError: _syncFeedbackIsError,
            onRunSync: _runSync,
            onPullFromReset: _pullFromReset,
            onPushLocalOverride: _pushLocalOverride,
            onResolveConflict: _resolveConflict,
            onOfflineModeChanged: (v) {
              setState(() {
                engine.isOfflineMode = v;
              });
              engine.scheduleSave();
              widget.onEngineChanged();
            },
          ),

          const SizedBox(height: 20),

          // 4. 数据备份与本地管理
          const LedgerSectionHeader(
            title: '数据备份与管理',
            icon: Icons.sd_storage_outlined,
          ),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Wrap(
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
                      engine.resetToCleanState(preserveAppearance: true);
                      widget.onEngineChanged();
                      setState(() {
                        _syncFeedback = '已清空本地数据（0 预算池 / 0 流水）';
                        _syncFeedbackIsError = false;
                      });
                    },
                    icon: const Icon(Icons.cleaning_services_outlined, size: 16),
                    label: const Text('清空本地数据'),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
