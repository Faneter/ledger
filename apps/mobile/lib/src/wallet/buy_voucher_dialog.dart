import 'package:material_ui/material_ui.dart';

class BuyVoucherDialog extends StatefulWidget {
  const BuyVoucherDialog({super.key});

  @override
  State<BuyVoucherDialog> createState() => _BuyVoucherDialogState();
}

class _BuyVoucherDialogState extends State<BuyVoucherDialog> {
  late final TextEditingController _titleCtrl;
  late final TextEditingController _faceCtrl;
  late final TextEditingController _costCtrl;
  late final TextEditingController _minCtrl;
  String _voucherType = 'PREPAID_COUPON';

  @override
  void initState() {
    super.initState();
    _titleCtrl = TextEditingController();
    _faceCtrl = TextEditingController(text: '15.00');
    _costCtrl = TextEditingController(text: '8.90');
    _minCtrl = TextEditingController(text: '20.00');
  }

  @override
  void dispose() {
    _titleCtrl.dispose();
    _faceCtrl.dispose();
    _costCtrl.dispose();
    _minCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('购买 / 新增卡券'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            DropdownButtonFormField<String>(
              key: ValueKey<String>(_voucherType),
              initialValue: _voucherType,
              isExpanded: true,
              decoration: const InputDecoration(labelText: '卡券类型'),
              items: const <DropdownMenuItem<String>>[
                DropdownMenuItem<String>(
                  value: 'PREPAID_COUPON',
                  child: Text(
                    '有偿购入立减金 (成本核销结转)',
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                DropdownMenuItem<String>(
                  value: 'FREE_COUPON',
                  child: Text('免费领券'),
                ),
              ],
              onChanged: (v) {
                if (v != null) {
                  setState(() {
                    _voucherType = v;
                    if (v == 'FREE_COUPON') {
                      _costCtrl.text = '0.00';
                    }
                  });
                }
              },
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _titleCtrl,
              decoration: const InputDecoration(
                labelText: '名称/前缀 (选填，留空自动生成)',
              ),
            ),
            TextField(
              controller: _faceCtrl,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: '面额 (CNY)'),
            ),
            TextField(
              controller: _costCtrl,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: '购券成本 (CNY)'),
            ),
            TextField(
              controller: _minCtrl,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: '使用门槛 (CNY)'),
            ),
          ],
        ),
      ),
      actions: <Widget>[
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('取消'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(<String, String>{
            'title': _titleCtrl.text.trim(),
            'voucherType': _voucherType,
            'faceValue': _faceCtrl.text.trim(),
            'acquireCost': _costCtrl.text.trim(),
            'minSpend': _minCtrl.text.trim(),
          }),
          child: const Text('入库'),
        ),
      ],
    );
  }
}
