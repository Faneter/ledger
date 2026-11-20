import 'package:material_ui/material_ui.dart';

import 'ledger_engine.dart';
import 'overview/pool_editor_dialog.dart';
import 'overview/pool_water_card.dart';
import 'ui_helpers.dart';
import 'widgets/common_ui.dart';

class OverviewTab extends StatelessWidget {
  const OverviewTab({
    super.key,
    required this.engine,
    required this.selectedMonth,
    required this.onSettleFx,
    required this.onPullSync,
    required this.onEngineChanged,
  });

  final FlutterLedgerEngine engine;
  final String selectedMonth;
  final Future<void> Function(Map<String, dynamic> tx) onSettleFx;
  final Future<void> Function() onPullSync;
  final VoidCallback onEngineChanged;

  Future<void> _openPoolEditorDialog(
    BuildContext context, {
    Map<String, dynamic>? existingPoolStatus,
  }) async {
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
      onEngineChanged();
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
    final cs = Theme.of(context).colorScheme;
    final dashboard = engine.getMonthlyBudgetDashboard(selectedMonth);
    final dailySummary = engine.getDailyBudgetSummary(selectedMonth);
    final pools =
        (dashboard['pools'] as List<dynamic>).cast<Map<String, dynamic>>();
    final pendingFxTxs = engine.getPendingFxTransactions();
    final pendingRules = engine.getPendingRecurringRules(selectedMonth);

    final totalBudget =
        double.tryParse(dashboard['totalMonthlyBudget'] as String) ?? 0;
    final totalSpent =
        double.tryParse(dashboard['totalMonthlySpent'] as String) ?? 0;
    final totalRatio =
        totalBudget > 0 ? (totalSpent / totalBudget).clamp(0.0, 1.0) : 0.0;
    final remDays = (dailySummary['remainingDays'] as num?)?.toInt() ?? 15;

    return RefreshIndicator(
      onRefresh: onPullSync,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 96),
        children: <Widget>[
          // 1. Dynamic Pending Banner: Foreign Currency Pre-Auth Holds
          if (pendingFxTxs.isNotEmpty) ...<Widget>[
            PendingFxBanner(
              pendingFxTxs: pendingFxTxs,
              onSettleFx: onSettleFx,
            ),
            const SizedBox(height: 10),
          ],

          // 2. Dynamic Pending Banner: Recurring Rules due (swipe left to dismiss, tap to record)
          if (pendingRules.isNotEmpty) ...<Widget>[
            for (final rule in pendingRules)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Dismissible(
                  key: ValueKey<String>('pending_rule_${rule['id']}'),
                  direction: DismissDirection.endToStart,
                  background: Container(
                    alignment: Alignment.centerRight,
                    padding: const EdgeInsets.only(right: 16),
                    decoration: BoxDecoration(
                      color: cs.surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: const Text('左滑忽略'),
                  ),
                  onDismissed: (_) {
                    engine.dismissRecurringRule(rule['id'] as int);
                    onEngineChanged();
                  },
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 10,
                    ),
                    decoration: BoxDecoration(
                      color: cs.secondaryContainer.withValues(alpha: 0.65),
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Row(
                      children: <Widget>[
                        Icon(
                          Icons.event_repeat,
                          size: 18,
                          color: cs.onSecondaryContainer,
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: <Widget>[
                              Text(
                                '本月固定账单待入账 · ${rule['title']}',
                                style: TextStyle(
                                  fontWeight: FontWeight.w600,
                                  fontSize: 13,
                                  color: cs.onSecondaryContainer,
                                ),
                              ),
                              Text(
                                '每月 ${rule['trigger_day']} 日 · ${rule['currency']} ${rule['amount']} (左滑忽略)',
                                style: TextStyle(
                                  fontSize: 11,
                                  color: cs.onSecondaryContainer
                                      .withValues(alpha: 0.8),
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 8),
                        FilledButton.tonal(
                          onPressed: () {
                            final tx =
                                engine.executeRecurringRule(rule['id'] as int);
                            final h = tx['header'] as Map<String, dynamic>;
                            onEngineChanged();
                            showLedgerSnackBar(
                              context,
                              '固定账单已入账: ${h['merchant_or_note']} ¥${h['total_net']}',
                            );
                          },
                          child: const Text('一键入账'),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
          ],

          // 3. Top Core Card: Daily Allowance Gauge (饮食日均仪)
          Semantics(
            container: true,
            label:
                '${dailySummary['poolName']}，今日可用 ${dailySummary['dailyAvailableAmount']} 元每天',
            child: Card(
              color: cs.primaryContainer,
              elevation: 0,
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Expanded(
                          child: Text(
                            dailySummary['poolName'] as String,
                            style: Theme.of(context)
                                .textTheme
                                .titleSmall
                                ?.copyWith(color: cs.onPrimaryContainer),
                          ),
                        ),
                        LedgerBadge(
                          label: '本月薅羊毛已省 ¥${dailySummary['totalSavedWool']}',
                          backgroundColor: Colors.green.withValues(alpha: 0.16),
                          foregroundColor: Colors.green.shade900,
                          fontSize: 11,
                          fontWeight: FontWeight.bold,
                          padding: const EdgeInsets.symmetric(
                            horizontal: 10,
                            vertical: 4,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(
                      '今日可用: ¥${dailySummary['dailyAvailableAmount']} / 天',
                      style: Theme.of(context)
                          .textTheme
                          .headlineSmall
                          ?.copyWith(
                            fontWeight: FontWeight.w800,
                            color: cs.onPrimaryContainer,
                          ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '公式: ${dailySummary['formula']} · 累计省钱 ¥${dailySummary['totalSavedWool']}',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: cs.onPrimaryContainer.withValues(alpha: 0.85),
                          ),
                    ),
                    const SizedBox(height: 10),
                    AccessibleProgressBar(
                      label: '本月总预算已用比例',
                      value: totalRatio,
                      minHeight: 7,
                      color: poolHealthColor(
                        context,
                        remaining: totalBudget - totalSpent,
                        totalAvailable: totalBudget,
                      ),
                      backgroundColor: cs.surface.withValues(alpha: 0.45),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      '$selectedMonth 总预算 ¥${dashboard['totalMonthlyBudget']} · 已支净额 ¥${dashboard['totalMonthlySpent']}',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            fontWeight: FontWeight.w600,
                            color: cs.onPrimaryContainer,
                          ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(height: 16),

          // 4. Monthly Budget Pool Water-Level Progress Bars
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
              subtitle: '点击右上角「新增/调配」创建预算池，或通过右下角「+ 记一笔」直接记账',
            )
          else
            for (final pool in pools)
              PoolWaterCard(
                engine: engine,
                pool: pool,
                remainingDays: remDays,
                onTap: () =>
                    _openPoolEditorDialog(context, existingPoolStatus: pool),
              ),
        ],
      ),
    );
  }
}
