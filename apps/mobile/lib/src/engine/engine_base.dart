part of '../ledger_engine.dart';

abstract class _LedgerEngineBase {
  _LedgerEngineBase({
    RustCoreBridge? bridge,
    String nodeId = 'mobile-flutter',
    String serverUrl = 'http://127.0.0.1:3001',
    JsonHttpPost? httpPost,
    String? storageFilePath,
  })  : _bridge = bridge ?? RustCoreBridge.instance(),
        _httpPost = httpPost ?? _defaultJsonHttpPost,
        _storageFilePath = storageFilePath,
        hlc = HybridLogicalClock(
          nodeId: nodeId,
          bridge: bridge ?? RustCoreBridge.instance(),
        ) {
    this.serverUrl = serverUrl;
  }

  final RustCoreBridge _bridge;
  final JsonHttpPost _httpPost;
  final String? _storageFilePath;
  final HybridLogicalClock hlc;
  bool _suppressPersist = false;
  final Set<void Function()> _listeners = <void Function()>{};
  Timer? _persistDebounceTimer;
  Future<void>? _activePersistFuture;
  int _persistGeneration = 0;
  int _persistedGeneration = 0;
  bool _isDisposed = false;
  int _stateVersion = 0;
  int _cachedMonthlyVersion = -1;
  final Map<String, List<Map<String, dynamic>>> _monthlyStatusCache =
      <String, List<Map<String, dynamic>>>{};

  List<Map<String, dynamic>> budgetPools = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> monthlyBudgets = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> categories = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> projectTags = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> transactions = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> recurringRules = <Map<String, dynamic>>[];
  Map<String, String> settings = <String, String>{};
  List<Map<String, dynamic>> syncOplog = <Map<String, dynamic>>[];

  String serverUrl = 'http://127.0.0.1:3001';
  String? serverEpochId;
  bool serverResetDetected = false;
  bool isOfflineMode = false;
  bool isSyncing = false;
  String? lastSyncAt;
  String? lastSyncError;
  int syncedOplogCount = 0;
  List<Map<String, dynamic>> conflicts = <Map<String, dynamic>>[];
  Set<int> dismissedRecurringRuleIds = <int>{};

  int _txSeq = 0;
  int _itemSeq = 0;
  int _monthlyBudgetSeq = 0;
  int _recurringSeq = 0;

  int get stateVersion => _stateVersion;

  int get pendingSyncCount => math.max(0, syncOplog.length - syncedOplogCount);

  List<Map<String, dynamic>> get pendingConflicts =>
      conflicts.where((c) => c['status'] == 'PENDING').toList();

  String get themeModePreference => settings['theme_mode'] ?? 'system';

  bool get useMonetColor => settings['use_monet_color'] != 'false';

  void addListener(void Function() listener) {
    _listeners.add(listener);
  }

  void removeListener(void Function() listener) {
    _listeners.remove(listener);
  }

  void notifyListeners() {
    _stateVersion += 1;
    _monthlyStatusCache.clear();
    for (final listener in _listeners.toList()) {
      listener();
    }
  }

  void saveToDisk();
  void scheduleSave();
  void _recomputeSeqWatermarks();
  void recomputeSubsequentRolloversFrom(String sourceYearMonth);
  Map<String, dynamic> exportFullSyncBundle();
  Map<String, int> importFullSyncBundle(Map<String, dynamic> rawMap);
  void _applyAcceptedOp(Map<String, dynamic> op);

  /// Resets engine state back to the clean `default_seed_2026_11` snapshot.
  void resetToDefaultSeed() {
    budgetPools = _cloneListOfMaps(_seedBudgetPools);
    monthlyBudgets = _cloneListOfMaps(_seedMonthlyBudgets202611);
    categories = _cloneListOfMaps(_seedCategories);
    projectTags = _cloneListOfMaps(_seedProjectTags);
    recurringRules = _cloneListOfMaps(_seedRecurringRules);
    transactions = <Map<String, dynamic>>[];
    syncOplog = <Map<String, dynamic>>[];
    conflicts = <Map<String, dynamic>>[];
    dismissedRecurringRuleIds = <int>{};
    isOfflineMode = false;
    isSyncing = false;
    serverEpochId = null;
    serverResetDetected = false;
    lastSyncAt = null;
    lastSyncError = null;
    syncedOplogCount = 0;
    settings = <String, String>{
      'fx_default_cashback_rate': '0.0100',
      'fx_default_hold_ratio': '1.020',
    };
    _txSeq = 0;
    _itemSeq = 0;
    _monthlyBudgetSeq = 4;
    _recurringSeq = 2;
    saveToDisk();
    notifyListeners();
  }

  /// Resets engine state to a completely empty personal ledger with zero initial default data.
  void resetToCleanState({bool preserveAppearance = false}) {
    final prevThemeMode = settings['theme_mode'];
    final prevUseMonet = settings['use_monet_color'];
    budgetPools = <Map<String, dynamic>>[];
    monthlyBudgets = <Map<String, dynamic>>[];
    categories = <Map<String, dynamic>>[];
    projectTags = <Map<String, dynamic>>[];
    recurringRules = <Map<String, dynamic>>[];
    transactions = <Map<String, dynamic>>[];
    syncOplog = <Map<String, dynamic>>[];
    conflicts = <Map<String, dynamic>>[];
    dismissedRecurringRuleIds = <int>{};
    isOfflineMode = false;
    isSyncing = false;
    serverEpochId = null;
    serverResetDetected = false;
    lastSyncAt = null;
    lastSyncError = null;
    syncedOplogCount = 0;
    settings = <String, String>{
      'fx_default_cashback_rate': '0.0100',
      'fx_default_hold_ratio': '1.020',
      'theme_mode': preserveAppearance && prevThemeMode != null
          ? prevThemeMode
          : 'system',
      'use_monet_color': preserveAppearance && prevUseMonet != null
          ? prevUseMonet
          : 'true',
    };
    _txSeq = 0;
    _itemSeq = 0;
    _monthlyBudgetSeq = 0;
    _recurringSeq = 0;
    saveToDisk();
    notifyListeners();
  }

  String _nextTxId() {
    _txSeq += 1;
    return 'tx_mobile_$_txSeq';
  }

  String _nowIso() => DateTime.now().toUtc().toIso8601String();

  Map<String, dynamic> _getFxConfig() {
    return <String, dynamic>{
      'defaultCashbackRate': settings['fx_default_cashback_rate'] ?? '0.0100',
      'defaultHoldRatio': settings['fx_default_hold_ratio'] ?? '1.020',
      if (settings.containsKey('fx_monthly_cashback_cap_cny'))
        'monthlyCashbackCapCny': settings['fx_monthly_cashback_cap_cny'],
    };
  }

  void _appendOpLog(
    String entityType,
    String entityId,
    String opType,
    Object payload, [
    String? customHlc,
  ]) {
    final hlcTs = customHlc ?? hlc.now();
    syncOplog.add(<String, dynamic>{
      'hlc': hlcTs,
      'node_id': hlc.nodeId,
      'entity_type': entityType,
      'entity_id': entityId,
      'op_type': opType,
      'payload_json': jsonEncode(payload),
      'created_at': _nowIso(),
    });
    scheduleSave();
  }

  void _assertConservationLaw(Map<String, dynamic> txAgg) {
    final header = txAgg['header'] as Map<String, dynamic>;
    final items = txAgg['items'] as List<dynamic>;
    if (header['tx_type'] == 'EXPENSE' && items.isNotEmpty) {
      final sumGross = _bridge.sumCny(
        items
            .map((it) => (it as Map<String, dynamic>)['item_gross'] as Object)
            .toList(),
      );
      final sumNet = _bridge.sumCny(
        items
            .map((it) => (it as Map<String, dynamic>)['item_net'] as Object)
            .toList(),
      );
      if (!_bridge.equalsCny(sumGross, header['total_gross'] as Object) ||
          !_bridge.equalsCny(sumNet, header['total_net'] as Object)) {
        throw StateError(
          'Conservation law violated: header=(${header['total_gross']}, ${header['total_net']}), '
          'items=($sumGross, $sumNet)',
        );
      }
    }
  }

  String _getMonthlyRemainingFxCashbackCap(String yearMonth) {
    final capSetting = settings['fx_monthly_cashback_cap_cny'];
    if (capSetting == null || capSetting.trim().isEmpty) {
      return '999999999.00';
    }
    var usedCashback = BigInt.zero;
    for (final tx in transactions) {
      final h = tx['header'] as Map<String, dynamic>;
      if (h['is_deleted'] == true) continue;
      final txDate = (h['tx_date'] as String?) ?? '';
      final origCurr = (h['original_currency'] as String?) ?? 'CNY';
      if (txDate.startsWith(yearMonth) && origCurr != 'CNY') {
        usedCashback += _FixedMath.toCents(
          _bridge,
          (h['payment_discount'] as Object?) ?? '0.00',
        );
      }
    }
    final capCents = _FixedMath.toCents(_bridge, capSetting);
    final rem = capCents - usedCashback;
    return _FixedMath.fromCents(rem < BigInt.zero ? BigInt.zero : rem);
  }

  String _asMoney(dynamic v, [String fallback = '0.00']) {
    if (v == null) return fallback;
    if (v is String && v.trim().isEmpty) return fallback;
    try {
      return _bridge.formatCny(v as Object);
    } catch (_) {
      return fallback;
    }
  }

  String? _asNullableMoney(dynamic v) {
    if (v == null) return null;
    if (v is String && v.trim().isEmpty) return null;
    try {
      return _bridge.formatCny(v as Object);
    } catch (_) {
      return null;
    }
  }
}
