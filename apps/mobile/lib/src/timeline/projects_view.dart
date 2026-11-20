import 'package:material_ui/material_ui.dart';

import '../ledger_engine.dart';
import '../ui_helpers.dart';
import '../widgets/common_ui.dart';

/// Detached cross-month project budget overview & project card list.
class ProjectsView extends StatelessWidget {
  const ProjectsView({
    super.key,
    required this.engine,
    required this.onOpenProjectEditor,
    required this.onDeleteProject,
    required this.onFilterByProject,
  });

  final FlutterLedgerEngine engine;
  final Future<void> Function({Map<String, dynamic>? existing})
      onOpenProjectEditor;
  final void Function(String tagId) onDeleteProject;
  final void Function(String tagId) onFilterByProject;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final summary = engine.getProjectTagsSummary();
    final projects =
        (summary['projects'] as List<dynamic>).cast<Map<String, dynamic>>();

    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 96),
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
                  onPressed: () => onOpenProjectEditor(),
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
                      onPressed: () => onOpenProjectEditor(existing: tag),
                    ),
                    IconButton(
                      visualDensity: VisualDensity.compact,
                      constraints:
                          const BoxConstraints(minWidth: 32, minHeight: 32),
                      padding: const EdgeInsets.all(4),
                      tooltip: '删除专项',
                      icon: const Icon(Icons.delete_outline, size: 18),
                      onPressed: () => onDeleteProject(tag['id'] as String),
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
