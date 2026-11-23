import 'package:material_ui/material_ui.dart';

import 'ledger_engine.dart';
import 'quick_record/dsl_accessory_bar.dart';
import 'quick_record/dsl_preview_card.dart';
import 'quick_record/visual_record_form.dart';
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
  int? _primaryItemOverrideIndex;
  final Map<int, Map<String, String?>> _itemTargetOverrides =
      <int, Map<String, String?>>{};
  String? _errorMsg;
  String? _cachedPreviewKey;
  Map<String, dynamic>? _cachedPreviewResult;

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

  String _buildPreviewCacheKey(String raw) {
    final sortedKeys = _itemTargetOverrides.keys.toList()..sort();
    final overrideSig = sortedKeys
        .map((k) {
          final m = _itemTargetOverrides[k]!;
          return '$k:${m['budget_pool_id'] ?? ''}:${m['project_tag_id'] ?? ''}';
        })
        .join(',');
    return '${widget.engine.stateVersion}|$raw|$_primaryItemOverrideIndex|$overrideSig';
  }

  Map<String, dynamic>? _compilePreview() {
    final raw = _dslCtrl.text.trim();
    if (raw.isEmpty) {
      _cachedPreviewKey = null;
      _cachedPreviewResult = null;
      return null;
    }
    final cacheKey = _buildPreviewCacheKey(raw);
    if (_cachedPreviewKey == cacheKey) {
      return _cachedPreviewResult;
    }
    try {
      final result = widget.engine.previewDsl(
        raw,
        primaryItemOverrideIndex: _primaryItemOverrideIndex,
        itemTargetOverrides:
            _itemTargetOverrides.isEmpty ? null : _itemTargetOverrides,
      );
      _cachedPreviewKey = cacheKey;
      _cachedPreviewResult = result;
      return result;
    } catch (_) {
      _cachedPreviewKey = cacheKey;
      _cachedPreviewResult = null;
      return null;
    }
  }

  Future<void> _pickItemTarget(int index, Map<String, dynamic> item) async {
    final picked = await showTargetPickerSheet(
      context,
      widget.engine,
      currentPoolId: item['budget_pool_id'] as String?,
      currentProjectTagId: item['project_tag_id'] as String?,
      title: '调整「${item['item_name']}」归属',
    );
    if (picked != null && mounted) {
      setState(() {
        _itemTargetOverrides[index] = picked;
      });
    }
  }

  void _submitDsl() {
    final raw = _dslCtrl.text.trim();
    if (raw.isEmpty) {
      setState(() => _errorMsg = '请输入记账算式，例如：牛奶 28 + 晾衣架 12 + 排针 15 = 50');
      return;
    }
    try {
      final tx = widget.engine.recordFromDsl(
        raw,
        txDate: _txDate,
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
                    ? _buildDslWorkspace(cs)
                    : VisualRecordForm(
                        engine: widget.engine,
                        txType: _txType,
                        currency: _currency,
                        targetType: _targetType,
                        targetId: _targetId,
                        amountCtrl: _amountCtrl,
                        discountCtrl: _discountCtrl,
                        holdCnyCtrl: _holdCnyCtrl,
                        fxHoldPctCtrl: _fxHoldPctCtrl,
                        fxCashbackPctCtrl: _fxCashbackPctCtrl,
                        noteCtrl: _noteCtrl,
                        onTxTypeChanged: (next) {
                          setState(() {
                            _txType = next;
                            _errorMsg = null;
                          });
                        },
                        onCurrencyChanged: (next) =>
                            setState(() => _currency = next),
                        onTargetChanged: (type, id) {
                          setState(() {
                            _targetType = type;
                            _targetId = id;
                          });
                        },
                        onSubmit: _submitVisual,
                      ),
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
            if (_mode == 'dsl')
              DslAccessoryBar(
                engine: widget.engine,
                showTagBar: _showTagBar,
                onToggleTagBar: () =>
                    setState(() => _showTagBar = !_showTagBar),
                onInsertToken: _insertToken,
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildDslWorkspace(ColorScheme cs) {
    final preview = _compilePreview();
    final parsed = preview?['parsed'] as Map<String, dynamic>?;

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
        DslSplitPreviewSection(
          engine: widget.engine,
          preview: preview,
          onTogglePrimaryItem: (nextIndex) {
            setState(() {
              _primaryItemOverrideIndex = nextIndex;
            });
          },
          onPickItemTarget: _pickItemTarget,
        ),
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
}
