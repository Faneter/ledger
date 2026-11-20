import 'package:material_ui/material_ui.dart';

import 'src/home_screen.dart';
import 'src/ledger_engine.dart';
import 'src/platform_backup.dart';
import 'src/ui_helpers.dart';

export 'src/home_screen.dart' show LedgerHomeScreen;

void main() {
  runApp(const GeekLedgerApp());
}

class GeekLedgerApp extends StatefulWidget {
  const GeekLedgerApp({
    super.key,
    this.engine,
    this.monetSeedArgb,
    this.onPickBackupFile,
    this.onSaveBackupFile,
  });

  final FlutterLedgerEngine? engine;
  final int? monetSeedArgb;
  final JsonFilePicker? onPickBackupFile;
  final JsonFileSaver? onSaveBackupFile;

  @override
  State<GeekLedgerApp> createState() => _GeekLedgerAppState();
}

class _GeekLedgerAppState extends State<GeekLedgerApp>
    with WidgetsBindingObserver {
  FlutterLedgerEngine? _ownedEngine;
  EngineChangeNotifier? _engineNotifier;
  String? _initError;
  int? _monetSeedArgb;
  String _lastThemePref = 'system';
  bool _lastUseMonet = true;
  int? _cachedSeedArgb;
  ThemeData? _cachedLightTheme;
  ThemeData? _cachedDarkTheme;

  FlutterLedgerEngine? get _activeEngine => widget.engine ?? _ownedEngine;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _monetSeedArgb =
        widget.monetSeedArgb ?? MobilePlatformBridge.getMonetSeedColorSync();
    if (widget.engine == null) {
      _initOwnedEngineSync();
    }
    _syncAppearanceSnapshot();
    _attachEngineNotifier(_activeEngine);
  }

  @override
  void didUpdateWidget(covariant GeekLedgerApp oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.engine != widget.engine) {
      _attachEngineNotifier(_activeEngine);
    }
    if (widget.monetSeedArgb != oldWidget.monetSeedArgb) {
      _monetSeedArgb = widget.monetSeedArgb ??
          MobilePlatformBridge.getMonetSeedColorSync();
    }
    _syncAppearanceSnapshot();
  }

  void _initOwnedEngineSync() {
    try {
      final storagePath = MobilePlatformBridge.getStorageFilePathSync();
      final engine = FlutterLedgerEngine(storageFilePath: storagePath);
      final currentYm = getLocalTodayDateStr().substring(0, 7);
      engine.ensureAutoRolloverForMonth(currentYm);
      _ownedEngine = engine;
    } catch (e) {
      _initError = e.toString();
    }
  }

  void _syncAppearanceSnapshot() {
    final engine = _activeEngine;
    _lastThemePref = engine?.themeModePreference ?? 'system';
    _lastUseMonet = engine?.useMonetColor ?? true;
  }

  void _onEngineChangedForAppearance() {
    final engine = _activeEngine;
    if (!mounted || engine == null) return;
    final nextTheme = engine.themeModePreference;
    final nextMonet = engine.useMonetColor;
    if (nextTheme != _lastThemePref || nextMonet != _lastUseMonet) {
      _lastThemePref = nextTheme;
      _lastUseMonet = nextMonet;
      setState(() {});
    }
  }

  void _attachEngineNotifier(FlutterLedgerEngine? engine) {
    if (_engineNotifier?.engine == engine) return;
    _engineNotifier?.removeListener(_onEngineChangedForAppearance);
    _engineNotifier?.dispose();
    _engineNotifier = engine == null ? null : EngineChangeNotifier(engine);
    _engineNotifier?.addListener(_onEngineChangedForAppearance);
  }

  void _refreshMonetColor() {
    if (widget.monetSeedArgb != null) return;
    final monetArgb = MobilePlatformBridge.getMonetSeedColorSync();
    if (mounted && monetArgb != _monetSeedArgb) {
      setState(() => _monetSeedArgb = monetArgb);
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _refreshMonetColor();
    } else if (state == AppLifecycleState.inactive ||
        state == AppLifecycleState.paused ||
        state == AppLifecycleState.detached) {
      _activeEngine?.saveToDisk();
    }
  }

  @override
  void dispose() {
    _engineNotifier?.removeListener(_onEngineChangedForAppearance);
    _engineNotifier?.dispose();
    if (_ownedEngine != null) {
      _ownedEngine!.dispose();
    } else {
      widget.engine?.saveToDisk();
    }
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  ThemeMode _resolveThemeMode() {
    final pref = _activeEngine?.themeModePreference ?? 'system';
    switch (pref) {
      case 'light':
        return ThemeMode.light;
      case 'dark':
        return ThemeMode.dark;
      case 'system':
      default:
        return ThemeMode.system;
    }
  }

  Color _resolveSeedColor() {
    final engine = _activeEngine;
    final useMonet = engine?.useMonetColor ?? true;
    final effectiveMonet = widget.monetSeedArgb ?? _monetSeedArgb;
    if (useMonet && effectiveMonet != null) {
      return Color(effectiveMonet);
    }
    return const Color(0xFF0F766E);
  }

  void _ensureCachedThemes(Color seedColor) {
    final argb = seedColor.toARGB32();
    if (_cachedSeedArgb == argb &&
        _cachedLightTheme != null &&
        _cachedDarkTheme != null) {
      return;
    }
    _cachedSeedArgb = argb;
    _cachedLightTheme = _buildTheme(Brightness.light, seedColor);
    _cachedDarkTheme = _buildTheme(Brightness.dark, seedColor);
  }

  ThemeData _buildTheme(Brightness brightness, Color seedColor) {
    final scheme = ColorScheme.fromSeed(
      seedColor: seedColor,
      brightness: brightness,
    );
    return ThemeData(
      colorScheme: scheme,
      useMaterial3: true,
      cardTheme: CardThemeData(
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(
            color: scheme.outlineVariant.withValues(alpha: 0.45),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final seedColor = _resolveSeedColor();
    _ensureCachedThemes(seedColor);
    final themeMode = _resolveThemeMode();
    final engine = _activeEngine;

    return MaterialApp(
      title: 'Geek Ledger',
      debugShowCheckedModeBanner: false,
      themeMode: themeMode,
      theme: _cachedLightTheme,
      darkTheme: _cachedDarkTheme,
      home: _initError != null
          ? Scaffold(
              appBar: AppBar(title: const Text('初始化失败')),
              body: Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: SelectableText(
                    'Rust Core FFI 初始化失败：\n$_initError',
                    style: const TextStyle(color: Colors.red),
                  ),
                ),
              ),
            )
          : LedgerHomeScreen(
              engine: engine!,
              monetSeedArgb: widget.monetSeedArgb ?? _monetSeedArgb,
              onAppearanceChanged: () {
                _syncAppearanceSnapshot();
                if (mounted) setState(() {});
              },
              onPickBackupFile: widget.onPickBackupFile,
              onSaveBackupFile: widget.onSaveBackupFile,
            ),
    );
  }
}
