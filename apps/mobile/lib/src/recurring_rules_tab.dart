import 'package:material_ui/material_ui.dart';

import 'ledger_engine.dart';
import 'recurring/add_rule_dialog.dart';
import 'ui_helpers.dart';
import 'widgets/common_ui.dart';

class RecurringRulesTab extends StatefulWidget {
  const RecurringRulesTab({
    super.key,
    required this.engine,
    required this.onPullSync,
    required this.onEngineChanged,
  });

  final FlutterLedgerEngine engine;
  final Future<void> Function() onPullSync;
  final VoidCallback onEngineChanged;

  @override
  State<RecurringRulesTab> createState() => _RecurringRulesTabState();
}

class _RecurringRulesTabState extends State<RecurringRulesTab> {
  Future<void> _showAddRuleDialog() async {
    final res = await showDialog<AddRuleResult>(
      context: context,
      builder: (_) => AddRuleDialog(budgetPools: widget.engine.budgetPools),
    );
    if (res == null || !mounted) return;
    try {
      widget.engine.upsertRecurringRule(
        title: res.title,
        cronCycle: res.cronCycle,
        triggerDay: res.triggerDay,
        currency: res.currency,
        amount: res.amount,
        budgetPoolId: res.budgetPoolId,
      );
      widget.onEngineChanged();
      showLedgerSnackBar(context, '已新增周期规则【${res.title}】');
    } catch (e) {
      showLedgerSnackBar(context, '保存规则失败: $e', isError: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final engine = widget.engine;

    return RefreshIndicator(
      onRefresh: widget.onPullSync,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 96),
        children: <Widget>[
          LedgerSectionHeader(
            title: '周期性扣款规则 (${engine.recurringRules.length})',
            bottomPadding: 6,
            trailing: TextButton.icon(
              onPressed: _showAddRuleDialog,
              icon: const Icon(Icons.add, size: 18),
              label: const Text('新增规则'),
            ),
          ),
          if (engine.recurringRules.isEmpty)
            const LedgerEmptyStateCard(
              title: '暂无周期性扣款规则，点击右上角「新增规则」创建',
            )
          else
            for (final rule in engine.recurringRules)
              Card(
                margin: const EdgeInsets.only(bottom: 8),
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Row(
                        children: <Widget>[
                          Expanded(
                            child: Text(
                              rule['title'] as String,
                              style:
                                  const TextStyle(fontWeight: FontWeight.w700),
                            ),
                          ),
                          Text(
                            '${rule['currency']} ${rule['amount']}',
                            style: TextStyle(
                              fontWeight: FontWeight.bold,
                              color: cs.primary,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '${rule['cron_cycle'] == 'MONTHLY' ? '每月' : '每年'} 第 ${rule['trigger_day']} 日 · 归属 ${poolNameById(engine, rule['budget_pool_id'] as String?)}',
                        style: Theme.of(context)
                            .textTheme
                            .bodySmall
                            ?.copyWith(color: cs.onSurfaceVariant),
                      ),
                      const SizedBox(height: 8),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.end,
                        children: <Widget>[
                          IconButton(
                            tooltip: '删除规则',
                            icon: const Icon(Icons.delete_outline, size: 19),
                            onPressed: () {
                              engine.deleteRecurringRule(rule['id'] as int);
                              widget.onEngineChanged();
                            },
                          ),
                          const SizedBox(width: 4),
                          FilledButton.tonalIcon(
                            onPressed: () {
                              final tx =
                                  engine.executeRecurringRule(rule['id'] as int);
                              final h = tx['header'] as Map<String, dynamic>;
                              widget.onEngineChanged();
                              showLedgerSnackBar(
                                context,
                                '周期账单已入账: ${h['merchant_or_note']} ¥${h['total_net']}',
                              );
                            },
                            icon: const Icon(Icons.bolt_rounded, size: 16),
                            label: const Text('立即入账'),
                          ),
                        ],
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
