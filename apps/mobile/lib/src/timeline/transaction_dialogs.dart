import 'package:material_ui/material_ui.dart';

import '../widgets/common_ui.dart';

class EditTransactionDialog extends StatefulWidget {
  const EditTransactionDialog({
    super.key,
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
  State<EditTransactionDialog> createState() => _EditTransactionDialogState();
}

class _EditTransactionDialogState extends State<EditTransactionDialog> {
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
            DialogErrorBanner(error: _error),
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

class ProjectDialogResult {
  const ProjectDialogResult({
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

class ProjectEditorDialog extends StatefulWidget {
  const ProjectEditorDialog({
    super.key,
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
  State<ProjectEditorDialog> createState() => _ProjectEditorDialogState();
}

class _ProjectEditorDialogState extends State<ProjectEditorDialog> {
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
            DialogErrorBanner(error: _error, topSpacing: 6),
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
              ProjectDialogResult(
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
