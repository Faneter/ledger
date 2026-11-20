import 'package:material_ui/material_ui.dart';

import '../ledger_engine.dart';
import '../ui_helpers.dart';

/// Pinned keyboard accessory toolbar providing quick DSL syntax & `#tag` insertion.
class DslAccessoryBar extends StatelessWidget {
  const DslAccessoryBar({
    super.key,
    required this.engine,
    required this.showTagBar,
    required this.onToggleTagBar,
    required this.onInsertToken,
  });

  final FlutterLedgerEngine engine;
  final bool showTagBar;
  final VoidCallback onToggleTagBar;
  final ValueChanged<String> onInsertToken;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final activeTags =
        engine.projectTags.where((t) => t['is_active'] != false).toList();

    return Container(
      decoration: BoxDecoration(
        color: cs.surfaceContainerLow,
        border: Border(top: BorderSide(color: cs.outlineVariant)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          if (showTagBar)
            SizedBox(
              height: 44,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                children: <Widget>[
                  if (engine.budgetPools.isEmpty && activeTags.isEmpty)
                    ActionChip(
                      visualDensity: VisualDensity.compact,
                      label: const Text('暂无预算池或专项标签'),
                      onPressed: onToggleTagBar,
                    ),
                  for (final pool in engine.budgetPools)
                    Padding(
                      padding: const EdgeInsets.only(right: 6),
                      child: ActionChip(
                        visualDensity: VisualDensity.compact,
                        label: Text(dslTagForPool(pool)),
                        onPressed: () {
                          onInsertToken(' ${dslTagForPool(pool)} ');
                          onToggleTagBar();
                        },
                      ),
                    ),
                  for (final tag in activeTags)
                    Padding(
                      padding: const EdgeInsets.only(right: 6),
                      child: ActionChip(
                        visualDensity: VisualDensity.compact,
                        avatar: Icon(
                          Icons.flag_outlined,
                          size: 14,
                          color: cs.secondary,
                        ),
                        label: Text('#${tag['name']}'),
                        onPressed: () {
                          onInsertToken(' #${tag['name']} ');
                          onToggleTagBar();
                        },
                      ),
                    ),
                ],
              ),
            ),
          SizedBox(
            height: 48,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              children: <Widget>[
                _accessoryButton(cs, ' + ', () => onInsertToken(' + ')),
                _accessoryButton(cs, ' - ', () => onInsertToken('-')),
                _accessoryButton(cs, ' * ', () => onInsertToken(' *')),
                _accessoryButton(cs, ' = ', () => onInsertToken(' = ')),
                _accessoryButton(
                  cs,
                  ' #标签 ',
                  onToggleTagBar,
                  highlighted: showTagBar,
                ),
                _accessoryButton(cs, ' \$外币 ', () => onInsertToken(' \$')),
                _accessoryButton(cs, ' 冻结 ', () => onInsertToken(' 冻结')),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _accessoryButton(
    ColorScheme cs,
    String label,
    VoidCallback onTap, {
    bool highlighted = false,
  }) {
    return Padding(
      padding: const EdgeInsets.only(right: 6),
      child: Material(
        color: highlighted ? cs.primaryContainer : cs.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(10),
        child: InkWell(
          borderRadius: BorderRadius.circular(10),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            child: Center(
              child: Text(
                label.trim(),
                style: TextStyle(
                  fontWeight: FontWeight.w700,
                  fontSize: 13,
                  color: highlighted ? cs.onPrimaryContainer : cs.onSurface,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
