import 'package:material_ui/material_ui.dart';

import '../widgets/common_ui.dart';

class PoolDialogResult {
  const PoolDialogResult({
    required this.name,
    required this.baseAllocation,
    required this.rolloverStrategy,
    required this.description,
  });

  final String name;
  final String baseAllocation;
  final String rolloverStrategy;
  final String description;
}

class PoolEditorDialog extends StatefulWidget {
  const PoolEditorDialog({
    super.key,
    required this.isEdit,
    required this.selectedMonth,
    required this.initialName,
    required this.initialAlloc,
    required this.initialRollover,
    required this.initialDescription,
  });

  final bool isEdit;
  final String selectedMonth;
  final String initialName;
  final String initialAlloc;
  final String initialRollover;
  final String initialDescription;

  @override
  State<PoolEditorDialog> createState() => _PoolEditorDialogState();
}

class _PoolEditorDialogState extends State<PoolEditorDialog> {
  late final TextEditingController _nameCtrl;
  late final TextEditingController _allocCtrl;
  late final TextEditingController _descCtrl;
  late String _rollover;
  String? _error;

  @override
  void initState() {
    super.initState();
    _nameCtrl = TextEditingController(text: widget.initialName);
    _allocCtrl = TextEditingController(text: widget.initialAlloc);
    _descCtrl = TextEditingController(text: widget.initialDescription);
    _rollover = widget.initialRollover;
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _allocCtrl.dispose();
    _descCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(widget.isEdit ? '调配预算池额度' : '新增月度预算池'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            TextField(
              controller: _nameCtrl,
              decoration: const InputDecoration(
                labelText: '资金池名称',
                border: OutlineInputBorder(),
              ),
              onChanged: (_) {
                if (_error != null) setState(() => _error = null);
              },
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _allocCtrl,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              decoration: InputDecoration(
                labelText: '${widget.selectedMonth} 基准预算 (CNY)',
                prefixText: '¥ ',
                border: const OutlineInputBorder(),
              ),
              onChanged: (_) {
                if (_error != null) setState(() => _error = null);
              },
            ),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              key: ValueKey<String>(_rollover),
              initialValue: _rollover,
              isExpanded: true,
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
                if (v != null) setState(() => _rollover = v);
              },
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _descCtrl,
              decoration: const InputDecoration(
                labelText: '用途说明 (选填)',
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
            final name = _nameCtrl.text.trim();
            if (name.isEmpty) {
              setState(() => _error = '请输入资金池名称');
              return;
            }
            final rawAlloc = _allocCtrl.text.trim().isEmpty
                ? '0.00'
                : _allocCtrl.text.trim();
            final parsed = double.tryParse(rawAlloc);
            if (parsed == null || parsed < 0) {
              setState(() => _error = '请输入有效的非负数字额度');
              return;
            }
            Navigator.of(context).pop(
              PoolDialogResult(
                name: name,
                baseAllocation: rawAlloc,
                rolloverStrategy: _rollover,
                description: _descCtrl.text.trim(),
              ),
            );
          },
          child: const Text('保存'),
        ),
      ],
    );
  }
}
