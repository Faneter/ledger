import 'package:material_ui/material_ui.dart';

import '../ledger_engine.dart';

/// Visual year/month calendar grid picker dialog for billing month switching.
class MonthPickerDialog extends StatefulWidget {
  const MonthPickerDialog({
    super.key,
    required this.initialMonth,
    required this.months,
  });

  final String initialMonth;
  final List<String> months;

  @override
  State<MonthPickerDialog> createState() => _MonthPickerDialogState();
}

class _MonthPickerDialogState extends State<MonthPickerDialog> {
  late int _displayYear;
  bool _pickingYear = false;

  @override
  void initState() {
    super.initState();
    final parts = widget.initialMonth.split('-');
    _displayYear =
        int.tryParse(parts.isNotEmpty ? parts[0] : '') ?? DateTime.now().year;
  }

  String _formatYearMonth(int year, int month) =>
      '${year.toString().padLeft(4, '0')}-${month.toString().padLeft(2, '0')}';

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final todayYm = getLocalTodayDateStr().substring(0, 7);

    return AlertDialog(
      title: const Text('选择账单月份'),
      content: SizedBox(
        width: 280,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Row(
              children: <Widget>[
                IconButton(
                  tooltip: '上一年',
                  visualDensity: VisualDensity.compact,
                  constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                  padding: EdgeInsets.zero,
                  icon: const Icon(Icons.chevron_left, size: 20),
                  onPressed: _pickingYear
                      ? null
                      : () => setState(() => _displayYear -= 1),
                ),
                Expanded(
                  child: Center(
                    child: TextButton(
                      style: TextButton.styleFrom(
                        visualDensity: VisualDensity.compact,
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 4,
                        ),
                      ),
                      onPressed: () =>
                          setState(() => _pickingYear = !_pickingYear),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: <Widget>[
                          Text(
                            '$_displayYear 年',
                            style: const TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          const SizedBox(width: 2),
                          Icon(
                            _pickingYear
                                ? Icons.arrow_drop_up
                                : Icons.arrow_drop_down,
                            size: 18,
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
                IconButton(
                  tooltip: '下一年',
                  visualDensity: VisualDensity.compact,
                  constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                  padding: EdgeInsets.zero,
                  icon: const Icon(Icons.chevron_right, size: 20),
                  onPressed: _pickingYear
                      ? null
                      : () => setState(() => _displayYear += 1),
                ),
              ],
            ),
            const SizedBox(height: 8),
            if (_pickingYear)
              SizedBox(
                height: 216,
                child: YearPicker(
                  firstDate: DateTime(2000),
                  lastDate: DateTime(2100),
                  selectedDate: DateTime(_displayYear),
                  onChanged: (DateTime picked) {
                    setState(() {
                      _displayYear = picked.year;
                      _pickingYear = false;
                    });
                  },
                ),
              )
            else
              GridView.count(
                crossAxisCount: 3,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                mainAxisSpacing: 8,
                crossAxisSpacing: 8,
                childAspectRatio: 1.85,
                children: List<Widget>.generate(12, (idx) {
                  final month = idx + 1;
                  final ym = _formatYearMonth(_displayYear, month);
                  final isSelected = ym == widget.initialMonth;
                  final isToday = ym == todayYm;
                  final hasData = widget.months.contains(ym);

                  return Material(
                    color: isSelected
                        ? cs.primary
                        : cs.surfaceContainerHighest.withValues(alpha: 0.6),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                      side: isToday && !isSelected
                          ? BorderSide(color: cs.primary, width: 1.2)
                          : BorderSide.none,
                    ),
                    child: InkWell(
                      borderRadius: BorderRadius.circular(12),
                      onTap: () => Navigator.of(context).pop(ym),
                      child: Stack(
                        alignment: Alignment.center,
                        children: <Widget>[
                          Text(
                            '$month月',
                            style: TextStyle(
                              fontWeight: FontWeight.w600,
                              fontSize: 13,
                              color: isSelected ? cs.onPrimary : cs.onSurface,
                            ),
                          ),
                          if (hasData && !isSelected)
                            Positioned(
                              bottom: 5,
                              child: Container(
                                width: 4,
                                height: 4,
                                decoration: BoxDecoration(
                                  color: cs.primary,
                                  shape: BoxShape.circle,
                                ),
                              ),
                            ),
                        ],
                      ),
                    ),
                  );
                }),
              ),
          ],
        ),
      ),
      actions: <Widget>[
        TextButton(
          onPressed: () => Navigator.of(context).pop(todayYm),
          child: const Text('回到本月'),
        ),
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('取消'),
        ),
      ],
    );
  }
}
