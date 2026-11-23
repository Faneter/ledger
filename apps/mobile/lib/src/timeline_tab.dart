import 'package:material_ui/material_ui.dart';

import 'ledger_engine.dart';
import 'timeline/projects_view.dart';
import 'timeline/transaction_card.dart';
import 'timeline/transaction_dialogs.dart';
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
  int _cachedTxVersion = -1;
  String _cachedKeyword = '';
  String _cachedTypeFilter = 'ALL';
  String _cachedTargetFilter = 'ALL';
  List<Map<String, dynamic>> _cachedFilteredTxs = const <Map<String, dynamic>>[];

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  List<Map<String, dynamic>> _filteredTransactions() {
    final currentVersion = widget.engine.stateVersion;
    if (_cachedTxVersion == currentVersion &&
        _cachedKeyword == _keyword &&
        _cachedTypeFilter == _typeFilter &&
        _cachedTargetFilter == _targetFilter) {
      return _cachedFilteredTxs;
    }
    final all = widget.engine.getRecentTransactions(200);
    final result = all.where((tx) {
      final h = tx['header'] as Map<String, dynamic>;
      final items = (tx['items'] as List<dynamic>).cast<Map<String, dynamic>>();

      if (_keyword.trim().isNotEmpty) {
        final kw = _keyword.trim().toLowerCase();
        final note = ((h['merchant_or_note'] as String?) ?? '').toLowerCase();
        final raw = ((h['raw_input_text'] as String?) ?? '').toLowerCase();
        final itemHit = items.any(
          (it) =>
              ((it['item_name'] as String?) ?? '').toLowerCase().contains(kw),
        );
        if (!note.contains(kw) && !raw.contains(kw) && !itemHit) return false;
      }

      if (_typeFilter == 'EXPENSE') {
        if (h['tx_type'] != 'EXPENSE') {
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
          (it) =>
              it['budget_pool_id'] == poolId && it['project_tag_id'] == null,
        );
        if (!hit) return false;
      } else if (_targetFilter.startsWith('PROJECT:')) {
        final tagId = _targetFilter.substring(8);
        final hit = items.any((it) => it['project_tag_id'] == tagId);
        if (!hit) return false;
      }

      return true;
    }).toList();
    _cachedTxVersion = currentVersion;
    _cachedKeyword = _keyword;
    _cachedTypeFilter = _typeFilter;
    _cachedTargetFilter = _targetFilter;
    _cachedFilteredTxs = result;
    return result;
  }

  void _softDeleteTransaction(BuildContext context, Map<String, dynamic> tx) {
    final h = tx['header'] as Map<String, dynamic>;
    final txId = h['id'] as String;

    widget.engine.deleteTransaction(txId);
    _expandedTxIds.remove(txId);
    widget.onEngineChanged();

    showLedgerSnackBar(
      context,
      '已删除账单：${h['merchant_or_note']}',
      actionLabel: '撤销',
      onAction: () {
        widget.engine.restoreTransaction(txId);
        widget.onEngineChanged();
      },
    );
  }

  Future<void> _rebindTransactionItem(
    String txId,
    int index,
    Map<String, dynamic> it,
  ) async {
    final picked = await showTargetPickerSheet(
      context,
      widget.engine,
      currentPoolId: it['budget_pool_id'] as String?,
      currentProjectTagId: it['project_tag_id'] as String?,
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
  }

  Future<void> _openEditTransactionDialog(Map<String, dynamic> tx) async {
    final h = tx['header'] as Map<String, dynamic>;
    final result = await showDialog<Map<String, String>>(
      context: context,
      builder: (_) => EditTransactionDialog(
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

  void _deleteProjectTag(String tagId) {
    try {
      widget.engine.deleteProjectTag(tagId);
      widget.onEngineChanged();
    } catch (e) {
      showLedgerSnackBar(context, '$e', isError: true);
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
                : ProjectsView(
                    engine: widget.engine,
                    onOpenProjectEditor: _openProjectEditorDialog,
                    onDeleteProject: _deleteProjectTag,
                    onFilterByProject: (tagId) {
                      setState(() {
                        _targetFilter = 'PROJECT:$tagId';
                        _segmentIndex = 0;
                      });
                    },
                  ),
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

    return CustomScrollView(
      physics: const AlwaysScrollableScrollPhysics(),
      slivers: <Widget>[
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 10),
          sliver: SliverToBoxAdapter(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
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
                            onSelected: (_) =>
                                setState(() => _typeFilter = opt.$1),
                          ),
                        ),
                      if (_targetFilter != 'ALL')
                        InputChip(
                          visualDensity: VisualDensity.compact,
                          selected: true,
                          label: Text(
                            _targetFilter.startsWith('PROJECT:')
                                ? '#${projectTagNameById(widget.engine, _targetFilter.substring(8))}'
                                : poolNameById(
                                    widget.engine,
                                    _targetFilter.substring(5),
                                  ),
                          ),
                          onDeleted: () =>
                              setState(() => _targetFilter = 'ALL'),
                        ),
                    ],
                  ),
                ),
                const SizedBox(height: 8),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(
                    color: cs.surfaceContainerHighest.withValues(alpha: 0.45),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Row(
                    children: <Widget>[
                      Text(
                        '${filtered.length} 笔',
                        style: const TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 12,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          '支出 ¥${sumExpense.toStringAsFixed(2)} · 收入 +¥${sumIncome.toStringAsFixed(2)} · 省 ¥${sumDiscount.toStringAsFixed(2)}',
                          textAlign: TextAlign.end,
                          style: TextStyle(
                            fontSize: 12,
                            color: cs.onSurfaceVariant,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
        if (filtered.isEmpty)
          const SliverFillRemaining(
            hasScrollBody: false,
            child: Padding(
              padding: EdgeInsets.fromLTRB(16, 48, 16, 96),
              child: Center(
                child: Text('暂无匹配的交易流水，点击右下角「+ 记一笔」开始记录'),
              ),
            ),
          )
        else
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 96),
            sliver: SliverList.builder(
              itemCount: filtered.length,
              itemBuilder: (context, index) {
                final tx = filtered[index];
                final h = tx['header'] as Map<String, dynamic>;
                final txId = h['id'] as String;
                final isExpanded = _expandedTxIds.contains(txId);
                return TransactionCard(
                  engine: widget.engine,
                  tx: tx,
                  isExpanded: isExpanded,
                  onToggleExpand: () {
                    setState(() {
                      if (isExpanded) {
                        _expandedTxIds.remove(txId);
                      } else {
                        _expandedTxIds.add(txId);
                      }
                    });
                  },
                  onDelete: () => _softDeleteTransaction(context, tx),
                  onEdit: () => _openEditTransactionDialog(tx),
                  onSettleFx: () => widget.onSettleFx(tx),
                  onRebindItem: (itemIdx, item) =>
                      _rebindTransactionItem(txId, itemIdx, item),
                );
              },
            ),
          ),
      ],
    );
  }
}
