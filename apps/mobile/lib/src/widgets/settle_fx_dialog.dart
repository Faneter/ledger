import 'package:material_ui/material_ui.dart';

import '../ui_helpers.dart';

/// Mastercard foreign currency settlement dialog supporting both settled CNY and cashback %.
class SettleFxDialog extends StatefulWidget {
  const SettleFxDialog({
    super.key,
    required this.merchantOrNote,
    required this.originalCurrency,
    required this.originalAmount,
    required this.holdAmountCny,
    required this.initialSettledAmount,
    required this.initialCashbackRate,
  });

  final String merchantOrNote;
  final String originalCurrency;
  final String originalAmount;
  final String holdAmountCny;
  final String initialSettledAmount;
  final String initialCashbackRate;

  @override
  State<SettleFxDialog> createState() => _SettleFxDialogState();
}

class _SettleFxDialogState extends State<SettleFxDialog> {
  late final TextEditingController _amountCtrl;
  late final TextEditingController _cashbackPctCtrl;

  @override
  void initState() {
    super.initState();
    _amountCtrl = TextEditingController(text: widget.initialSettledAmount);
    _cashbackPctCtrl = TextEditingController(
      text: decimalRateToPercentText(widget.initialCashbackRate),
    );
  }

  @override
  void dispose() {
    _amountCtrl.dispose();
    _cashbackPctCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('万事达外币预授权清算'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              '${widget.merchantOrNote} (${widget.originalCurrency} ${widget.originalAmount})',
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 4),
            Text(
              '预授权冻结: ¥${widget.holdAmountCny}',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _amountCtrl,
              autofocus: true,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(
                labelText: '银行实际入账人民币金额 (CNY)',
                prefixText: '¥ ',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _cashbackPctCtrl,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(
                labelText: '外币返现比例 (%)',
                suffixText: '%',
                border: OutlineInputBorder(),
              ),
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
          onPressed: () {
            final amt = _amountCtrl.text.trim();
            final numAmt = double.tryParse(amt);
            if (numAmt == null || numAmt <= 0) return;
            final pctNum = double.tryParse(_cashbackPctCtrl.text.trim()) ?? 1.0;
            final rateStr = (pctNum / 100).toStringAsFixed(4);
            Navigator.of(context).pop(<String, String>{
              'settledAmountCny': amt,
              'cashbackRate': rateStr,
            });
          },
          child: const Text('确认入账'),
        ),
      ],
    );
  }
}
