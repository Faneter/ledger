import 'package:material_ui/material_ui.dart';

import 'ledger_engine.dart';
import 'overview/daily_allowance_card.dart';
import 'overview/pool_water_card.dart'
    show PendingFxBanner, computeMonthTimeProgress;
import 'ui_helpers.dart';

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

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final dashboard = engine.getMonthlyBudgetDashboard(selectedMonth);
    final dailySummary = engine.getDailyBudgetSummary(selectedMonth);
    final pools =
        (dashboard['pools'] as List<dynamic>).cast<Map<String, dynamic>>();
    final pendingFxTxs = engine.getPendingFxTransactions();
    final pendingRules = engine.getPendingRecurringRules(selectedMonth);

    final totalMonthBudgetText =
        (dashboard['totalMonthlyBudget'] as String?) ?? '0.00';
    final totalMonthNetSpentText =
        (dashboard['totalMonthlySpent'] as String?) ?? '0.00';
    final totalMonthSavedText =
        (dashboard['totalMonthlySaved'] as String?) ?? '0.00';

    final totalBudget = double.tryParse(totalMonthBudgetText) ?? 0.0;
    final totalSpent = double.tryParse(totalMonthNetSpentText) ?? 0.0;
    final totalSaved = double.tryParse(totalMonthSavedText) ?? 0.0;
    final totalRemaining =
        ((totalBudget * 100).round() - (totalSpent * 100).round()) / 100.0;

    final remDays = (dailySummary['remainingDays'] as num?)?.toInt() ?? 15;
    final monthTimeProgress = computeMonthTimeProgress(selectedMonth);

    String? dailyPoolName;
    for (final p in pools) {
      if (p['pool_id'] == 'POOL_DAILY') {
        dailyPoolName = p['pool_name'] as String?;
        break;
      }
    }
    dailyPoolName ??=
        pools.isNotEmpty ? pools.first['pool_name'] as String? : null;

    return RefreshIndicator(
      onRefresh: onPullSync,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 104),
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

          // 3. Top Hero Card: Scheme B Dual-Metric & Full-Month Segmented Progress
          DailyAllowanceCard(
            dailyAvailableAmount:
                (dailySummary['dailyAvailableAmount'] as String?) ?? '0.00',
            remainingDays: remDays,
            formula: (dailySummary['formula'] as String?) ?? '',
            dailyPoolName: dailyPoolName,
            totalMonthBudget: totalBudget,
            totalMonthNetSpent: totalSpent,
            totalMonthRemaining: totalRemaining,
            totalMonthSaved: totalSaved,
            totalMonthBudgetText: totalMonthBudgetText,
            totalMonthNetSpentText: totalMonthNetSpentText,
            totalMonthSavedText: totalMonthSavedText,
            timeProgress: monthTimeProgress,
          ),
        ],
      ),
    );
  }
}
