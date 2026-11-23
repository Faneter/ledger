part of '../ledger_engine.dart';

mixin _LedgerEnginePersistenceMixin on _LedgerEngineBase {
  @override
  void _recomputeSeqWatermarks() {
    var maxMbId = 0;
    for (final b in monthlyBudgets) {
      final id = _asInt(b['id']);
      if (id > maxMbId) maxMbId = id;
    }
    _monthlyBudgetSeq = maxMbId;

    var maxRuleId = 0;
    for (final r in recurringRules) {
      final id = _asInt(r['id']);
      if (id > maxRuleId) maxRuleId = id;
    }
    _recurringSeq = maxRuleId;

    var maxTxSeq = 0;
    var maxItemId = 0;
    final txMobilePattern = RegExp(r'^tx_mobile_(\d+)$');
    for (final tx in transactions) {
      final h = tx['header'] as Map<String, dynamic>?;
      final txId = h?['id']?.toString() ?? '';
      final m = txMobilePattern.firstMatch(txId);
      if (m != null) {
        final seq = int.tryParse(m.group(1)!) ?? 0;
        if (seq > maxTxSeq) maxTxSeq = seq;
      }
      final items = tx['items'];
      if (items is List) {
        for (final rawItem in items) {
          if (rawItem is Map) {
            final itemId = _asInt(rawItem['id']);
            if (itemId > maxItemId) maxItemId = itemId;
          }
        }
      }
    }
    if (maxTxSeq > _txSeq) _txSeq = maxTxSeq;
    if (maxItemId > _itemSeq) _itemSeq = maxItemId;

    for (final op in syncOplog) {
      final hlcStr = (op['hlc'] ?? op['hlc_ts']) as String?;
      if (hlcStr != null && hlcStr.isNotEmpty) {
        try {
          hlc.receive(hlcStr);
        } catch (_) {}
      }
    }
  }

  String _encodeDiskSnapshot() {
    final snapshot = <String, dynamic>{
      'schemaVersion': 1,
      ...exportFullSyncBundle(),
      'serverUrl': serverUrl,
      'serverEpochId': serverEpochId,
      'serverResetDetected': serverResetDetected,
      'isOfflineMode': isOfflineMode,
      'lastSyncAt': lastSyncAt,
      'lastSyncError': lastSyncError,
      'syncedOplogCount': syncedOplogCount,
      'conflicts': _cloneListOfMaps(conflicts),
      'dismissedRecurringRuleIds': dismissedRecurringRuleIds.toList(),
      'txSeq': _txSeq,
      'itemSeq': _itemSeq,
    };
    return jsonEncode(snapshot);
  }

  /// Marks state dirty, notifies listeners synchronously, and schedules debounced Isolate persistence.
  @override
  void scheduleSave() {
    _persistGeneration += 1;
    notifyListeners();
    if (_suppressPersist || _storageFilePath == null || _isDisposed) return;
    _scheduleSaveToDisk();
  }

  void _scheduleSaveToDisk() {
    _persistDebounceTimer?.cancel();
    _persistDebounceTimer = Timer(const Duration(milliseconds: 60), () {
      _kickOffIsolatePersist();
    });
  }

  void _kickOffIsolatePersist() {
    final path = _storageFilePath;
    if (_suppressPersist || path == null || _isDisposed) return;
    if (_activePersistFuture != null) return;
    final gen = _persistGeneration;
    if (gen <= _persistedGeneration && File(path).existsSync()) {
      return;
    }
    final encoded = _encodeDiskSnapshot();
    final future = Isolate.run(
      () => _writeAtomicFileSync(path, encoded, '$path.$gen.bg.tmp'),
    );
    _activePersistFuture = future;
    future.then((_) {
      if (gen > _persistedGeneration) {
        _persistedGeneration = gen;
      }
    }).catchError((Object _) {
      // Avoid crashing UI on transient storage IO failures
    }).whenComplete(() {
      if (identical(_activePersistFuture, future)) {
        _activePersistFuture = null;
      }
      if (!_isDisposed &&
          !_suppressPersist &&
          _persistGeneration > _persistedGeneration) {
        _scheduleSaveToDisk();
      }
    });
  }

  /// Flushes any debounced writes and waits for any in-flight Isolate write to finish.
  Future<void> flushPendingSaves() async {
    _persistDebounceTimer?.cancel();
    _persistDebounceTimer = null;
    final path = _storageFilePath;
    if (_suppressPersist || path == null) return;
    if (_activePersistFuture != null) {
      try {
        await _activePersistFuture;
      } catch (_) {}
    }
    if (_persistGeneration > _persistedGeneration || !File(path).existsSync()) {
      saveToDisk();
    }
  }

  void dispose() {
    _isDisposed = true;
    saveToDisk();
    _listeners.clear();
  }

  @override
  void saveToDisk() {
    _persistDebounceTimer?.cancel();
    _persistDebounceTimer = null;
    final path = _storageFilePath;
    if (_suppressPersist || path == null) return;
    final gen = ++_persistGeneration;
    try {
      final encoded = _encodeDiskSnapshot();
      _writeAtomicFileSync(
        path,
        encoded,
        '$path.sync.tmp',
      );
      _persistedGeneration = gen;
    } catch (_) {
      // Avoid crashing UI actions on transient storage IO failures
    }
  }

  void _loadFromDisk() {
    final path = _storageFilePath;
    if (path == null) return;
    try {
      final file = File(path);
      if (!file.existsSync()) return;
      final raw = file.readAsStringSync().trim();
      if (raw.isEmpty) return;
      final decoded = jsonDecode(raw.replaceFirst('\uFEFF', ''));
      if (decoded is! Map) return;
      final map = Map<String, dynamic>.from(decoded);
      importFullSyncBundle(map);
      if (map['serverUrl'] is String &&
          (map['serverUrl'] as String).trim().isNotEmpty) {
        serverUrl = (map['serverUrl'] as String).trim();
      }
      serverEpochId = _asNullableStr(map['serverEpochId']);
      serverResetDetected = _asBool(map['serverResetDetected']);
      isOfflineMode = _asBool(map['isOfflineMode']);
      lastSyncAt = _asNullableStr(map['lastSyncAt']);
      lastSyncError = _asNullableStr(map['lastSyncError']);
      syncedOplogCount = _asInt(map['syncedOplogCount']).clamp(
        0,
        syncOplog.length,
      );
      if (map['conflicts'] is List) {
        conflicts = (map['conflicts'] as List<dynamic>)
            .whereType<Map<dynamic, dynamic>>()
            .map((e) => Map<String, dynamic>.from(e))
            .where((c) => c['conflict_type'] != 'VOUCHER_DOUBLE_SPEND')
            .toList();
      }
      if (map['dismissedRecurringRuleIds'] is List) {
        dismissedRecurringRuleIds =
            (map['dismissedRecurringRuleIds'] as List<dynamic>)
                .map((e) => _asInt(e))
                .where((id) => id > 0)
                .toSet();
      }
      _txSeq = math.max(_txSeq, _asInt(map['txSeq']));
      _itemSeq = math.max(_itemSeq, _asInt(map['itemSeq']));
    } catch (_) {
      // Ignore corrupt disk cache gracefully instead of blocking app launch
    }
  }
}
