import 'package:material_ui/material_ui.dart';

import '../ledger_engine.dart';
import '../widgets/common_ui.dart';

/// Appearance preferences section: system/light/dark mode and Material You Monet toggle.
class AppearanceSettingsSection extends StatelessWidget {
  const AppearanceSettingsSection({
    super.key,
    required this.engine,
    required this.monetSeedArgb,
    required this.onAppearanceChanged,
    required this.onLocalChanged,
  });

  final FlutterLedgerEngine engine;
  final int? monetSeedArgb;
  final VoidCallback onAppearanceChanged;
  final VoidCallback onLocalChanged;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final currentThemePref = engine.themeModePreference;
    final useMonet = engine.useMonetColor;
    final monetAvailable = monetSeedArgb != null;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        const LedgerSectionHeader(
          title: '外观与主题',
          icon: Icons.palette_outlined,
        ),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                Text(
                  '明暗模式',
                  style: Theme.of(context).textTheme.labelMedium?.copyWith(
                        color: cs.onSurfaceVariant,
                      ),
                ),
                const SizedBox(height: 8),
                SegmentedButton<String>(
                  showSelectedIcon: false,
                  segments: const <ButtonSegment<String>>[
                    ButtonSegment<String>(
                      value: 'system',
                      icon: Icon(Icons.brightness_auto_outlined, size: 17),
                      label: Text('跟随系统'),
                    ),
                    ButtonSegment<String>(
                      value: 'light',
                      icon: Icon(Icons.light_mode_outlined, size: 17),
                      label: Text('浅色'),
                    ),
                    ButtonSegment<String>(
                      value: 'dark',
                      icon: Icon(Icons.dark_mode_outlined, size: 17),
                      label: Text('深色'),
                    ),
                  ],
                  selected: <String>{currentThemePref},
                  onSelectionChanged: (sel) {
                    engine.updateAppearanceSettings(themeMode: sel.first);
                    onLocalChanged();
                    onAppearanceChanged();
                  },
                ),
                const Divider(height: 22),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Row(
                    children: <Widget>[
                      const Flexible(child: Text('莫奈取色 (Material You)')),
                      const SizedBox(width: 8),
                      Container(
                        width: 14,
                        height: 14,
                        decoration: BoxDecoration(
                          color: useMonet && monetAvailable
                              ? Color(monetSeedArgb!)
                              : const Color(0xFF0F766E),
                          shape: BoxShape.circle,
                          border: Border.all(
                            color: cs.outlineVariant,
                            width: 1,
                          ),
                        ),
                      ),
                    ],
                  ),
                  subtitle: Text(
                    monetAvailable
                        ? (useMonet
                            ? '已从系统壁纸提取动态主题色'
                            : '已关闭壁纸取色，当前使用默认青绿主题')
                        : '当前设备暂未提供壁纸取色接口，使用默认青绿主题',
                  ),
                  value: useMonet,
                  onChanged: (v) {
                    engine.updateAppearanceSettings(useMonetColor: v);
                    onLocalChanged();
                    onAppearanceChanged();
                  },
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

/// Foreign-currency default hold & cashback parameters section.
class FxSettingsSection extends StatelessWidget {
  const FxSettingsSection({
    super.key,
    required this.holdPctCtrl,
    required this.cashbackPctCtrl,
    required this.onSave,
  });

  final TextEditingController holdPctCtrl;
  final TextEditingController cashbackPctCtrl;
  final VoidCallback onSave;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        const LedgerSectionHeader(
          title: '外币默认参数',
          icon: Icons.currency_exchange_outlined,
        ),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                Row(
                  children: <Widget>[
                    Expanded(
                      child: TextField(
                        controller: holdPctCtrl,
                        keyboardType: const TextInputType.numberWithOptions(
                          decimal: true,
                        ),
                        decoration: const InputDecoration(
                          labelText: '默认冻结比例 (%)',
                          suffixText: '%',
                          border: OutlineInputBorder(),
                          isDense: true,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: TextField(
                        controller: cashbackPctCtrl,
                        keyboardType: const TextInputType.numberWithOptions(
                          decimal: true,
                        ),
                        decoration: const InputDecoration(
                          labelText: '默认返现比例 (%)',
                          suffixText: '%',
                          border: OutlineInputBorder(),
                          isDense: true,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    FilledButton.tonal(
                      onPressed: onSave,
                      child: const Text('保存'),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  '跨月结余滚存已在切换或进入新月份时自动计算并继承。',
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall
                      ?.copyWith(color: cs.onSurfaceVariant),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
