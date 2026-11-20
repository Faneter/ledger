import 'package:material_ui/material_ui.dart';

import '../widgets/common_ui.dart';

class AddRuleResult {
  const AddRuleResult({
    required this.title,
    required this.cronCycle,
    required this.triggerDay,
    required this.currency,
    required this.amount,
    required this.budgetPoolId,
  });

  final String title;
  final String cronCycle;
  final int triggerDay;
  final String currency;
  final String amount;
  final String? budgetPoolId;
}

class AddRuleDialog extends StatefulWidget {
  const AddRuleDialog({super.key, required this.budgetPools});

  final List<Map<String, dynamic>> budgetPools;

  @override
  State<AddRuleDialog> createState() => _AddRuleDialogState();
}

class _AddRuleDialogState extends State<AddRuleDialog> {
  final TextEditingController _titleCtrl = TextEditingController();
  final TextEditingController _amtCtrl = TextEditingController(text: '20.00');
  final TextEditingController _dayCtrl = TextEditingController(text: '1');
  String _cycle = 'MONTHLY';
  String _currency = 'CNY';
  String? _poolId;
  String? _error;

  @override
  void initState() {
    super.initState();
    final ids = widget.budgetPools.map((p) => p['id'] as String).toList();
    _poolId = ids.contains('POOL_FIXED')
        ? 'POOL_FIXED'
        : (ids.isNotEmpty ? ids.first : null);
  }

  @override
  void dispose() {
    _titleCtrl.dispose();
    _amtCtrl.dispose();
    _dayCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('新增周期性扣款规则'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            TextField(
              controller: _titleCtrl,
              decoration: const InputDecoration(
                labelText: '规则名称（如 校园宽带 / iCloud）',
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
                  flex: 2,
                  child: TextField(
                    controller: _amtCtrl,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    decoration: const InputDecoration(
                      labelText: '金额',
                      border: OutlineInputBorder(),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: CurrencyDropdownField(
                    value: _currency,
                    currencies: const <String>['CNY', 'USD', 'JPY', 'EUR'],
                    onChanged: (v) {
                      if (v != null) setState(() => _currency = v);
                    },
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              children: <Widget>[
                Expanded(
                  child: DropdownButtonFormField<String>(
                    key: ValueKey<String>(_cycle),
                    initialValue: _cycle,
                    isExpanded: true,
                    decoration: const InputDecoration(
                      labelText: '周期',
                      border: OutlineInputBorder(),
                    ),
                    items: const <DropdownMenuItem<String>>[
                      DropdownMenuItem(value: 'MONTHLY', child: Text('每月')),
                      DropdownMenuItem(value: 'YEARLY', child: Text('每年')),
                    ],
                    onChanged: (v) {
                      if (v != null) setState(() => _cycle = v);
                    },
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    controller: _dayCtrl,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                      labelText: '触发日 (1-31)',
                      border: OutlineInputBorder(),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            DropdownButtonFormField<String?>(
              key: ValueKey<String?>(_poolId),
              initialValue: _poolId,
              isExpanded: true,
              decoration: const InputDecoration(
                labelText: '关联资金池',
                border: OutlineInputBorder(),
              ),
              items: <DropdownMenuItem<String?>>[
                const DropdownMenuItem<String?>(
                  value: null,
                  child: Text('暂不绑定预算池'),
                ),
                ...widget.budgetPools.map(
                  (p) => DropdownMenuItem<String?>(
                    value: p['id'] as String,
                    child: Text(
                      p['name'] as String,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ),
              ],
              onChanged: (v) => setState(() => _poolId = v),
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
            final title = _titleCtrl.text.trim();
            if (title.isEmpty) {
              setState(() => _error = '请输入规则名称');
              return;
            }
            if ((double.tryParse(_amtCtrl.text.trim()) ?? 0) <= 0) {
              setState(() => _error = '请输入大于 0 的有效金额');
              return;
            }
            Navigator.of(context).pop(
              AddRuleResult(
                title: title,
                cronCycle: _cycle,
                triggerDay: (int.tryParse(_dayCtrl.text.trim()) ?? 1)
                    .clamp(1, 31),
                currency: _currency,
                amount: _amtCtrl.text.trim(),
                budgetPoolId: _poolId,
              ),
            );
          },
          child: const Text('保存规则'),
        ),
      ],
    );
  }
}
