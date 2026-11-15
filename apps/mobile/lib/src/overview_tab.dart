// ignore: deprecated_member_use
import 'package:flutter/material.dart';

import 'ledger_engine.dart';
import 'ui_helpers.dart';

class OverviewTab extends StatelessWidget {
  const OverviewTab({
    super.key,
    required this.engine,
    required this.selectedMonth,
    required this.dslController,
    required this.selectedVoucherId,
    required this.onVoucherChanged,
    required this.onSubmitInlineDsl,
    required this.onOpenQuickSheet,
    required this.onSettleFx,
    required this.onPullSync,
    required this.onEngineChanged,
  });

  final FlutterLedgerEngine engine;
  final String selectedMonth;
  final TextEditingController dslController;
  final int? selectedVoucherId;
  final ValueChanged<int?> onVoucherChanged;
  final VoidCallback onSubmitInlineDsl;
  final VoidCallback onOpenQuickSheet;
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

    final nameCtrl = TextEditingController(
      text: isEdit ? existingPoolStatus['pool_name'] as String : '',
    );
    final allocCtrl = TextEditingController(
      text: isEdit
          ? existingPoolStatus['base_allocation'] as String
          : '300.00',
    );
    final descCtrl = TextEditingController(
      text: (def?['description'] as String?) ?? '',
    );
    var rollover =
        (def?['rollover_strategy'] as String?) ?? 'ACCUMULATE';

    final saved = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLocal) => AlertDialog(
          title: Text(isEdit ? '调配预算池额度' : '新增月度预算池'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                TextField(
                  controller: nameCtrl,
                  decoration: const InputDecoration(
                    labelText: '资金池名称',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: allocCtrl,
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                  decoration: InputDecoration(
                    labelText: '$selectedMonth 基准预算 (CNY)',
                    prefixText: '¥ ',
                    border: const OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  key: ValueKey<String>(rollover),
                  initialValue: rollover,
                  decoration: const InputDecoration(
                    labelText: '跨月结余策略',
                    border: OutlineInputBorder(),
                  ),
                  items: const <DropdownMenuItem<String>>[
                    DropdownMenuItem(
                      value: 'ACCUMULATE',
                      child: Text('结余滚存下月'),
                    ),
                    DropdownMenuItem(
                      value: 'RESET',
                      child: Text('月末清零'),
                    ),
                  ],
                  onChanged: (v) {
                    if (v != null) setLocal(() => rollover = v);
                  },
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: descCtrl,
                  decoration: const InputDecoration(
                    labelText: '用途说明 (选填)',
                    border: OutlineInputBorder(),
                  ),
                ),
              ],
            ),
          ),
          actions: <Widget>[
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: const Text('取消'),
            ),
            FilledButton(
              onPressed: () {
                if (nameCtrl.text.trim().isEmpty) return;
                if ((double.tryParse(allocCtrl.text.trim()) ?? -1) < 0) return;
                Navigator.of(ctx).pop(true);
              },
              child: const Text('保存'),
            ),
          ],
        ),
      ),
    );

    if (saved == true) {
      engine.upsertBudgetPool(
        id: poolId,
        name: nameCtrl.text.trim(),
        rolloverStrategy: rollover,
        description: descCtrl.text.trim().isEmpty ? null : descCtrl.text.trim(),
        isMonthlyBudget: true,
      );
      engine.setMonthlyBudget(
        yearMonth: selectedMonth,
        poolId: poolId,
        baseAllocation: allocCtrl.text.trim(),
      );
      onEngineChanged();
      if (context.mounted) {
        showLedgerSnackBar(
          context,
          isEdit
              ? '已更新【${nameCtrl.text.trim()}】本月预算'
              : '已创建资金池【${nameCtrl.text.trim()}】',
        );
      }
    }

    nameCtrl.dispose();
    allocCtrl.dispose();
    descCtrl.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final dashboard = engine.getMonthlyBudgetDashboard(selectedMonth);
    final dailySummary = engine.getDailyBudgetSummary(selectedMonth);
    final pools = (dashboard['pools'] as List<dynamic>)
        .cast<Map<String, dynamic>>();
    final availableVouchers = engine.vouchers
        .where((v) => v['status'] == 'AVAILABLE')
        .toList();
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
            _buildPendingFxBanner(context, pendingFxTxs),
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
                        Icon(Icons.event_repeat,
                            size: 18, color: cs.onSecondaryContainer),
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
          Card(
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
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 10,
                          vertical: 4,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.green.withValues(alpha: 0.16),
                          borderRadius: BorderRadius.circular(999),
                        ),
                        child: Text(
                          '本月薅羊毛已省 ¥${dailySummary['totalSavedWool']}',
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.bold,
                            color: Colors.green.shade900,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    '今日可用: ¥${dailySummary['dailyAvailableAmount']} / 天',
                    style: Theme.of(context).textTheme.headlineSmall?.copyWith(
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
                  LinearProgressIndicator(
                    value: totalRatio,
                    minHeight: 7,
                    borderRadius: BorderRadius.circular(4),
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
          const SizedBox(height: 12),

          // 4. Quick Inline DSL Input Card (with direct entry into Half-Screen Geek Drawer)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  Row(
                    children: <Widget>[
                      const Expanded(
                        child: Text(
                          '极速记账 DSL（Rust 引擎解析）',
                          style: TextStyle(fontWeight: FontWeight.w600),
                        ),
                      ),
                      TextButton.icon(
                        onPressed: onOpenQuickSheet,
                        icon: const Icon(Icons.tune_rounded, size: 16),
                        label: const Text('拆单/键盘'),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  TextField(
                    controller: dslController,
                    decoration: InputDecoration(
                      hintText:
                          '例: 咸蛋黄拌面 16.8-0.15 #饮食 或 Porkbun \$4.35 冻结31.95',
                      border: const OutlineInputBorder(),
                      suffixIcon: IconButton(
                        icon: const Icon(Icons.send),
                        onPressed: onSubmitInlineDsl,
                      ),
                    ),
                    onSubmitted: (_) => onSubmitInlineDsl(),
                  ),
                  if (availableVouchers.isNotEmpty) ...<Widget>[
                    const SizedBox(height: 8),
                    DropdownButtonFormField<int?>(
                      key: ValueKey<int?>(selectedVoucherId),
                      initialValue: selectedVoucherId,
                      decoration: const InputDecoration(
                        labelText: '叠加卡券核销（可选）',
                        border: OutlineInputBorder(),
                        isDense: true,
                      ),
                      items: <DropdownMenuItem<int?>>[
                        const DropdownMenuItem<int?>(
                          value: null,
                          child: Text('不使用卡券'),
                        ),
                        ...availableVouchers.map(
                          (v) => DropdownMenuItem<int?>(
                            value: v['id'] as int,
                            child: Text(
                              '${v['title']} (成本 ¥${v['acquire_cost']} / 满 ¥${v['min_spend']})',
                            ),
                          ),
                        ),
                      ],
                      onChanged: onVoucherChanged,
                    ),
                  ],
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),

          // 5. Four Monthly Budget Pool Water-Level Progress Bars
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: <Widget>[
              Text(
                '月度预算池水位 (${pools.length})',
                style: Theme.of(context)
                    .textTheme
                    .titleMedium
                    ?.copyWith(fontWeight: FontWeight.bold),
              ),
              TextButton.icon(
                onPressed: () => _openPoolEditorDialog(context),
                icon: const Icon(Icons.add, size: 18),
                label: const Text('新增/调配'),
              ),
            ],
          ),
          const SizedBox(height: 6),
          for (final pool in pools)
            _buildPoolWaterCard(context, pool, remDays),
        ],
      ),
    );
  }

  Widget _buildPendingFxBanner(
    BuildContext context,
    List<Map<String, dynamic>> pendingFxTxs,
  ) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.orange.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: Colors.orange.shade400),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Icon(Icons.hourglass_top_rounded,
                  size: 18, color: Colors.orange.shade800),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  '有 ${pendingFxTxs.length} 笔外币待清算（点击快速输入银行实付解冻）',
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 13,
                    color: Colors.orange.shade900,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          for (final tx in pendingFxTxs)
            Builder(
              builder: (ctx) {
                final h = tx['header'] as Map<String, dynamic>;
                return Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Row(
                    children: <Widget>[
                      Expanded(
                        child: Text(
                          '${h['merchant_or_note']} · ${h['original_currency']} ${h['original_amount']} (冻结 ¥${h['hold_amount_cny']})',
                          style: const TextStyle(fontSize: 12),
                        ),
                      ),
                      const SizedBox(width: 8),
                      FilledButton.tonalIcon(
                        onPressed: () => onSettleFx(tx),
                        icon: const Icon(Icons.currency_exchange, size: 15),
                        label: const Text('清算'),
                      ),
                    ],
                  ),
                );
              },
            ),
        ],
      ),
    );
  }

  Widget _buildPoolWaterCard(
    BuildContext context,
    Map<String, dynamic> pool,
    int remainingDays,
  ) {
    final cs = Theme.of(context).colorScheme;
    final poolId = pool['pool_id'] as String;
    final defList =
        engine.budgetPools.where((p) => p['id'] == poolId).toList();
    final def = defList.isNotEmpty ? defList.first : null;
    final rollover = def?['rollover_strategy'] == 'RESET' ? '清零' : '滚存';

    final avail =
        double.tryParse(pool['total_available_budget'] as String) ?? 0;
    final spent = double.tryParse(pool['spent_net'] as String) ?? 0;
    final remaining = double.tryParse(pool['remaining_budget'] as String) ?? 0;
    final progress = avail > 0 ? (spent / avail).clamp(0.0, 1.0) : 0.0;
    final statusColor = poolHealthColor(
      context,
      remaining: remaining,
      totalAvailable: avail,
    );
    final perDay =
        ((remaining > 0 ? remaining : 0.0) / remainingDays).toStringAsFixed(2);

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => _openPoolEditorDialog(context, existingPoolStatus: pool),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(
                children: <Widget>[
                  Expanded(
                    child: Row(
                      children: <Widget>[
                        Flexible(
                          child: Text(
                            pool['pool_name'] as String,
                            style: const TextStyle(
                              fontWeight: FontWeight.w700,
                              fontSize: 15,
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        const SizedBox(width: 6),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 6,
                            vertical: 1,
                          ),
                          decoration: BoxDecoration(
                            color: cs.surfaceContainerHighest,
                            borderRadius: BorderRadius.circular(999),
                          ),
                          child: Text(
                            rollover,
                            style: TextStyle(
                              fontSize: 10,
                              color: cs.onSurfaceVariant,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  Text(
                    '¥${pool['remaining_budget']}',
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.bold,
                          color: statusColor,
                        ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              LinearProgressIndicator(
                value: progress,
                minHeight: 6,
                borderRadius: BorderRadius.circular(4),
                color: statusColor,
                backgroundColor: cs.surfaceContainerHighest,
              ),
              const SizedBox(height: 8),
              Text(
                '可用 ¥${pool['total_available_budget']} · 日均 ¥$perDay/天 · 已用 ¥${pool['spent_net']} · 优惠 ¥${pool['total_saved_discount']}',
                style: Theme.of(context)
                    .textTheme
                    .bodySmall
                    ?.copyWith(color: cs.onSurfaceVariant),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
