import 'package:material_ui/material_ui.dart';

import '../ledger_engine.dart';
import '../widgets/common_ui.dart';

/// Standard visual transaction entry form (expense/income, FX fields, target chips, voucher picker).
class VisualRecordForm extends StatelessWidget {
  const VisualRecordForm({
    super.key,
    required this.engine,
    required this.txType,
    required this.currency,
    required this.targetType,
    required this.targetId,
    required this.selectedVoucherId,
    required this.availableVouchers,
    required this.amountCtrl,
    required this.discountCtrl,
    required this.holdCnyCtrl,
    required this.fxHoldPctCtrl,
    required this.fxCashbackPctCtrl,
    required this.noteCtrl,
    required this.onTxTypeChanged,
    required this.onCurrencyChanged,
    required this.onTargetChanged,
    required this.onVoucherChanged,
    required this.onSubmit,
  });

  final FlutterLedgerEngine engine;
  final String txType;
  final String currency;
  final String targetType;
  final String targetId;
  final int? selectedVoucherId;
  final List<Map<String, dynamic>> availableVouchers;
  final TextEditingController amountCtrl;
  final TextEditingController discountCtrl;
  final TextEditingController holdCnyCtrl;
  final TextEditingController fxHoldPctCtrl;
  final TextEditingController fxCashbackPctCtrl;
  final TextEditingController noteCtrl;
  final ValueChanged<String> onTxTypeChanged;
  final ValueChanged<String> onCurrencyChanged;
  final void Function(String targetType, String targetId) onTargetChanged;
  final ValueChanged<int?> onVoucherChanged;
  final VoidCallback onSubmit;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final activeTags =
        engine.projectTags.where((t) => t['is_active'] != false).toList();
    final isFx = txType == 'EXPENSE' && currency != 'CNY';

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
          selected: <String>{txType},
          onSelectionChanged: (sel) => onTxTypeChanged(sel.first),
        ),
        const SizedBox(height: 12),
        Row(
          children: <Widget>[
            Expanded(
              flex: 2,
              child: TextField(
                controller: amountCtrl,
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: true),
                decoration: InputDecoration(
                  labelText: txType == 'INCOME' ? '收入金额' : '交易金额',
                  prefixText: currency == 'CNY' ? '¥ ' : '$currency ',
                  border: const OutlineInputBorder(),
                ),
              ),
            ),
            if (txType == 'EXPENSE') ...<Widget>[
              const SizedBox(width: 8),
              Expanded(
                child: CurrencyDropdownField(
                  value: currency,
                  currencies: const <String>[
                    'CNY',
                    'USD',
                    'EUR',
                    'JPY',
                    'GBP',
                    'HKD',
                  ],
                  onChanged: (v) {
                    if (v != null) onCurrencyChanged(v);
                  },
                ),
              ),
            ],
          ],
        ),
        if (txType == 'EXPENSE' && !isFx) ...<Widget>[
          const SizedBox(height: 10),
          TextField(
            controller: discountCtrl,
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
            controller: holdCnyCtrl,
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
                  controller: fxHoldPctCtrl,
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
                  controller: fxCashbackPctCtrl,
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
          controller: noteCtrl,
          decoration: InputDecoration(
            labelText: '商户或消费备注',
            hintText: txType == 'EXPENSE'
                ? '例：食堂晚餐 / 超市采购'
                : '例：生活费 / 兼职报酬',
            border: const OutlineInputBorder(),
          ),
        ),
        if (txType == 'EXPENSE') ...<Widget>[
          const SizedBox(height: 12),
          Text(
            '支出归属（预算池或专项）',
            style: Theme.of(context)
                .textTheme
                .labelMedium
                ?.copyWith(color: cs.onSurfaceVariant),
          ),
          const SizedBox(height: 6),
          if (engine.budgetPools.isEmpty && activeTags.isEmpty)
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
                for (final pool in engine.budgetPools)
                  ChoiceChip(
                    label: Text('💰 ${pool['name']}'),
                    selected: targetType == 'POOL' && targetId == pool['id'],
                    onSelected: (_) =>
                        onTargetChanged('POOL', pool['id'] as String),
                  ),
                for (final tag in activeTags)
                  ChoiceChip(
                    label: Text('🎯 ${tag['name']}'),
                    selected: targetType == 'PROJECT' && targetId == tag['id'],
                    onSelected: (_) =>
                        onTargetChanged('PROJECT', tag['id'] as String),
                  ),
              ],
            ),
          if (availableVouchers.isNotEmpty) ...<Widget>[
            const SizedBox(height: 12),
            DropdownButtonFormField<int?>(
              key: ValueKey<int?>(selectedVoucherId),
              initialValue: selectedVoucherId,
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
              onChanged: onVoucherChanged,
            ),
          ],
        ],
        const SizedBox(height: 16),
        FilledButton.icon(
          onPressed: onSubmit,
          icon: const Icon(Icons.check_rounded),
          label: const Text('立即入账'),
        ),
      ],
    );
  }
}
