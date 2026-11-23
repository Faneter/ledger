import 'package:material_ui/material_ui.dart';

import '../ledger_engine.dart';
import '../timeline/transaction_dialogs.dart';
import '../ui_helpers.dart';
import '../widgets/common_ui.dart';

/// Embedded cross-month project budget overview & project card list inside OverviewTab.
class ProjectsSection extends StatelessWidget {
  const ProjectsSection({
    super.key,
    required this.engine,
    required this.onEngineChanged,
    required this.onFilterByProject,
  });

  final FlutterLedgerEngine engine;
  final VoidCallback onEngineChanged;
  final void Function(String tagId) onFilterByProject;

  Future<void> _openProjectEditorDialog(
    BuildContext context, {
    Map<String, dynamic>? existing,
  }) async {
    final isEdit = existing != null;
    final defaultYm = getLocalTodayDateStr().substring(0, 7);
    final result = await showDialog<ProjectDialogResult>(
      context: context,
      builder: (_) => ProjectEditorDialog(
        isEdit: isEdit,
        initialName: isEdit ? (existing['name'] as String) : '',
        initialBudget:
            isEdit ? ((existing['target_budget'] as String?) ?? '') : '500.00',
        initialStartDate:
            isEdit ? ((existing['start_date'] as String?) ?? '') : '$defaultYm-01',
        initialEndDate:
            isEdit ? ((existing['end_date'] as String?) ?? '') : '$defaultYm-30',
        initialActive: existing != null ? existing['is_active'] != false : true,
      ),
    );

    if (result == null) return;
    try {
      engine.upsertProjectTag(
        id: existing?['id'] as String?,
        name: result.name,
        targetBudget: result.targetBudget,
        startDate: result.startDate,
        endDate: result.endDate,
        isActive: result.isActive,
      );
      onEngineChanged();
      if (context.mounted) {
        showLedgerSnackBar(
          context,
          isEdit ? '专项立项已更新' : '已新增专项【${result.name}】',
        );
      }
    } catch (e) {
      if (context.mounted) {
        showLedgerSnackBar(context, '保存专项预算失败: $e', isError: true);
      }
    }
  }

  void _deleteProjectTag(BuildContext context, String tagId) {
    try {
      engine.deleteProjectTag(tagId);
      onEngineChanged();
    } catch (e) {
      showLedgerSnackBar(context, '$e', isError: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final summary = engine.getProjectTagsSummary();
    final projects =
        (summary['projects'] as List<dynamic>).cast<Map<String, dynamic>>();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Card(
          color: cs.secondaryContainer,
          elevation: 0,
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Row(
              children: <Widget>[
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        '专项预算总览 (进行中 ${summary['active_count']} 个)',
                        style: TextStyle(
                          fontWeight: FontWeight.bold,
                          color: cs.onSecondaryContainer,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '总目标 ¥${summary['total_target']} · 已支 ¥${summary['total_spent']} · 剩余 ¥${summary['total_remaining']}',
                        style: TextStyle(
                          fontSize: 12,
                          color: cs.onSecondaryContainer,
                        ),
                      ),
                    ],
                  ),
                ),
                FilledButton.icon(
                  onPressed: () => _openProjectEditorDialog(context),
                  icon: const Icon(Icons.add, size: 16),
                  label: const Text('新增专项'),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        if (projects.isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 40),
            child: Center(child: Text('暂无专项预算立项')),
          )
        else
          for (final tag in projects) _buildProjectCard(context, tag),
      ],
    );
  }

  Widget _buildProjectCard(BuildContext context, Map<String, dynamic> tag) {
    final cs = Theme.of(context).colorScheme;
    final targetStr = tag['target_budget'] as String?;
    final target = double.tryParse(targetStr ?? '') ?? 0;
    final spent = double.tryParse(tag['spent_net'] as String) ?? 0;
    final ratio = target > 0 ? (spent / target).clamp(0.0, 1.0) : 0.0;
    final remainingStr = tag['remaining_budget'] as String?;
    final remaining = double.tryParse(remainingStr ?? '') ?? 0;

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Expanded(
                  child: Text(
                    '#${tag['name']}',
                    style: const TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 15,
                    ),
                  ),
                ),
                LedgerBadge(
                  label: tag['effective_active'] == true ? '进行中' : '已归档',
                  backgroundColor: tag['effective_active'] == true
                      ? cs.primaryContainer
                      : cs.surfaceContainerHighest,
                  foregroundColor: tag['effective_active'] == true
                      ? cs.onPrimaryContainer
                      : cs.onSurfaceVariant,
                  fontSize: 11,
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 3,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              '${(tag['start_date'] as String?)?.isNotEmpty == true ? tag['start_date'] : '长期起'} ~ ${(tag['end_date'] as String?)?.isNotEmpty == true ? tag['end_date'] : '长期止'} · 关联流水 ${tag['tx_count']} 笔',
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: cs.onSurfaceVariant),
            ),
            if (targetStr != null) ...<Widget>[
              const SizedBox(height: 8),
              AccessibleProgressBar(
                label: '${tag['name']} 专项预算使用比例',
                value: ratio,
                color: poolHealthColor(
                  context,
                  remaining: remaining,
                  totalAvailable: target,
                ),
              ),
              const SizedBox(height: 6),
            ],
            Row(
              children: <Widget>[
                Expanded(
                  child: Text(
                    targetStr != null
                        ? '已支 ¥${tag['spent_net']} / 目标 ¥$targetStr (剩 ¥$remainingStr)'
                        : '累计已支 ¥${tag['spent_net']} (无上限场景)',
                    style: const TextStyle(
                      fontWeight: FontWeight.w600,
                      fontSize: 12,
                    ),
                  ),
                ),
                const SizedBox(width: 6),
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    TextButton(
                      style: TextButton.styleFrom(
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                        minimumSize: const Size(0, 32),
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      ),
                      onPressed: () => onFilterByProject(tag['id'] as String),
                      child: const Text('查流水'),
                    ),
                    IconButton(
                      visualDensity: VisualDensity.compact,
                      constraints:
                          const BoxConstraints(minWidth: 32, minHeight: 32),
                      padding: const EdgeInsets.all(4),
                      tooltip: '编辑专项',
                      icon: const Icon(Icons.edit_outlined, size: 18),
                      onPressed: () =>
                          _openProjectEditorDialog(context, existing: tag),
                    ),
                    IconButton(
                      visualDensity: VisualDensity.compact,
                      constraints:
                          const BoxConstraints(minWidth: 32, minHeight: 32),
                      padding: const EdgeInsets.all(4),
                      tooltip: '删除专项',
                      icon: const Icon(Icons.delete_outline, size: 18),
                      onPressed: () =>
                          _deleteProjectTag(context, tag['id'] as String),
                    ),
                  ],
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
