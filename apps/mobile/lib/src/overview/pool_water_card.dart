import 'dart:math' as math;

import 'package:material_ui/material_ui.dart';

import '../ledger_engine.dart';
import '../ui_helpers.dart';
import '../widgets/common_ui.dart';

const List<FontFeature> _tabularFigures = <FontFeature>[
  FontFeature.tabularFigures(),
];

/// Returns the elapsed ratio within [yearMonth] (`YYYY-MM`) relative to
/// [todayDateStr] (`YYYY-MM-DD`): past months -> `1.0`, future months -> `null`,
/// current month -> `currentDay / daysInMonth`.
double? computeMonthTimeProgress(String yearMonth, [String? todayDateStr]) {
  final parts = yearMonth.split('-');
  if (parts.length != 2) return null;
  final year = int.tryParse(parts[0]);
  final month = int.tryParse(parts[1]);
  if (year == null || month == null || month < 1 || month > 12) return null;

  final daysInMonth = DateTime(year, month + 1, 0).day;
  final effectiveToday = todayDateStr ?? getLocalTodayDateStr();
  final todayYm =
      effectiveToday.length >= 7 ? effectiveToday.substring(0, 7) : effectiveToday;
  final cmp = yearMonth.compareTo(todayYm);
  if (cmp > 0) return null;
  if (cmp < 0) return 1.0;

  final currentDay = effectiveToday.length >= 10
      ? (int.tryParse(effectiveToday.substring(8, 10)) ?? 1)
      : 1;
  return (currentDay.clamp(1, daysInMonth) / daysInMonth).clamp(0.0, 1.0);
}

/// Banner highlighting foreign-currency transactions waiting for bank settlement.
class PendingFxBanner extends StatelessWidget {
  const PendingFxBanner({
    super.key,
    required this.pendingFxTxs,
    required this.onSettleFx,
  });

  final List<Map<String, dynamic>> pendingFxTxs;
  final Future<void> Function(Map<String, dynamic> tx) onSettleFx;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.orange.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: Colors.orange.shade400),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Icon(
                Icons.hourglass_top_rounded,
                size: 18,
                color: Colors.orange.shade800,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  '有 ${pendingFxTxs.length} 笔外币待清算（点击快速输入银行实付解冻）',
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 13,
                    color: Colors.orange.shade900,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          for (final tx in pendingFxTxs)
            Builder(
              builder: (ctx) {
                final h = tx['header'] as Map<String, dynamic>;
                return Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Row(
                    children: <Widget>[
                      Expanded(
                        child: Text(
                          '${h['merchant_or_note']} · ${h['original_currency']} ${h['original_amount']} (冻结 ¥${h['hold_amount_cny']})',
                          style: const TextStyle(fontSize: 12),
                        ),
                      ),
                      const SizedBox(width: 8),
                      FilledButton.tonalIcon(
                        onPressed: () => onSettleFx(tx),
                        icon: const Icon(Icons.currency_exchange, size: 15),
                        label: const Text('清算'),
                      ),
                    ],
                  ),
                );
              },
            ),
        ],
      ),
    );
  }
}

/// Segmented budget progress bar rendering net spend, coupon/discount saved, and
/// an optional month time-pace vertical marker tick.
class SegmentedBudgetProgressBar extends StatelessWidget {
  const SegmentedBudgetProgressBar({
    super.key,
    required this.label,
    required this.spentRatio,
    required this.discountRatio,
    required this.spentColor,
    required this.discountColor,
    required this.trackColor,
    this.timeProgress,
    this.barHeight = 8.0,
    this.markerOverhang = 2.0,
  });

  final String label;
  final double spentRatio;
  final double discountRatio;
  final Color spentColor;
  final Color discountColor;
  final Color trackColor;
  final double? timeProgress;
  final double barHeight;
  final double markerOverhang;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final semanticPct = (spentRatio * 100).clamp(0, 999).round();

    return Semantics(
      label: label,
      value: '$semanticPct%',
      child: ExcludeSemantics(
        child: SizedBox(
          height: barHeight + markerOverhang * 2,
          width: double.infinity,
          child: CustomPaint(
            painter: _SegmentedBudgetProgressPainter(
              spentRatio: spentRatio,
              discountRatio: discountRatio,
              spentColor: spentColor,
              discountColor: discountColor,
              trackColor: trackColor,
              timeProgress: timeProgress,
              markerColor: cs.onSurface.withValues(alpha: 0.72),
              markerHaloColor: cs.surface.withValues(alpha: 0.85),
              barHeight: barHeight,
              markerOverhang: markerOverhang,
            ),
          ),
        ),
      ),
    );
  }
}

class _SegmentedBudgetProgressPainter extends CustomPainter {
  const _SegmentedBudgetProgressPainter({
    required this.spentRatio,
    required this.discountRatio,
    required this.spentColor,
    required this.discountColor,
    required this.trackColor,
    required this.timeProgress,
    required this.markerColor,
    required this.markerHaloColor,
    required this.barHeight,
    required this.markerOverhang,
  });

  final double spentRatio;
  final double discountRatio;
  final Color spentColor;
  final Color discountColor;
  final Color trackColor;
  final double? timeProgress;
  final Color markerColor;
  final Color markerHaloColor;
  final double barHeight;
  final double markerOverhang;

  @override
  void paint(Canvas canvas, Size size) {
    if (size.width <= 0 || barHeight <= 0) return;
    final radius = Radius.circular(barHeight / 2);
    final trackRect = Rect.fromLTWH(0, markerOverhang, size.width, barHeight);
    final trackRRect = RRect.fromRectAndRadius(trackRect, radius);

    canvas.drawRRect(trackRRect, Paint()..color = trackColor);

    canvas.save();
    canvas.clipRRect(trackRRect);

    final clampedSpent = spentRatio.clamp(0.0, 1.0);
    final spentWidth = size.width * clampedSpent;
    final effectiveDiscount =
        discountRatio.clamp(0.0, (1.0 - clampedSpent).clamp(0.0, 1.0));
    final discountWidth = size.width * effectiveDiscount;

    if (spentWidth > 0) {
      final spentPaint = Paint()..color = spentColor;
      final spentRect = Rect.fromLTWH(0, markerOverhang, spentWidth, barHeight);
      if (discountWidth > 0) {
        canvas.drawRect(spentRect, spentPaint);
      } else {
        canvas.drawRRect(
          RRect.fromRectAndCorners(
            spentRect,
            topRight: radius,
            bottomRight: radius,
          ),
          spentPaint,
        );
      }
    }

    if (discountWidth > 0) {
      final discountRect =
          Rect.fromLTWH(spentWidth, markerOverhang, discountWidth, barHeight);
      canvas.drawRRect(
        RRect.fromRectAndCorners(
          discountRect,
          topRight: radius,
          bottomRight: radius,
        ),
        Paint()..color = discountColor,
      );
    }

    canvas.restore();

    final tp = timeProgress;
    if (tp != null) {
      final maxMarkerX = math.max<double>(1.5, size.width - 1.5);
      final markerX =
          (size.width * tp.clamp(0.0, 1.0)).clamp(1.5, maxMarkerX).toDouble();
      final top = Offset(markerX, 1.0);
      final bottom = Offset(markerX, size.height - 1.0);
      canvas.drawLine(
        top,
        bottom,
        Paint()
          ..color = markerHaloColor
          ..strokeWidth = 3.2
          ..strokeCap = StrokeCap.round,
      );
      canvas.drawLine(
        top,
        bottom,
        Paint()
          ..color = markerColor
          ..strokeWidth = 1.8
          ..strokeCap = StrokeCap.round,
      );
    }
  }

  @override
  bool shouldRepaint(covariant _SegmentedBudgetProgressPainter oldDelegate) {
    return spentRatio != oldDelegate.spentRatio ||
        discountRatio != oldDelegate.discountRatio ||
        spentColor != oldDelegate.spentColor ||
        discountColor != oldDelegate.discountColor ||
        trackColor != oldDelegate.trackColor ||
        timeProgress != oldDelegate.timeProgress ||
        markerColor != oldDelegate.markerColor ||
        markerHaloColor != oldDelegate.markerHaloColor ||
        barHeight != oldDelegate.barHeight ||
        markerOverhang != oldDelegate.markerOverhang;
  }
}

/// Monthly budget pool status card featuring remaining percentage, dual-segment
/// spend/discount progress bar with time marker, and a 3-column single-line footer.
class PoolWaterCard extends StatelessWidget {
  const PoolWaterCard({
    super.key,
    required this.engine,
    required this.pool,
    required this.remainingDays,
    required this.onTap,
    this.totalDiscount,
    this.timeProgress,
  });

  final FlutterLedgerEngine engine;
  final Map<String, dynamic> pool;
  final int remainingDays;
  final VoidCallback onTap;
  final double? totalDiscount;
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
    final poolId = pool['pool_id'] as String;
    final defList =
        engine.budgetPools.where((p) => p['id'] == poolId).toList();
    final def = defList.isNotEmpty ? defList.first : null;
    final rollover = def?['rollover_strategy'] == 'RESET' ? '清零' : '滚存';
    final poolName = (pool['pool_name'] as String?) ?? poolId;
    final poolType = ((pool['pool_type'] ?? def?['pool_type']) as String?) ?? '';
    final isNonDailyPool = poolType == 'FIXED' ||
        poolType == 'EMERGENCY' ||
        poolId == 'POOL_FIXED' ||
        poolId == 'POOL_EMERGENCY' ||
        poolName.contains('固定');

    final availStr = (pool['total_available_budget'] as String?) ?? '0.00';
    final spentStr = (pool['spent_net'] as String?) ?? '0.00';
    final remainingStr = (pool['remaining_budget'] as String?) ?? '0.00';

    final avail = double.tryParse(availStr) ?? 0.0;
    final spent = double.tryParse(spentStr) ?? 0.0;
    final remaining = double.tryParse(remainingStr) ?? 0.0;
    final effectiveDiscount = totalDiscount ??
        double.tryParse((pool['total_saved_discount'] as String?) ?? '') ??
        0.0;

    final spentRatio =
        avail > 0 ? (spent / avail).clamp(0.0, 1.0) : (spent > 0 ? 1.0 : 0.0);
    final discountRatio = (avail > 0 && effectiveDiscount > 0)
        ? (effectiveDiscount / avail)
            .clamp(0.0, (1.0 - spentRatio).clamp(0.0, 1.0))
        : 0.0;

    final statusColor = poolHealthColor(
      context,
      remaining: remaining,
      totalAvailable: avail,
    );
    final mintColor = theme.brightness == Brightness.dark
        ? const Color(0xFF34D399).withValues(alpha: 0.85)
        : const Color(0xFF6EE7B7);

    final remainingDisplay = remaining < 0
        ? '-¥${remaining.abs().toStringAsFixed(2)}'
        : '¥$remainingStr';
    final String percentLabel;
    if (remaining < 0) {
      percentLabel = avail > 0
          ? '超支 ${((-remaining) / avail * 100).toStringAsFixed(1)}%'
          : '已超支';
    } else {
      percentLabel = avail > 0
          ? '剩 ${(remaining / avail * 100).toStringAsFixed(1)}%'
          : '剩 0.0%';
    }

    final perDay =
        ((remaining > 0 ? remaining : 0.0) / math.max(1, remainingDays))
            .toStringAsFixed(2);
    final rightFooterLabel = isNonDailyPool
        ? (remaining < 0
            ? '超支 ¥${remaining.abs().toStringAsFixed(2)}'
            : '剩余 ¥$remainingStr')
        : '日均 ¥$perDay/天';

    final secondaryFooterStyle = theme.textTheme.bodySmall?.copyWith(
      fontSize: 12,
      color: cs.onSurfaceVariant,
      fontFeatures: _tabularFigures,
    );
    final highlightFooterStyle = theme.textTheme.bodySmall?.copyWith(
      fontSize: 12,
      fontWeight: FontWeight.w600,
      color: remaining < 0 ? cs.error : cs.primary,
      fontFeatures: _tabularFigures,
    );

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: <Widget>[
                  Expanded(
                    child: Row(
                      children: <Widget>[
                        Flexible(
                          child: Text(
                            poolName,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontWeight: FontWeight.w700,
                              fontSize: 15,
                            ),
                          ),
                        ),
                        const SizedBox(width: 6),
                        LedgerBadge(
                          label: rollover,
                          backgroundColor: cs.surfaceContainerHighest,
                          foregroundColor: cs.onSurfaceVariant,
                          fontWeight: FontWeight.normal,
                          padding: const EdgeInsets.symmetric(
                            horizontal: 6,
                            vertical: 1,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 12),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      Text(
                        remainingDisplay,
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.bold,
                          color: statusColor,
                          fontFeatures: _tabularFigures,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        percentLabel,
                        style: theme.textTheme.labelSmall?.copyWith(
                          color: remaining < 0 ? cs.error : cs.onSurfaceVariant,
                          fontFeatures: _tabularFigures,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: 10),
              SegmentedBudgetProgressBar(
                label: '$poolName 预算已用比例',
                spentRatio: spentRatio,
                discountRatio: discountRatio,
                spentColor: statusColor,
                discountColor: mintColor,
                trackColor: cs.surfaceContainerHighest,
                timeProgress: timeProgress,
              ),
              const SizedBox(height: 10),
              Row(
                children: <Widget>[
                  _buildFooterCell(
                    '总额 ¥$availStr',
                    alignment: Alignment.centerLeft,
                    style: secondaryFooterStyle,
                  ),
                  const SizedBox(width: 4),
                  _buildFooterCell(
                    '已用 ¥$spentStr',
                    alignment: Alignment.center,
                    style: secondaryFooterStyle,
                  ),
                  const SizedBox(width: 4),
                  _buildFooterCell(
                    rightFooterLabel,
                    alignment: Alignment.centerRight,
                    style: highlightFooterStyle,
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
