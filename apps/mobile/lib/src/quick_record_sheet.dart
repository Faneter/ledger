import 'package:material_ui/material_ui.dart';

import 'ledger_engine.dart';
import 'ui_helpers.dart';

/// Opens the mobile "Geek Formula & Visual Record" bottom sheet.
/// Returns the created transaction map when submitted, or `null` if dismissed.
Future<Map<String, dynamic>?> showQuickRecordModal(
  BuildContext context,
  FlutterLedgerEngine engine, {
  String initialMode = 'dsl',
  String? initialDsl,
}) {
  return showModalBottomSheet<Map<String, dynamic>>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    showDragHandle: true,
    builder: (ctx) => QuickRecordSheet(
      engine: engine,
      initialMode: initialMode,
      initialDsl: initialDsl,
    ),
  );
}

class QuickRecordSheet extends StatefulWidget {
  const QuickRecordSheet({
    super.key,
    required this.engine,
    this.initialMode = 'dsl',
    this.initialDsl,
  });

  final FlutterLedgerEngine engine;
  final String initialMode;
  final String? initialDsl;

  @override
  State<QuickRecordSheet> createState() => _QuickRecordSheetState();
}

class _QuickRecordSheetState extends State<QuickRecordSheet> {
  late String _mode;
  late String _txDate;

  // DSL mode state
  late final TextEditingController _dslCtrl;
  final FocusNode _dslFocus = FocusNode();
  bool _showTagBar = false;
  int? _selectedVoucherIdDsl;
  int? _primaryItemOverrideIndex;
  final Map<int, Map<String, String?>> _itemTargetOverrides =
      <int, Map<String, String?>>{};
  String? _errorMsg;

  // Visual mode state
  String _txType = 'EXPENSE';
  final TextEditingController _amountCtrl = TextEditingController();
  final TextEditingController _discountCtrl = TextEditingController();
  final TextEditingController _noteCtrl = TextEditingController();
  final TextEditingController _holdCnyCtrl = TextEditingController();
  late final TextEditingController _fxHoldPctCtrl;
  late final TextEditingController _fxCashbackPctCtrl;
  String _currency = 'CNY';
  String _targetType = 'NONE';
  String _targetId = '';
  int? _selectedVoucherIdVisual;

  @override
  void initState() {
    super.initState();
    _mode = widget.initialMode;
    _txDate = getLocalTodayDateStr();
    _dslCtrl = TextEditingController(text: widget.initialDsl ?? '');
    _fxHoldPctCtrl = TextEditingController(
      text: decimalRateToPercentText(
        widget.engine.settings['fx_default_hold_ratio'] ?? '1.020',
        decimals: 1,
      ),
    );
    _fxCashbackPctCtrl = TextEditingController(
      text: decimalRateToPercentText(
        widget.engine.settings['fx_default_cashback_rate'] ?? '0.0100',
      ),
    );
    if (widget.engine.budgetPools.isNotEmpty) {
      final daily = widget.engine.budgetPools
          .where((p) => p['id'] == 'POOL_DAILY')
          .toList();
      _targetType = 'POOL';
      _targetId = (daily.isNotEmpty
          ? daily.first['id']
          : widget.engine.budgetPools.first['id']) as String;
    } else {
      final activeTags = widget.engine.projectTags
          .where((t) => t['is_active'] != false)
          .toList();
      if (activeTags.isNotEmpty) {
        _targetType = 'PROJECT';
        _targetId = activeTags.first['id'] as String;
      }
    }
  }

  @override
  void dispose() {
    _dslCtrl.dispose();
    _dslFocus.dispose();
    _amountCtrl.dispose();
    _discountCtrl.dispose();
    _noteCtrl.dispose();
    _holdCnyCtrl.dispose();
    _fxHoldPctCtrl.dispose();
    _fxCashbackPctCtrl.dispose();
    super.dispose();
  }

  void _insertToken(String token) {
    final text = _dslCtrl.text;
    final sel = _dslCtrl.selection;
    final int start;
    final int end;
    if (sel.isValid && sel.start >= 0 && sel.end <= text.length) {
      start = sel.start;
      end = sel.end;
    } else {
      start = text.length;
      end = text.length;
    }
    final nextText = text.replaceRange(start, end, token);
    _dslCtrl.value = TextEditingValue(
      text: nextText,
      selection: TextSelection.collapsed(offset: start + token.length),
    );
    _dslFocus.requestFocus();
    setState(() {
      _errorMsg = null;
    });
  }

  Future<void> _pickDate() async {
    final parsed = DateTime.tryParse('${_txDate}T00:00:00') ?? DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: parsed,
      firstDate: DateTime(2020),
      lastDate: DateTime(2035),
    );
    if (picked != null && mounted) {
      setState(() {
        _txDate = getLocalTodayDateStr(picked);
      });
    }
  }

  Map<String, dynamic>? _compilePreview() {
    final raw = _dslCtrl.text.trim();
    if (raw.isEmpty) return null;
    try {
      return widget.engine.previewDsl(
        raw,
        appliedVoucherId: _selectedVoucherIdDsl,
        primaryItemOverrideIndex: _primaryItemOverrideIndex,
        itemTargetOverrides:
            _itemTargetOverrides.isEmpty ? null : _itemTargetOverrides,
      );
    } catch (_) {
      return null;
    }
  }

  void _submitDsl() {
    final raw = _dslCtrl.text.trim();
    if (raw.isEmpty) {
      setState(() => _errorMsg = '请输入记账算式，例如：牛奶 28 + 排针 15 = 40');
      return;
    }
    try {
      final tx = widget.engine.recordFromDsl(
        raw,
        txDate: _txDate,
        appliedVoucherId: _selectedVoucherIdDsl,
        primaryItemOverrideIndex: _primaryItemOverrideIndex,
        itemTargetOverrides:
            _itemTargetOverrides.isEmpty ? null : _itemTargetOverrides,
      );
      Navigator.of(context).pop(tx);
    } catch (e) {
      setState(() => _errorMsg = e.toString());
    }
  }

  void _submitVisual() {
    final amtNum = double.tryParse(_amountCtrl.text.trim());
    if (amtNum == null || amtNum <= 0) {
      setState(() => _errorMsg = '请输入大于 0 的有效金额');
      return;
    }
    try {
      final note = _noteCtrl.text.trim().isNotEmpty
          ? _noteCtrl.text.trim()
          : (_txType == 'INCOME'
              ? '日常收入'
              : _targetType == 'PROJECT'
                  ? (projectTagNameById(widget.engine, _targetId) ?? '专项支出')
                  : _targetType == 'POOL'
                      ? poolNameById(widget.engine, _targetId)
                      : '日常支出');

      String? poolId;
      String? tagId;
      if (_targetType == 'PROJECT' && _targetId.isNotEmpty) {
        tagId = _targetId;
        poolId = widget.engine.budgetPools.any((p) => p['id'] == 'POOL_FLEX')
            ? 'POOL_FLEX'
            : null;
      } else if (_targetType == 'POOL' && _targetId.isNotEmpty) {
        poolId = _targetId;
      }

      final holdRatioPct = double.tryParse(_fxHoldPctCtrl.text.trim()) ?? 102.0;
      final cashbackPct =
          double.tryParse(_fxCashbackPctCtrl.text.trim()) ?? 1.0;

      final tx = widget.engine.recordManualTransaction(
        txType: _txType,
        txDate: _txDate,
        amount: _amountCtrl.text.trim(),
        discount: _txType == 'EXPENSE' && _discountCtrl.text.trim().isNotEmpty
            ? _discountCtrl.text.trim()
            : '0.00',
        budgetPoolId: poolId,
        projectTagId: tagId,
        merchantOrNote: note,
        currency: _txType == 'EXPENSE' ? _currency : 'CNY',
        holdAmountCny: _holdCnyCtrl.text.trim().isNotEmpty
            ? _holdCnyCtrl.text.trim()
            : null,
        fxHoldRatio: (holdRatioPct / 100).toStringAsFixed(3),
        fxCashbackRate: (cashbackPct / 100).toStringAsFixed(4),
        appliedVoucherId:
            _txType == 'EXPENSE' ? _selectedVoucherIdVisual : null,
      );
      Navigator.of(context).pop(tx);
    } catch (e) {
      setState(() => _errorMsg = e.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final bottomInset = MediaQuery.viewInsetsOf(context).bottom;
    final availableVouchers = widget.engine.vouchers
        .where((v) => v['status'] == 'AVAILABLE')
        .toList();

    return Padding(
      padding: EdgeInsets.only(bottom: bottomInset),
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(context).height * 0.88,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            // Top bar: Title + Mode SegmentedButton
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 12, 8),
              child: Row(
                children: <Widget>[
                  Expanded(
                    child: SegmentedButton<String>(
                      showSelectedIcon: false,
                      segments: const <ButtonSegment<String>>[
                        ButtonSegment<String>(
                          value: 'dsl',
                          icon: Icon(Icons.bolt_outlined, size: 18),
                          label: Text('极速算式'),
                        ),
                        ButtonSegment<String>(
                          value: 'visual',
                          icon: Icon(Icons.edit_note_outlined, size: 18),
                          label: Text('可视化表单'),
                        ),
                      ],
                      selected: <String>{_mode},
                      onSelectionChanged: (sel) {
                        setState(() {
                          _mode = sel.first;
                          _errorMsg = null;
                        });
                      },
                    ),
                  ),
                  const SizedBox(width: 8),
                  ActionChip(
                    avatar: const Icon(Icons.calendar_today_outlined, size: 15),
                    label: Text(_txDate.substring(5)),
                    onPressed: _pickDate,
                  ),
                ],
              ),
            ),

            const Divider(height: 1),

            // Scrollable workspace body
            Flexible(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
                child: _mode == 'dsl'
                    ? _buildDslWorkspace(cs, availableVouchers)
                    : _buildVisualWorkspace(cs, availableVouchers),
              ),
            ),

            if (_errorMsg != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                child: Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: cs.errorContainer,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    _errorMsg!,
                    style: TextStyle(color: cs.onErrorContainer, fontSize: 12),
                  ),
                ),
              ),

            // Pinned Accessory Bar for DSL mode
            if (_mode == 'dsl') _buildDslAccessoryArea(cs),
          ],
        ),
      ),
    );
  }

  Widget _buildDslWorkspace(
    ColorScheme cs,
    List<Map<String, dynamic>> availableVouchers,
  ) {
    final preview = _compilePreview();
    final parsed = preview?['parsed'] as Map<String, dynamic>?;
    final parsedItems = parsed != null
        ? (parsed['items'] as List<dynamic>)
            .map((e) => Map<String, dynamic>.from(e as Map<dynamic, dynamic>))
            .toList()
        : <Map<String, dynamic>>[];
    final eligibleVouchers = preview != null
        ? (preview['eligible_vouchers'] as List<dynamic>)
            .map((e) => Map<String, dynamic>.from(e as Map<dynamic, dynamic>))
            .toList()
        : <Map<String, dynamic>>[];
    final voucherError = preview?['voucher_error'] as String?;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Row(
          children: <Widget>[
            Expanded(
              child: Text(
                '输入算式，支持凑单分摊、* 主商品、#标签 与 \$外币',
                style: Theme.of(context)
                    .textTheme
                    .bodySmall
                    ?.copyWith(color: cs.onSurfaceVariant),
              ),
            ),
            TextButton(
              onPressed: () {
                setState(() {
                  _dslCtrl.text = '牛奶 28 + 晾衣架 12 + 排针 15 = 50';
                  _primaryItemOverrideIndex = null;
                  _itemTargetOverrides.clear();
                  _errorMsg = null;
                });
              },
              child: const Text('填入凑单示例'),
            ),
          ],
        ),
        const SizedBox(height: 6),
        TextField(
          controller: _dslCtrl,
          focusNode: _dslFocus,
          autofocus: true,
          maxLines: 2,
          minLines: 1,
          textInputAction: TextInputAction.done,
          onChanged: (_) => setState(() {
            _errorMsg = null;
          }),
          onSubmitted: (_) => _submitDsl(),
          decoration: InputDecoration(
            prefixText: '❯_ ',
            prefixStyle: TextStyle(
              color: cs.primary,
              fontWeight: FontWeight.bold,
              fontFamily: 'monospace',
            ),
            hintText: '例: *单片机 35 #弹性 + 抽纸 15 #饮食 = 40',
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
            ),
            suffixIcon: Row(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                if (_dslCtrl.text.isNotEmpty)
                  IconButton(
                    tooltip: '清空',
                    icon: const Icon(Icons.close, size: 18),
                    onPressed: () {
                      _dslCtrl.clear();
                      setState(() {
                        _primaryItemOverrideIndex = null;
                        _itemTargetOverrides.clear();
                        _selectedVoucherIdDsl = null;
                        _errorMsg = null;
                      });
                    },
                  ),
                IconButton(
                  tooltip: '立即入账',
                  icon: Icon(Icons.send_rounded, color: cs.primary),
                  onPressed: _submitDsl,
                ),
              ],
            ),
          ),
        ),

        // Smart Voucher Chips (only shown when eligible vouchers exist)
        if (eligibleVouchers.isNotEmpty) ...<Widget>[
          const SizedBox(height: 10),
          Text(
            '可用卡券智能挂载',
            style: Theme.of(context)
                .textTheme
                .labelMedium
                ?.copyWith(color: cs.primary, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 6),
          Wrap(
            spacing: 8,
            runSpacing: 6,
            children: <Widget>[
              for (final v in eligibleVouchers)
                FilterChip(
                  selected: _selectedVoucherIdDsl == v['id'],
                  selectedColor: cs.primaryContainer,
                  label: Text(
                    '🎟️ 可用：${v['title']} (净省 ¥${v['net_savings']})',
                    style: const TextStyle(fontSize: 12),
                  ),
                  onSelected: (selected) {
                    setState(() {
                      _selectedVoucherIdDsl = selected ? (v['id'] as int) : null;
                      _errorMsg = null;
                    });
                  },
                ),
            ],
          ),
        ] else if (availableVouchers.isNotEmpty && parsed != null) ...<Widget>[
          const SizedBox(height: 8),
          Text(
            '卡包有 ${availableVouchers.length} 张可用券，达到使用门槛后将自动亮起挂载芯片',
            style: Theme.of(context)
                .textTheme
                .bodySmall
                ?.copyWith(color: cs.onSurfaceVariant),
          ),
        ],

        if (voucherError != null) ...<Widget>[
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: cs.tertiaryContainer,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(
              voucherError,
              style: TextStyle(color: cs.onTertiaryContainer, fontSize: 12),
            ),
          ),
        ],

        if (preview?['is_fx_detected'] == true) ...<Widget>[
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: BoxDecoration(
              color: Colors.orange.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: Colors.orange.withValues(alpha: 0.4)),
            ),
            child: Row(
              children: <Widget>[
                Icon(Icons.currency_exchange,
                    size: 16, color: Colors.orange.shade800),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    '已识别外币消费 (${parsed?['original_currency']} ${parsed?['original_amount']})，将按预授权冻结 ¥${parsed?['hold_amount_cny']} 挂起待清算',
                    style: TextStyle(
                      fontSize: 12,
                      color: Colors.orange.shade900,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],

        // Live Split Preview Sandbox
        if (parsed != null && parsedItems.isNotEmpty) ...<Widget>[
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: cs.surfaceContainerHighest.withValues(alpha: 0.45),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: cs.outlineVariant),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Row(
                  children: <Widget>[
                    Expanded(
                      child: Wrap(
                        spacing: 6,
                        runSpacing: 4,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: <Widget>[
                          Text(
                            '实时拆单沙盒',
                            style: Theme.of(context)
                                .textTheme
                                .labelLarge
                                ?.copyWith(
                                  fontWeight: FontWeight.bold,
                                  color: cs.primary,
                                ),
                          ),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 7,
                              vertical: 2,
                            ),
                            decoration: BoxDecoration(
                              color: cs.secondaryContainer,
                              borderRadius: BorderRadius.circular(999),
                            ),
                            child: Text(
                              formatAllocationMode(
                                parsed['allocation_mode'] as String?,
                              ),
                              style: TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.w600,
                                color: cs.onSecondaryContainer,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      '实付 ¥${parsed['total_net']}',
                      style: Theme.of(context).textTheme.titleSmall?.copyWith(
                            fontWeight: FontWeight.bold,
                            color: cs.primary,
                          ),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  '原价 ¥${parsed['total_gross']} · 优惠 -¥${parsed['payment_discount']} · 点击商品名设 * 主商品，点击池子改绑',
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall
                      ?.copyWith(color: cs.onSurfaceVariant, fontSize: 11),
                ),
                const SizedBox(height: 10),
                for (var i = 0; i < parsedItems.length; i++)
                  _buildPreviewItemTile(cs, i, parsedItems[i]),
              ],
            ),
          ),
        ],

        const SizedBox(height: 12),
        FilledButton.icon(
          onPressed: _submitDsl,
          icon: const Icon(Icons.check_rounded),
          label: Text(
            parsed != null
                ? '确认入账 · ¥${parsed['total_net']}'
                : '立即入账',
          ),
        ),
      ],
    );
  }

  Widget _buildPreviewItemTile(
    ColorScheme cs,
    int index,
    Map<String, dynamic> item,
  ) {
    final isPrimary = item['is_primary_item'] == true;
    final poolId = item['budget_pool_id'] as String?;
    final projectTagId = item['project_tag_id'] as String?;
    final projectTagName = projectTagNameById(widget.engine, projectTagId);
    final poolLabel = projectTagName != null
        ? '🎯 #$projectTagName'
        : '💰 ${poolNameById(widget.engine, poolId)}';
    final allocDiscount = item['allocated_discount'] as String? ?? '0.00';

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: isPrimary
            ? cs.primaryContainer.withValues(alpha: 0.45)
            : cs.surface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: isPrimary ? cs.primary : cs.outlineVariant,
        ),
      ),
      child: Row(
        children: <Widget>[
          Expanded(
            child: InkWell(
              borderRadius: BorderRadius.circular(8),
              onTap: () {
                setState(() {
                  if (isPrimary) {
                    _primaryItemOverrideIndex = -1;
                  } else {
                    _primaryItemOverrideIndex = index;
                  }
                });
              },
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Row(
                      children: <Widget>[
                        Flexible(
                          child: Text(
                            item['item_name'] as String,
                            style: const TextStyle(
                              fontWeight: FontWeight.w700,
                              fontSize: 13,
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
                            color: isPrimary
                                ? cs.primary
                                : cs.surfaceContainerHighest,
                            borderRadius: BorderRadius.circular(999),
                          ),
                          child: Text(
                            isPrimary ? '★ 主商品' : '设为主商品',
                            style: TextStyle(
                              fontSize: 10,
                              fontWeight: FontWeight.w600,
                              color: isPrimary
                                  ? cs.onPrimary
                                  : cs.onSurfaceVariant,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '原价 ¥${item['item_gross']}'
                      '${allocDiscount != '0.00' ? ' · 省 ¥$allocDiscount' : ''}',
                      style: TextStyle(
                        fontSize: 11,
                        color: cs.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(width: 8),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: <Widget>[
              Text(
                '¥${item['item_net']}',
                style: TextStyle(
                  fontWeight: FontWeight.bold,
                  fontSize: 14,
                  color: cs.primary,
                ),
              ),
              const SizedBox(height: 4),
              InkWell(
                borderRadius: BorderRadius.circular(999),
                onTap: () async {
                  final picked = await showTargetPickerSheet(
                    context,
                    widget.engine,
                    currentPoolId: poolId,
                    currentProjectTagId: projectTagId,
                    title: '调整「${item['item_name']}」归属',
                  );
                  if (picked != null && mounted) {
                    setState(() {
                      _itemTargetOverrides[index] = picked;
                    });
                  }
                },
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: cs.secondaryContainer.withValues(alpha: 0.7),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    '$poolLabel ▾',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: cs.onSecondaryContainer,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildDslAccessoryArea(ColorScheme cs) {
    final activeTags =
        widget.engine.projectTags.where((t) => t['is_active'] != false).toList();
    return Container(
      decoration: BoxDecoration(
        color: cs.surfaceContainerLow,
        border: Border(top: BorderSide(color: cs.outlineVariant)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          if (_showTagBar)
            SizedBox(
              height: 44,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                children: <Widget>[
                  if (widget.engine.budgetPools.isEmpty && activeTags.isEmpty)
                    ActionChip(
                      visualDensity: VisualDensity.compact,
                      label: const Text('暂无预算池或专项标签'),
                      onPressed: () => setState(() => _showTagBar = false),
                    ),
                  for (final pool in widget.engine.budgetPools)
                    Padding(
                      padding: const EdgeInsets.only(right: 6),
                      child: ActionChip(
                        visualDensity: VisualDensity.compact,
                        label: Text(dslTagForPool(pool)),
                        onPressed: () {
                          _insertToken(' ${dslTagForPool(pool)} ');
                          setState(() => _showTagBar = false);
                        },
                      ),
                    ),
                  for (final tag in activeTags)
                    Padding(
                      padding: const EdgeInsets.only(right: 6),
                      child: ActionChip(
                        visualDensity: VisualDensity.compact,
                        avatar: Icon(Icons.flag_outlined,
                            size: 14, color: cs.secondary),
                        label: Text('#${tag['name']}'),
                        onPressed: () {
                          _insertToken(' #${tag['name']} ');
                          setState(() => _showTagBar = false);
                        },
                      ),
                    ),
                ],
              ),
            ),
          SizedBox(
            height: 48,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              children: <Widget>[
                _accessoryButton(' + ', () => _insertToken(' + ')),
                _accessoryButton(' - ', () => _insertToken('-')),
                _accessoryButton(' * ', () => _insertToken(' *')),
                _accessoryButton(' = ', () => _insertToken(' = ')),
                _accessoryButton(
                  ' #标签 ',
                  () => setState(() => _showTagBar = !_showTagBar),
                  highlighted: _showTagBar,
                ),
                _accessoryButton(' \$外币 ', () => _insertToken(' \$')),
                _accessoryButton(' 冻结 ', () => _insertToken(' 冻结')),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _accessoryButton(
    String label,
    VoidCallback onTap, {
    bool highlighted = false,
  }) {
    final cs = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(right: 6),
      child: Material(
        color: highlighted ? cs.primaryContainer : cs.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(10),
        child: InkWell(
          borderRadius: BorderRadius.circular(10),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            child: Center(
              child: Text(
                label.trim(),
                style: TextStyle(
                  fontWeight: FontWeight.w700,
                  fontSize: 13,
                  color: highlighted ? cs.onPrimaryContainer : cs.onSurface,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildVisualWorkspace(
    ColorScheme cs,
    List<Map<String, dynamic>> availableVouchers,
  ) {
    final activeTags =
        widget.engine.projectTags.where((t) => t['is_active'] != false).toList();
    final isFx = _txType == 'EXPENSE' && _currency != 'CNY';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        SegmentedButton<String>(
          segments: const <ButtonSegment<String>>[
            ButtonSegment<String>(
              value: 'EXPENSE',
              icon: Icon(Icons.trending_down),
              label: Text('支出'),
            ),
            ButtonSegment<String>(
              value: 'INCOME',
              icon: Icon(Icons.trending_up),
              label: Text('收入'),
            ),
          ],
          selected: <String>{_txType},
          onSelectionChanged: (sel) {
            setState(() {
              _txType = sel.first;
              _selectedVoucherIdVisual = null;
              _errorMsg = null;
            });
          },
        ),
        const SizedBox(height: 12),
        Row(
          children: <Widget>[
            Expanded(
              flex: 2,
              child: TextField(
                controller: _amountCtrl,
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: true),
                decoration: InputDecoration(
                  labelText: _txType == 'INCOME' ? '收入金额' : '交易金额',
                  prefixText: _currency == 'CNY' ? '¥ ' : '$_currency ',
                  border: const OutlineInputBorder(),
                ),
              ),
            ),
            if (_txType == 'EXPENSE') ...<Widget>[
              const SizedBox(width: 8),
              Expanded(
                child: DropdownButtonFormField<String>(
                  key: ValueKey<String>(_currency),
                  initialValue: _currency,
                  decoration: const InputDecoration(
                    labelText: '币种',
                    border: OutlineInputBorder(),
                  ),
                  items: const <DropdownMenuItem<String>>[
                    DropdownMenuItem(value: 'CNY', child: Text('CNY')),
                    DropdownMenuItem(value: 'USD', child: Text('USD')),
                    DropdownMenuItem(value: 'EUR', child: Text('EUR')),
                    DropdownMenuItem(value: 'JPY', child: Text('JPY')),
                    DropdownMenuItem(value: 'GBP', child: Text('GBP')),
                    DropdownMenuItem(value: 'HKD', child: Text('HKD')),
                  ],
                  onChanged: (v) {
                    if (v != null) setState(() => _currency = v);
                  },
                ),
              ),
            ],
          ],
        ),
        if (_txType == 'EXPENSE' && !isFx) ...<Widget>[
          const SizedBox(height: 10),
          TextField(
            controller: _discountCtrl,
            keyboardType:
                const TextInputType.numberWithOptions(decimal: true),
            decoration: const InputDecoration(
              labelText: '直接满减 / 立减 (选填)',
              prefixText: '-¥ ',
              border: OutlineInputBorder(),
            ),
          ),
        ],
        if (isFx) ...<Widget>[
          const SizedBox(height: 10),
          TextField(
            controller: _holdCnyCtrl,
            keyboardType:
                const TextInputType.numberWithOptions(decimal: true),
            decoration: const InputDecoration(
              labelText: '预授权冻结人民币 (选填，留空自动按比例估算)',
              prefixText: '¥ ',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 10),
          Row(
            children: <Widget>[
              Expanded(
                child: TextField(
                  controller: _fxHoldPctCtrl,
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(
                    labelText: '冻结比例 (%)',
                    suffixText: '%',
                    border: OutlineInputBorder(),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: TextField(
                  controller: _fxCashbackPctCtrl,
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(
                    labelText: '返现比例 (%)',
                    suffixText: '%',
                    border: OutlineInputBorder(),
                  ),
                ),
              ),
            ],
          ),
        ],
        const SizedBox(height: 10),
        TextField(
          controller: _noteCtrl,
          decoration: InputDecoration(
            labelText: '商户或消费备注',
            hintText: _txType == 'EXPENSE'
                ? '例：食堂晚餐 / 超市采购'
                : '例：生活费 / 兼职报酬',
            border: const OutlineInputBorder(),
          ),
        ),
        if (_txType == 'EXPENSE') ...<Widget>[
          const SizedBox(height: 12),
          Text(
            '支出归属（预算池或专项）',
            style: Theme.of(context)
                .textTheme
                .labelMedium
                ?.copyWith(color: cs.onSurfaceVariant),
          ),
          const SizedBox(height: 6),
          if (widget.engine.budgetPools.isEmpty && activeTags.isEmpty)
            Text(
              '当前暂无预算池或专项，将记为自由流水（后续可随时分配归属）',
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: cs.onSurfaceVariant),
            )
          else
            Wrap(
              spacing: 8,
              runSpacing: 6,
              children: <Widget>[
                for (final pool in widget.engine.budgetPools)
                  ChoiceChip(
                    label: Text('💰 ${pool['name']}'),
                    selected: _targetType == 'POOL' && _targetId == pool['id'],
                    onSelected: (_) {
                      setState(() {
                        _targetType = 'POOL';
                        _targetId = pool['id'] as String;
                      });
                    },
                  ),
                for (final tag in activeTags)
                  ChoiceChip(
                    label: Text('🎯 ${tag['name']}'),
                    selected:
                        _targetType == 'PROJECT' && _targetId == tag['id'],
                    onSelected: (_) {
                      setState(() {
                        _targetType = 'PROJECT';
                        _targetId = tag['id'] as String;
                      });
                    },
                  ),
              ],
            ),
          if (availableVouchers.isNotEmpty) ...<Widget>[
            const SizedBox(height: 12),
            DropdownButtonFormField<int?>(
              key: ValueKey<int?>(_selectedVoucherIdVisual),
              initialValue: _selectedVoucherIdVisual,
              decoration: const InputDecoration(
                labelText: '叠加虚拟卡包立减金 (可选)',
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
              onChanged: (val) =>
                  setState(() => _selectedVoucherIdVisual = val),
            ),
          ],
        ],
        const SizedBox(height: 16),
        FilledButton.icon(
          onPressed: _submitVisual,
          icon: const Icon(Icons.check_rounded),
          label: const Text('立即入账'),
        ),
      ],
    );
  }
}
