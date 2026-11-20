import 'package:material_ui/material_ui.dart';

/// Compact rounded badge/pill shared across timeline, budgets, preview, and wallet cards.
class LedgerBadge extends StatelessWidget {
  const LedgerBadge({
    super.key,
    required this.label,
    required this.backgroundColor,
    required this.foregroundColor,
    this.fontSize = 10,
    this.fontWeight = FontWeight.w600,
    this.padding = const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
    this.borderRadius = 999,
    this.fontFeatures,
  });

  final String label;
  final Color backgroundColor;
  final Color foregroundColor;
  final double fontSize;
  final FontWeight fontWeight;
  final EdgeInsetsGeometry padding;
  final double borderRadius;
  final List<FontFeature>? fontFeatures;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: padding,
      decoration: BoxDecoration(
        color: backgroundColor,
        borderRadius: BorderRadius.circular(borderRadius),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: fontSize,
          fontWeight: fontWeight,
          color: foregroundColor,
          fontFeatures: fontFeatures,
        ),
      ),
    );
  }
}

/// Section header row with optional leading icon and trailing action widget.
class LedgerSectionHeader extends StatelessWidget {
  const LedgerSectionHeader({
    super.key,
    required this.title,
    this.icon,
    this.trailing,
    this.bottomPadding = 8,
  });

  final String title;
  final IconData? icon;
  final Widget? trailing;
  final double bottomPadding;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Padding(
      padding: EdgeInsets.only(bottom: bottomPadding),
      child: Row(
        children: <Widget>[
          if (icon != null) ...<Widget>[
            Icon(icon, size: 18, color: cs.primary),
            const SizedBox(width: 6),
          ],
          Expanded(
            child: Text(
              title,
              style: Theme.of(context)
                  .textTheme
                  .titleMedium
                  ?.copyWith(fontWeight: FontWeight.bold),
            ),
          ),
          if (trailing != null) trailing!,
        ],
      ),
    );
  }
}

/// Accessible linear progress indicator exposing semantic label and percentage without
/// hijacking ancestor card semantics.
class AccessibleProgressBar extends StatelessWidget {
  const AccessibleProgressBar({
    super.key,
    required this.label,
    required this.value,
    required this.color,
    this.backgroundColor,
    this.minHeight = 6,
  });

  final String label;
  final double value;
  final Color color;
  final Color? backgroundColor;
  final double minHeight;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: label,
      value: '${(value * 100).clamp(0, 999).round()}%',
      child: ExcludeSemantics(
        child: LinearProgressIndicator(
          value: value,
          minHeight: minHeight,
          borderRadius: BorderRadius.circular(4),
          color: color,
          backgroundColor: backgroundColor,
        ),
      ),
    );
  }
}

/// Renders inline form validation error text inside dialogs when [error] is non-null.
class DialogErrorBanner extends StatelessWidget {
  const DialogErrorBanner({
    super.key,
    this.error,
    this.topSpacing = 8,
  });

  final String? error;
  final double topSpacing;

  @override
  Widget build(BuildContext context) {
    if (error == null) return const SizedBox.shrink();
    return Padding(
      padding: EdgeInsets.only(top: topSpacing),
      child: Text(
        error!,
        style: TextStyle(
          color: Theme.of(context).colorScheme.error,
          fontSize: 12,
        ),
      ),
    );
  }
}

/// Reusable empty-state card with centered headline and optional secondary description.
class LedgerEmptyStateCard extends StatelessWidget {
  const LedgerEmptyStateCard({
    super.key,
    required this.title,
    this.subtitle,
    this.padding = const EdgeInsets.all(20),
  });

  final String title;
  final String? subtitle;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: padding,
        child: Column(
          children: <Widget>[
            Center(
              child: Text(
                title,
                textAlign: TextAlign.center,
                style: subtitle != null
                    ? Theme.of(context)
                        .textTheme
                        .titleSmall
                        ?.copyWith(fontWeight: FontWeight.w600)
                    : TextStyle(color: cs.onSurfaceVariant),
              ),
            ),
            if (subtitle != null) ...<Widget>[
              const SizedBox(height: 4),
              Text(
                subtitle!,
                textAlign: TextAlign.center,
                style: Theme.of(context)
                    .textTheme
                    .bodySmall
                    ?.copyWith(color: cs.onSurfaceVariant),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Shared currency dropdown field for FX rules and visual transaction entry.
class CurrencyDropdownField extends StatelessWidget {
  const CurrencyDropdownField({
    super.key,
    required this.value,
    required this.currencies,
    required this.onChanged,
    this.labelText = '币种',
  });

  final String value;
  final List<String> currencies;
  final ValueChanged<String?> onChanged;
  final String labelText;

  @override
  Widget build(BuildContext context) {
    return DropdownButtonFormField<String>(
      key: ValueKey<String>(value),
      initialValue: value,
      isExpanded: true,
      decoration: InputDecoration(
        labelText: labelText,
        border: const OutlineInputBorder(),
      ),
      items: currencies
          .map(
            (code) => DropdownMenuItem<String>(
              value: code,
              child: Text(code),
            ),
          )
          .toList(),
      onChanged: onChanged,
    );
  }
}
