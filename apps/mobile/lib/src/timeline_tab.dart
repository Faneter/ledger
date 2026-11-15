// ignore: deprecated_member_use
import 'package:flutter/material.dart';

import 'ledger_engine.dart';
import 'ui_helpers.dart';

class TimelineAndProjectsTab extends StatefulWidget {
  const TimelineAndProjectsTab({
    super.key,
    required this.engine,
    required this.onSettleFx,
    required this.onPullSync,
    required this.onEngineChanged,
  });

  final FlutterLedgerEngine engine;
  final Future<void> Function(Map<String, dynamic> tx) onSettleFx;
  final Future<void> Function() onPullSync;
  final VoidCallback onEngineChanged;

  @override
  State<TimelineAndProjectsTab> createState() => _TimelineAndProjectsTabState();
}

class _TimelineAndProjectsTabState extends State<TimelineAndProjectsTab> {
  int _segmentIndex = 0; // 0 = 按日流水, 1 = 专项立项
  String _keyword = '';
  String _typeFilter = 'ALL'; // ALL | EXPENSE | INCOME | PENDING_HOLD
  String _targetFilter = 'ALL'; // ALL | POOL:<id> | PROJECT:<id>
  final Set<String> _expandedTxIds = <String>{};
  final TextEditingController _searchCtrl = TextEditingController();

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  List<Map<String, dynamic>> _filteredTransactions() {
    final all = widget.engine.getRecentTransactions(200);
    return all.where((tx) {
      final h = tx['header'] as Map<String, dynamic>;
      final items = (tx['items'] as List<dynamic>).cast<Map<String, dynamic>>();

      if (_keyword.trim().isNotEmpty) {
        final kw = _keyword.trim().toLowerCase();
        final note = ((h['merchant_or_note'] as String?) ?? '').toLowerCase();
        final raw = ((h['raw_input_text'] as String?) ?? '').toLowerCase();
        final itemHit = items.any(
          (it) => ((it['item_name'] as String?) ?? '').toLowerCase().contains(kw),
        );
        if (!note.contains(kw) && !raw.contains(kw) && !itemHit) return false;
      }

      if (_typeFilter == 'EXPENSE') {
        if (h['tx_type'] != 'EXPENSE' && h['tx_type'] != 'VOUCHER_BUY') {
          return false;
        }
      } else if (_typeFilter == 'INCOME') {
        if (h['tx_type'] != 'INCOME') return false;
      } else if (_typeFilter == 'PENDING_HOLD') {
        if (h['settlement_status'] != 'PENDING_HOLD') return false;
      }

      if (_targetFilter.startsWith('POOL:')) {
        final poolId = _targetFilter.substring(5);
        final hit = items.any(
          (it) => it['budget_pool_id'] == poolId && it['project_tag_id'] == null,
        );
        if (!hit) return false;
      } else if (_targetFilter.startsWith('PROJECT:')) {
        final tagId = _targetFilter.substring(8);
        final hit = items.any((it) => it['project_tag_id'] == tagId);
        if (!hit) return false;
      }

      return true;
    }).toList();
  }

  void _softDeleteTransaction(BuildContext context, Map<String, dynamic> tx) {
    final h = tx['header'] as Map<String, dynamic>;
    final txId = h['id'] as String;
    final voucherId = h['applied_voucher_id'] as int?;
    String? voucherTitle;
    if (voucherId != null) {
      final match =
          widget.engine.vouchers.where((v) => v['id'] == voucherId).toList();
      if (match.isNotEmpty) {
        voucherTitle = match.first['title'] as String;
      }
    }

    final isVoucherBuy = h['tx_type'] == 'VOUCHER_BUY';
    widget.engine.deleteTransaction(txId);
    _expandedTxIds.remove(txId);
    widget.onEngineChanged();

    final msg = isVoucherBuy
        ? '购券账单已删除（对应卡券已一并移除）'
        : voucherTitle != null
            ? '账单已删除，${voucherTitle}已退回卡包'
            : '已删除账单：${h['merchant_or_note']}';

    showLedgerSnackBar(
      context,
      msg,
      actionLabel: isVoucherBuy ? null : '撤销',
      onAction: isVoucherBuy
          ? null
          : () {
              widget.engine.restoreTransaction(txId);
              widget.onEngineChanged();
            },
    );
  }

  Future<void> _openEditTransactionDialog(Map<String, dynamic> tx) async {
    final h = tx['header'] as Map<String, dynamic>;
    final result = await showDialog<Map<String, String>>(
      context: context,
      builder: (_) => _EditTransactionDialog(
        initialNote: (h['merchant_or_note'] as String?) ?? '',
        initialGross: (h['total_gross'] as String?) ?? '0.00',
        initialDiscount: (h['payment_discount'] as String?) ?? '0.00',
        initialDate: (h['tx_date'] as String?) ?? getLocalTodayDateStr(),
      ),
    );

    if (result != null) {
      try {
        widget.engine.updateTransaction(h['id'] as String, result);
        widget.onEngineChanged();
        if (mounted) showLedgerSnackBar(context, '账单已更新并重算分摊');
      } catch (e) {
        if (mounted) showLedgerSnackBar(context, '更新失败: $e', isError: true);
      }
    }
  }

  Future<void> _openProjectEditorDialog({
    Map<String, dynamic>? existing,
  }) async {
    final isEdit = existing != null;
    final defaultYm = getLocalTodayDateStr().substring(0, 7);
    final result = await showDialog<_ProjectDialogResult>(
      context: context,
      builder: (_) => _ProjectEditorDialog(
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
      widget.engine.upsertProjectTag(
        id: existing?['id'] as String?,
        name: result.name,
        targetBudget: result.targetBudget,
        startDate: result.startDate,
        endDate: result.endDate,
        isActive: result.isActive,
      );
      widget.onEngineChanged();
      if (mounted) {
        showLedgerSnackBar(
          context,
          isEdit ? '专项立项已更新' : '已新增专项【${result.name}】',
        );
      }
    } catch (e) {
      if (mounted) {
        showLedgerSnackBar(context, '保存专项预算失败: $e', isError: true);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
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
                    icon: Icon(Icons.receipt_long_outlined),
                    label: Text('按日流水'),
                  ),
                  ButtonSegment<int>(
                    value: 1,
                    icon: Icon(Icons.flag_outlined),
                    label: Text('专项立项'),
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
                ? _buildTimelineList(context)
                : _buildProjectsView(context),
          ),
        ],
      ),
    );
  }

  Widget _buildTimelineList(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final filtered = _filteredTransactions();

    double sumExpense = 0;
    double sumIncome = 0;
    double sumDiscount = 0;
    for (final tx in filtered) {
      final h = tx['header'] as Map<String, dynamic>;
      final net = double.tryParse((h['total_net'] as String?) ?? '0') ?? 0;
      if (h['tx_type'] == 'INCOME') {
        sumIncome += net;
      } else {
        sumExpense += net;
        final disc =
            double.tryParse((h['payment_discount'] as String?) ?? '0') ?? 0;
        sumDiscount += disc;
      }
    }

    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 96),
      children: <Widget>[
        // Search & Filter strip
        TextField(
          controller: _searchCtrl,
          onChanged: (v) => setState(() => _keyword = v),
          decoration: InputDecoration(
            hintText: '搜索商户名、算式或子商品...',
            prefixIcon: const Icon(Icons.search, size: 20),
            isDense: true,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
            ),
            suffixIcon: _keyword.isNotEmpty
                ? IconButton(
                    icon: const Icon(Icons.close, size: 18),
                    onPressed: () {
                      _searchCtrl.clear();
                      setState(() => _keyword = '');
                    },
                  )
                : null,
          ),
        ),
        const SizedBox(height: 8),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: <Widget>[
              for (final opt in const <(String, String)>[
                ('ALL', '全部'),
                ('EXPENSE', '支出'),
                ('INCOME', '收入'),
                ('PENDING_HOLD', '待清算'),
              ])
                Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: FilterChip(
                    visualDensity: VisualDensity.compact,
                    label: Text(opt.$2),
                    selected: _typeFilter == opt.$1,
                    onSelected: (_) => setState(() => _typeFilter = opt.$1),
                  ),
                ),
              if (_targetFilter != 'ALL')
                InputChip(
                  visualDensity: VisualDensity.compact,
                  selected: true,
                  label: Text(
                    _targetFilter.startsWith('PROJECT:')
                        ? '#${projectTagNameById(widget.engine, _targetFilter.substring(8))}'
                        : poolNameById(widget.engine, _targetFilter.substring(5)),
                  ),
                  onDeleted: () => setState(() => _targetFilter = 'ALL'),
                ),
            ],
          ),
        ),
        const SizedBox(height: 8),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: cs.surfaceContainerHighest.withValues(alpha: 0.45),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Row(
            children: <Widget>[
              Text(
                '${filtered.length} 笔',
                style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  '支出 ¥${sumExpense.toStringAsFixed(2)} · 收入 +¥${sumIncome.toStringAsFixed(2)} · 省 ¥${sumDiscount.toStringAsFixed(2)}',
                  textAlign: TextAlign.end,
                  style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 10),

        if (filtered.isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 48),
            child: Center(
              child: Text('暂无匹配的交易流水，点击右下角「+ 记一笔」开始记录'),
            ),
          )
        else
          for (final tx in filtered) _buildTransactionCard(context, tx),
      ],
    );
  }

  Widget _buildTransactionCard(
    BuildContext context,
    Map<String, dynamic> tx,
  ) {
    final cs = Theme.of(context).colorScheme;
    final h = tx['header'] as Map<String, dynamic>;
    final txId = h['id'] as String;
    final items = (tx['items'] as List<dynamic>).cast<Map<String, dynamic>>();
    final isPendingFx = h['settlement_status'] == 'PENDING_HOLD';
    final isExpanded = _expandedTxIds.contains(txId);
    final isIncome = h['tx_type'] == 'INCOME';
    final hasDiscount =
        (double.tryParse((h['payment_discount'] as String?) ?? '0') ?? 0) > 0;
    final hasVoucher = h['applied_voucher_id'] != null;

    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Dismissible(
        key: ValueKey<String>('tx_dismiss_$txId'),
        direction: DismissDirection.endToStart,
        background: Container(
          alignment: Alignment.centerRight,
          padding: const EdgeInsets.only(right: 20),
          decoration: BoxDecoration(
            color: cs.errorContainer,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Icon(Icons.delete_outline, color: cs.onErrorContainer),
        ),
        onDismissed: (_) => _softDeleteTransaction(context, tx),
        child: Card(
          margin: EdgeInsets.zero,
          child: InkWell(
            borderRadius: BorderRadius.circular(12),
            onTap: () {
              setState(() {
                if (isExpanded) {
                  _expandedTxIds.remove(txId);
                } else {
                  _expandedTxIds.add(txId);
                }
              });
            },
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            Text(
                              h['merchant_or_note'] as String,
                              style: const TextStyle(
                                fontWeight: FontWeight.w700,
                                fontSize: 15,
                              ),
                            ),
                            const SizedBox(height: 3),
                            Text(
                              '${h['tx_date']} · ${h['tx_type']} · 原价 ¥${h['total_gross']}'
                              '${isPendingFx ? ' · 待清算(冻结¥${h['hold_amount_cny']})' : ''}',
                              style: Theme.of(context)
                                  .textTheme
                                  .bodySmall
                                  ?.copyWith(color: cs.onSurfaceVariant),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 8),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: <Widget>[
                          Text(
                            isIncome
                                ? '+¥${h['total_net']}'
                                : '¥${h['total_net']}',
                            style: TextStyle(
                              fontWeight: FontWeight.bold,
                              fontSize: 16,
                              color: isIncome ? Colors.green.shade700 : null,
                            ),
                          ),
                          if (hasDiscount)
                            Text(
                              '省 ¥${h['payment_discount']}',
                              style: TextStyle(
                                fontSize: 11,
                                color: Colors.green.shade700,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                        ],
                      ),
                      if (isPendingFx)
                        IconButton(
                          tooltip: '外币清算',
                          icon: const Icon(Icons.currency_exchange, size: 20),
                          onPressed: () => widget.onSettleFx(tx),
                        ),
                      IconButton(
                        tooltip: '删除流水',
                        icon: const Icon(Icons.delete_outline, size: 20),
                        onPressed: () => _softDeleteTransaction(context, tx),
                      ),
                    ],
                  ),

                  // Collapsed allocation pills (parent-child capsule summary)
                  if (items.isNotEmpty || hasVoucher) ...<Widget>[
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: <Widget>[
                        if (hasVoucher)
                          _miniBadge(
                            '🎟️ 已核销立减金',
                            Colors.green.withValues(alpha: 0.14),
                            Colors.green.shade900,
                          ),
                        if (items.length > 1)
                          for (final it in items)
                            _miniBadge(
                              '${it['item_name']} ¥${it['item_net']}',
                              cs.secondaryContainer.withValues(alpha: 0.7),
                              cs.onSecondaryContainer,
                            )
                        else if (items.length == 1)
                          _miniBadge(
                            items[0]['project_tag_id'] != null
                                ? '🎯 #${projectTagNameById(widget.engine, items[0]['project_tag_id'] as String?)}'
                                : '💰 ${poolNameById(widget.engine, items[0]['budget_pool_id'] as String?)}',
                            cs.surfaceContainerHighest,
                            cs.onSurfaceVariant,
                          ),
                      ],
                    ),
                  ],

                  // In-place Expanded Split Details Drawer
                  if (isExpanded) ...<Widget>[
                    const Divider(height: 20),
                    if (h['raw_input_text'] != null &&
                        h['raw_input_text'] != h['merchant_or_note']) ...<Widget>[
                      Text(
                        '❯_ ${h['raw_input_text']}',
                        style: TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 11,
                          color: cs.onSurfaceVariant,
                        ),
                      ),
                      const SizedBox(height: 8),
                    ],
                    for (var i = 0; i < items.length; i++)
                      _buildExpandedChildRow(context, txId, i, items[i]),
                    const SizedBox(height: 6),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: <Widget>[
                        TextButton.icon(
                          onPressed: () => _openEditTransactionDialog(tx),
                          icon: const Icon(Icons.edit_outlined, size: 16),
                          label: const Text('编辑主账单'),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildExpandedChildRow(
    BuildContext context,
    String txId,
    int index,
    Map<String, dynamic> it,
  ) {
    final cs = Theme.of(context).colorScheme;
    final poolId = it['budget_pool_id'] as String?;
    final tagId = it['project_tag_id'] as String?;
    final tagName = projectTagNameById(widget.engine, tagId);
    final label = tagName != null
        ? '🎯 #$tagName'
        : '💰 ${poolNameById(widget.engine, poolId)}';

    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: cs.surfaceContainerHighest.withValues(alpha: 0.4),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  '${it['item_name']}${it['is_primary_item'] == true ? ' (★ 主商品)' : ''}',
                  style: const TextStyle(
                    fontWeight: FontWeight.w600,
                    fontSize: 13,
                  ),
                ),
                Text(
                  '原价 ¥${it['item_gross']} · 分摊省 ¥${it['allocated_discount']} · 净 ¥${it['item_net']}',
                  style: TextStyle(fontSize: 11, color: cs.onSurfaceVariant),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          InkWell(
            borderRadius: BorderRadius.circular(999),
            onTap: () async {
              final picked = await showTargetPickerSheet(
                context,
                widget.engine,
                currentPoolId: poolId,
                currentProjectTagId: tagId,
                title: '改绑「${it['item_name']}」归属池/专项',
              );
              if (picked == null || !mounted) return;
              widget.engine.updateTransaction(txId, <String, dynamic>{
                'item_updates': <Map<String, dynamic>>[
                  <String, dynamic>{
                    'index': index,
                    'id': it['id'],
                    'budget_pool_id': picked['budget_pool_id'],
                    'project_tag_id': picked['project_tag_id'],
                  },
                ],
              });
              widget.onEngineChanged();
              showLedgerSnackBar(
                context,
                '已重算子项「${it['item_name']}」归属',
              );
            },
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
              decoration: BoxDecoration(
                color: cs.primaryContainer,
                borderRadius: BorderRadius.circular(999),
              ),
              child: Text(
                '$label ▾',
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  color: cs.onPrimaryContainer,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _miniBadge(String text, Color bg, Color fg) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        text,
        style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: fg),
      ),
    );
  }

  Widget _buildProjectsView(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final summary = widget.engine.getProjectTagsSummary();
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
                  onPressed: () => _openProjectEditorDialog(),
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
                _miniBadge(
                  tag['effective_active'] == true ? '进行中' : '已归档',
                  tag['effective_active'] == true
                      ? cs.primaryContainer
                      : cs.surfaceContainerHighest,
                  tag['effective_active'] == true
                      ? cs.onPrimaryContainer
                      : cs.onSurfaceVariant,
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
              LinearProgressIndicator(
                value: ratio,
                minHeight: 6,
                borderRadius: BorderRadius.circular(4),
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
                      onPressed: () {
                        setState(() {
                          _targetFilter = 'PROJECT:${tag['id']}';
                          _segmentIndex = 0;
                        });
                      },
                      child: const Text('查流水'),
                    ),
                    IconButton(
                      visualDensity: VisualDensity.compact,
                      constraints:
                          const BoxConstraints(minWidth: 32, minHeight: 32),
                      padding: const EdgeInsets.all(4),
                      tooltip: '编辑专项',
                      icon: const Icon(Icons.edit_outlined, size: 18),
                      onPressed: () => _openProjectEditorDialog(existing: tag),
                    ),
                    IconButton(
                      visualDensity: VisualDensity.compact,
                      constraints:
                          const BoxConstraints(minWidth: 32, minHeight: 32),
                      padding: const EdgeInsets.all(4),
                      tooltip: '删除专项',
                      icon: const Icon(Icons.delete_outline, size: 18),
                      onPressed: () {
                        try {
                          widget.engine.deleteProjectTag(tag['id'] as String);
                          widget.onEngineChanged();
                        } catch (e) {
                          showLedgerSnackBar(context, '$e', isError: true);
                        }
                      },
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

class _EditTransactionDialog extends StatefulWidget {
  const _EditTransactionDialog({
    required this.initialNote,
    required this.initialGross,
    required this.initialDiscount,
    required this.initialDate,
  });

  final String initialNote;
  final String initialGross;
  final String initialDiscount;
  final String initialDate;

  @override
  State<_EditTransactionDialog> createState() => _EditTransactionDialogState();
}

class _EditTransactionDialogState extends State<_EditTransactionDialog> {
  late final TextEditingController _noteCtrl;
  late final TextEditingController _grossCtrl;
  late final TextEditingController _discCtrl;
  late final TextEditingController _dateCtrl;
  String? _error;

  @override
  void initState() {
    super.initState();
    _noteCtrl = TextEditingController(text: widget.initialNote);
    _grossCtrl = TextEditingController(text: widget.initialGross);
    _discCtrl = TextEditingController(text: widget.initialDiscount);
    _dateCtrl = TextEditingController(text: widget.initialDate);
  }

  @override
  void dispose() {
    _noteCtrl.dispose();
    _grossCtrl.dispose();
    _discCtrl.dispose();
    _dateCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('编辑账单明细'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            TextField(
              controller: _noteCtrl,
              decoration: const InputDecoration(
                labelText: '商户 / 备注',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _dateCtrl,
              decoration: const InputDecoration(
                labelText: '交易日期 (YYYY-MM-DD)',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _grossCtrl,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(
                labelText: '订单原价 (CNY)',
                prefixText: '¥ ',
                border: OutlineInputBorder(),
              ),
              onChanged: (_) {
                if (_error != null) setState(() => _error = null);
              },
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _discCtrl,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(
                labelText: '优惠 / 折扣 (CNY)',
                prefixText: '-¥ ',
                border: OutlineInputBorder(),
              ),
            ),
            if (_error != null) ...<Widget>[
              const SizedBox(height: 8),
              Text(
                _error!,
                style: TextStyle(
                  color: Theme.of(context).colorScheme.error,
                  fontSize: 12,
                ),
              ),
            ],
          ],
        ),
      ),
      actions: <Widget>[
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('取消'),
        ),
        FilledButton(
          onPressed: () {
            final g = double.tryParse(_grossCtrl.text.trim()) ?? 0;
            if (g <= 0) {
              setState(() => _error = '请输入大于 0 的有效金额');
              return;
            }
            Navigator.of(context).pop(<String, String>{
              'tx_date': _dateCtrl.text.trim(),
              'merchant_or_note': _noteCtrl.text.trim(),
              'total_gross': _grossCtrl.text.trim(),
              'payment_discount': _discCtrl.text.trim().isEmpty
                  ? '0.00'
                  : _discCtrl.text.trim(),
            });
          },
          child: const Text('保存重算'),
        ),
      ],
    );
  }
}

class _ProjectDialogResult {
  const _ProjectDialogResult({
    required this.name,
    required this.targetBudget,
    required this.startDate,
    required this.endDate,
    required this.isActive,
  });

  final String name;
  final String targetBudget;
  final String startDate;
  final String endDate;
  final bool isActive;
}

class _ProjectEditorDialog extends StatefulWidget {
  const _ProjectEditorDialog({
    required this.isEdit,
    required this.initialName,
    required this.initialBudget,
    required this.initialStartDate,
    required this.initialEndDate,
    required this.initialActive,
  });

  final bool isEdit;
  final String initialName;
  final String initialBudget;
  final String initialStartDate;
  final String initialEndDate;
  final bool initialActive;

  @override
  State<_ProjectEditorDialog> createState() => _ProjectEditorDialogState();
}

class _ProjectEditorDialogState extends State<_ProjectEditorDialog> {
  late final TextEditingController _nameCtrl;
  late final TextEditingController _budgetCtrl;
  late final TextEditingController _startCtrl;
  late final TextEditingController _endCtrl;
  late bool _isActive;
  String? _error;

  @override
  void initState() {
    super.initState();
    _nameCtrl = TextEditingController(text: widget.initialName);
    _budgetCtrl = TextEditingController(text: widget.initialBudget);
    _startCtrl = TextEditingController(text: widget.initialStartDate);
    _endCtrl = TextEditingController(text: widget.initialEndDate);
    _isActive = widget.initialActive;
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _budgetCtrl.dispose();
    _startCtrl.dispose();
    _endCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(widget.isEdit ? '编辑专项立项' : '新增跨期独立专项预算'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            TextField(
              controller: _nameCtrl,
              decoration: const InputDecoration(
                labelText: '专项名称（如 JLPT_N2考试专项）',
                border: OutlineInputBorder(),
              ),
              onChanged: (_) {
                if (_error != null) setState(() => _error = null);
              },
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _budgetCtrl,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(
                labelText: '总预算目标 (CNY，留空为无限场景)',
                prefixText: '¥ ',
                border: OutlineInputBorder(),
              ),
              onChanged: (_) {
                if (_error != null) setState(() => _error = null);
              },
            ),
            const SizedBox(height: 10),
            Row(
              children: <Widget>[
                Expanded(
                  child: TextField(
                    controller: _startCtrl,
                    decoration: const InputDecoration(
                      labelText: '开始日期 (YYYY-MM-DD)',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    controller: _endCtrl,
                    decoration: const InputDecoration(
                      labelText: '截止日期 (YYYY-MM-DD)',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('进行中 (勾选后在记账标签栏显示)'),
              value: _isActive,
              onChanged: (v) => setState(() => _isActive = v),
            ),
            if (_error != null) ...<Widget>[
              const SizedBox(height: 6),
              Text(
                _error!,
                style: TextStyle(
                  color: Theme.of(context).colorScheme.error,
                  fontSize: 12,
                ),
              ),
            ],
          ],
        ),
      ),
      actions: <Widget>[
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('取消'),
        ),
        FilledButton(
          onPressed: () {
            final cleanName = _nameCtrl.text.trim();
            if (cleanName.isEmpty) {
              setState(() => _error = '请输入专项名称');
              return;
            }
            final rawBudget = _budgetCtrl.text.trim();
            if (rawBudget.isNotEmpty) {
              final val = double.tryParse(rawBudget);
              if (val == null || val < 0) {
                setState(() => _error = '预算目标必须为有效非负数字');
                return;
              }
            }
            Navigator.of(context).pop(
              _ProjectDialogResult(
                name: cleanName,
                targetBudget: rawBudget,
                startDate: _startCtrl.text.trim(),
                endDate: _endCtrl.text.trim(),
                isActive: _isActive,
              ),
            );
          },
          child: const Text('保存'),
        ),
      ],
    );
  }
}
