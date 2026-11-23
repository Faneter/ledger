import 'package:material_ui/material_ui.dart';

import 'ledger_engine.dart';
import 'overview/pool_editor_dialog.dart';
import 'overview/pool_water_card.dart';
import 'overview/projects_section.dart';
import 'ui_helpers.dart';
import 'widgets/common_ui.dart';

/// Dedicated NavigationBar tab pairing Monthly Budget Pools and Detached Project Budgets.
class BudgetsTab extends StatefulWidget {
  const BudgetsTab({
    super.key,
    required this.engine,
    required this.selectedMonth,
    required this.onPullSync,
    required this.onEngineChanged,
    required this.onFilterByProject,
  });

  final FlutterLedgerEngine engine;
  final String selectedMonth;
  final Future<void> Function() onPullSync;
  final VoidCallback onEngineChanged;
  final void Function(String tagId) onFilterByProject;

  @override
  State<BudgetsTab> createState() => _BudgetsTabState();
}

class _BudgetsTabState extends State<BudgetsTab> {
  int _segmentIndex = 0; // 0 = 月度预算池, 1 = 专项预算

  Future<void> _openPoolEditorDialog(
    BuildContext context, {
    Map<String, dynamic>? existingPoolStatus,
  }) async {
    final engine = widget.engine;
    final selectedMonth = widget.selectedMonth;
    final isEdit = existingPoolStatus != null;
    final poolId = isEdit
        ? existingPoolStatus['pool_id'] as String
        : 'POOL_${DateTime.now().millisecondsSinceEpoch}';
    final defList =
        engine.budgetPools.where((p) => p['id'] == poolId).toList();
    final def = defList.isNotEmpty ? defList.first : null;

    final result = await showDialog<PoolDialogResult>(
      context: context,
      builder: (_) => PoolEditorDialog(
        isEdit: isEdit,
        selectedMonth: selectedMonth,
        initialName: isEdit ? (existingPoolStatus['pool_name'] as String) : '',
        initialAlloc: isEdit
            ? (existingPoolStatus['base_allocation'] as String)
            : '300.00',
        initialRollover: (def?['rollover_strategy'] as String?) ?? 'ACCUMULATE',
        initialDescription: (def?['description'] as String?) ?? '',
      ),
    );

    if (result == null) return;
    try {
      engine.upsertBudgetPool(
        id: poolId,
        name: result.name,
        rolloverStrategy: result.rolloverStrategy,
        description: result.description.isEmpty ? null : result.description,
        isMonthlyBudget: true,
      );
      engine.setMonthlyBudget(
        yearMonth: selectedMonth,
        poolId: poolId,
        baseAllocation: result.baseAllocation,
      );
      widget.onEngineChanged();
      if (context.mounted) {
        showLedgerSnackBar(
          context,
          isEdit
              ? '已更新【${result.name}】本月预算'
              : '已创建资金池【${result.name}】',
        );
      }
    } catch (e) {
      if (context.mounted) {
        showLedgerSnackBar(context, '保存预算池失败: $e', isError: true);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final engine = widget.engine;
    final selectedMonth = widget.selectedMonth;
    final dashboard = engine.getMonthlyBudgetDashboard(selectedMonth);
    final dailySummary = engine.getDailyBudgetSummary(selectedMonth);
    final pools =
        (dashboard['pools'] as List<dynamic>).cast<Map<String, dynamic>>();
    final remDays = (dailySummary['remainingDays'] as num?)?.toInt() ?? 15;
    final monthTimeProgress = computeMonthTimeProgress(selectedMonth);

    return RefreshIndicator(
      onRefresh: widget.onPullSync,
      child: Column(
        children: <Widget>[
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
            child: SizedBox(
              width: double.infinity,
              child: SegmentedButton<int>(
                segments: const <ButtonSegment<int>>[
                  ButtonSegment<int>(
                    value: 0,
                    icon: Icon(Icons.account_balance_wallet_outlined),
                    label: Text('月度预算池'),
                  ),
                  ButtonSegment<int>(
                    value: 1,
                    icon: Icon(Icons.flag_outlined),
                    label: Text('专项预算'),
                  ),
                ],
                selected: <int>{_segmentIndex},
                onSelectionChanged: (sel) {
                  setState(() => _segmentIndex = sel.first);
                },
              ),
            ),
          ),
          Expanded(
            child: _segmentIndex == 0
                ? ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.fromLTRB(16, 4, 16, 104),
                    children: <Widget>[
                      LedgerSectionHeader(
                        title: '月度预算池水位 (${pools.length})',
                        bottomPadding: 6,
                        trailing: TextButton.icon(
                          onPressed: () => _openPoolEditorDialog(context),
                          icon: const Icon(Icons.add, size: 18),
                          label: const Text('新增/调配'),
                        ),
                      ),
                      if (pools.isEmpty)
                        const LedgerEmptyStateCard(
                          title: '暂无月度预算池',
                          subtitle:
                              '点击右上角「新增/调配」创建预算池，或通过右下角「+ 记一笔」直接记账',
                        )
                      else
                        for (final pool in pools)
                          PoolWaterCard(
                            engine: engine,
                            pool: pool,
                            remainingDays: remDays,
                            totalDiscount: double.tryParse(
                                  (pool['total_saved_discount'] as String?) ??
                                      '',
                                ) ??
                                0.0,
                            timeProgress: monthTimeProgress,
                            onTap: () => _openPoolEditorDialog(
                              context,
                              existingPoolStatus: pool,
                            ),
                          ),
                    ],
                  )
                : ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.fromLTRB(16, 4, 16, 104),
                    children: <Widget>[
                      ProjectsSection(
                        engine: engine,
                        onEngineChanged: widget.onEngineChanged,
                        onFilterByProject: widget.onFilterByProject,
                      ),
                    ],
                  ),
          ),
        ],
      ),
    );
  }
}
