import 'package:material_ui/material_ui.dart';

import '../ui_helpers.dart';
import '../widgets/common_ui.dart';
import 'pool_water_card.dart';

const List<FontFeature> _tabularFigures = <FontFeature>[
  FontFeature.tabularFigures(),
];

/// Overview Hero Card displaying Scheme B: full-month status bar, top dual
/// core metrics (daily allowance & total monthly remaining), dual-segment
/// full-month progress bar with time marker, and a 3-column single-line footer.
class DailyAllowanceCard extends StatelessWidget {
  const DailyAllowanceCard({
    super.key,
    required this.dailyAvailableAmount,
    required this.remainingDays,
    required this.formula,
    this.dailyPoolName,
    required this.totalMonthBudget,
    required this.totalMonthNetSpent,
    required this.totalMonthRemaining,
    required this.totalMonthSaved,
    required this.totalMonthBudgetText,
    required this.totalMonthNetSpentText,
    required this.totalMonthSavedText,
    this.timeProgress,
  });

  final String dailyAvailableAmount;
  final int remainingDays;
  final String formula;
  final String? dailyPoolName;
  final double totalMonthBudget;
  final double totalMonthNetSpent;
  final double totalMonthRemaining;
  final double totalMonthSaved;
  final String totalMonthBudgetText;
  final String totalMonthNetSpentText;
  final String totalMonthSavedText;
  final double? timeProgress;

  Widget _buildFooterCell(
    String text, {
    required Alignment alignment,
    required TextStyle? style,
  }) {
    return Expanded(
      child: Align(
        alignment: alignment,
        child: FittedBox(
          fit: BoxFit.scaleDown,
          alignment: alignment,
          child: Text(
            text,
            maxLines: 1,
            softWrap: false,
            style: style,
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cs = theme.colorScheme;
    final isDark = theme.brightness == Brightness.dark;

    final mutedColor = cs.onPrimaryContainer.withValues(alpha: 0.72);
    final primaryMetricColor = isDark ? cs.onPrimaryContainer : cs.primary;
    final totalRemainingColor =
        totalMonthRemaining < 0 ? cs.error : primaryMetricColor;
    final mintBarColor = isDark
        ? const Color(0xFF34D399).withValues(alpha: 0.85)
        : const Color(0xFF6EE7B7);
    final savedGreenText =
        isDark ? const Color(0xFF6EE7B7) : const Color(0xFF047857);
    final mintPillBg = isDark
        ? const Color(0xFF065F46).withValues(alpha: 0.65)
        : const Color(0xFFD1FAE5);
    final trackColor = cs.surface.withValues(alpha: isDark ? 0.35 : 0.55);
    final barSpentColor = poolHealthColor(
      context,
      remaining: totalMonthRemaining,
      totalAvailable: totalMonthBudget,
    );

    final totalRemainingDisplay = totalMonthRemaining < 0
        ? '-¥${totalMonthRemaining.abs().toStringAsFixed(2)}'
        : '¥${totalMonthRemaining.toStringAsFixed(2)}';

    final spentRatio = totalMonthBudget > 0
        ? (totalMonthNetSpent / totalMonthBudget).clamp(0.0, 1.0)
        : (totalMonthNetSpent > 0 ? 1.0 : 0.0);
    final discountRatio = (totalMonthBudget > 0 && totalMonthSaved > 0)
        ? (totalMonthSaved / totalMonthBudget)
            .clamp(0.0, (1.0 - spentRatio).clamp(0.0, 1.0))
        : 0.0;

    final cleanPoolName = dailyPoolName;
    final tooltipMessage =
        (cleanPoolName != null && cleanPoolName.isNotEmpty)
            ? '$cleanPoolName 日均计算公式：$formula'
            : '日均计算公式：$formula';

    final secondaryFooterStyle = theme.textTheme.bodySmall?.copyWith(
      fontSize: 12,
      color: mutedColor,
      fontFeatures: _tabularFigures,
    );
    final savedFooterStyle = theme.textTheme.bodySmall?.copyWith(
      fontSize: 12,
      fontWeight: FontWeight.w600,
      color: savedGreenText,
      fontFeatures: _tabularFigures,
    );

    return Semantics(
      container: true,
      label: '全月总览，今日生活日均 $dailyAvailableAmount 元每天，全月总剩余 $totalRemainingDisplay',
      child: Card(
        color: cs.primaryContainer,
        elevation: 0,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              // 1. Compact Status Bar
              Row(
                children: <Widget>[
                  Expanded(
                    child: Text(
                      '全月总览 · 剩 $remainingDays 天',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.labelMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                        color: mutedColor,
                        fontFeatures: _tabularFigures,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  LedgerBadge(
                    label: '本月已省 ¥$totalMonthSavedText',
                    backgroundColor: mintPillBg,
                    foregroundColor: savedGreenText,
                    fontSize: 11,
                    fontWeight: FontWeight.bold,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 3,
                    ),
                    fontFeatures: _tabularFigures,
                  ),
                ],
              ),
              const SizedBox(height: 12),

              // 2. Top Dual-Metric Section
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Expanded(
                    child: Tooltip(
                      message: tooltipMessage,
                      triggerMode: TooltipTriggerMode.tap,
                      preferBelow: false,
                      showDuration: const Duration(seconds: 4),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Row(
                            mainAxisSize: MainAxisSize.min,
                            children: <Widget>[
                              Text(
                                '今日生活日均',
                                style: theme.textTheme.bodySmall?.copyWith(
                                  color: mutedColor,
                                ),
                              ),
                              const SizedBox(width: 4),
                              Icon(
                                Icons.info_outline_rounded,
                                size: 13,
                                color: mutedColor,
                              ),
                            ],
                          ),
                          const SizedBox(height: 4),
                          FittedBox(
                            fit: BoxFit.scaleDown,
                            alignment: Alignment.centerLeft,
                            child: Text(
                              '¥$dailyAvailableAmount / 天',
                              maxLines: 1,
                              softWrap: false,
                              style: theme.textTheme.headlineSmall?.copyWith(
                                fontSize: 22,
                                fontWeight: FontWeight.w800,
                                color: primaryMetricColor,
                                fontFeatures: _tabularFigures,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: <Widget>[
                        Text(
                          '全月总剩余',
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: mutedColor,
                          ),
                        ),
                        const SizedBox(height: 4),
                        FittedBox(
                          fit: BoxFit.scaleDown,
                          alignment: Alignment.centerRight,
                          child: Text(
                            totalRemainingDisplay,
                            maxLines: 1,
                            softWrap: false,
                            style: theme.textTheme.headlineSmall?.copyWith(
                              fontSize: 22,
                              fontWeight: FontWeight.w800,
                              color: totalRemainingColor,
                              fontFeatures: _tabularFigures,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),

              Divider(
                height: 22,
                thickness: 0.8,
                color: cs.onPrimaryContainer.withValues(alpha: 0.14),
              ),

              // 3. Bottom Global Dual-Segment Progress Bar + Time Marker
              SegmentedBudgetProgressBar(
                label: '全月总预算已用比例',
                spentRatio: spentRatio,
                discountRatio: discountRatio,
                spentColor: barSpentColor,
                discountColor: mintBarColor,
                trackColor: trackColor,
                timeProgress: timeProgress,
              ),
              const SizedBox(height: 10),

              // 4. Equal 3-Column Single-Line Summary Footer
              Row(
                children: <Widget>[
                  _buildFooterCell(
                    '总预算 ¥$totalMonthBudgetText',
                    alignment: Alignment.centerLeft,
                    style: secondaryFooterStyle,
                  ),
                  const SizedBox(width: 4),
                  _buildFooterCell(
                    '已支 ¥$totalMonthNetSpentText',
                    alignment: Alignment.center,
                    style: secondaryFooterStyle,
                  ),
                  const SizedBox(width: 4),
                  _buildFooterCell(
                    '已省 ¥$totalMonthSavedText',
                    alignment: Alignment.centerRight,
                    style: savedFooterStyle,
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
