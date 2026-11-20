part of '../ledger_engine.dart';

mixin _LedgerEngineSyncMixin on _LedgerEngineBase {
  Map<String, dynamic> processSync(List<Map<String, dynamic>> incomingOps) {
    final res = _bridge.mergeOplogEntries(
      existingOps: syncOplog,
      incomingOps: incomingOps,
      nowIso: _nowIso(),
    );
    final mergedRaw = res['mergedOps'] as List<dynamic>;
    final winnersRaw = res['winningEntities'] as Map<dynamic, dynamic>;
    syncOplog = mergedRaw
        .map((e) => Map<String, dynamic>.from(e as Map<dynamic, dynamic>))
        .toList();

    final incomingHlcs = incomingOps
        .map((o) => (o['hlc'] ?? o['hlc_ts']) as String)
        .toSet();
    final accepted = winnersRaw.values
        .map((e) => Map<String, dynamic>.from(e as Map<dynamic, dynamic>))
        .where((op) => incomingHlcs.contains((op['hlc'] ?? op['hlc_ts']) as String))
        .toList()
      ..sort(
        (a, b) => ((a['hlc'] ?? a['hlc_ts']) as String)
            .compareTo((b['hlc'] ?? b['hlc_ts']) as String),
      );

    for (final op in accepted) {
      hlc.receive((op['hlc'] ?? op['hlc_ts']) as String);
      _applyAcceptedOp(op);
    }
    return <String, dynamic>{
      'acceptedCount': accepted.length,
      'totalOplogCount': syncOplog.length,
    };
  }

  @override
  void _applyAcceptedOp(Map<String, dynamic> op) {
    final entityType = op['entity_type'] as String;
    final entityId = op['entity_id'] as String;
    final opType = op['op_type'] as String;
    final payload =
        jsonDecode(op['payload_json'] as String) as Map<String, dynamic>;

    switch (entityType) {
      case 'TRANSACTION':
        if (opType == 'DELETE') {
          final idx = transactions.indexWhere(
            (t) => (t['header'] as Map<String, dynamic>)['id'] == entityId,
          );
          if (idx != -1) {
            (transactions[idx]['header'] as Map<String, dynamic>)['is_deleted'] =
                true;
          }
        } else {
          final idx = transactions.indexWhere(
            (t) => (t['header'] as Map<String, dynamic>)['id'] == entityId,
          );
          if (idx != -1) {
            transactions[idx] = payload;
          } else {
            transactions.add(payload);
          }
        }
        break;
      case 'VOUCHER':
        final vid = int.tryParse(entityId);
        if (opType == 'DELETE' && vid != null) {
          vouchers.removeWhere((v) => v['id'] == vid);
        } else {
          final idx = vouchers.indexWhere((v) => v['id'] == payload['id']);
          if (idx != -1) {
            vouchers[idx] = payload;
          } else {
            vouchers.add(payload);
          }
        }
        break;
      case 'MONTHLY_BUDGET':
        final idx = monthlyBudgets.indexWhere(
          (b) => '${b['year_month']}:${b['pool_id']}' == entityId,
        );
        if (idx != -1) {
          monthlyBudgets[idx] = payload;
        } else {
          monthlyBudgets.add(payload);
        }
        break;
      case 'BUDGET_POOL':
        final idx = budgetPools.indexWhere((p) => p['id'] == entityId);
        if (idx != -1) {
          budgetPools[idx] = payload;
        } else {
          budgetPools.add(payload);
        }
        break;
      case 'PROJECT_TAG':
        if (opType == 'DELETE') {
          projectTags.removeWhere((t) => t['id'] == entityId);
        } else {
          final idx = projectTags.indexWhere((t) => t['id'] == entityId);
          if (idx != -1) {
            projectTags[idx] = payload;
          } else {
            projectTags.add(payload);
          }
        }
        break;
      case 'RECURRING_RULE':
        final rid = int.tryParse(entityId);
        if (opType == 'DELETE' && rid != null) {
          recurringRules.removeWhere((r) => r['id'] == rid);
        } else {
          final idx = recurringRules.indexWhere((r) => r['id'] == payload['id']);
          if (idx != -1) {
            recurringRules[idx] = payload;
          } else {
            recurringRules.add(payload);
          }
        }
        break;
      default:
        break;
    }
  }

  String _normalizedServerUrl([String? override]) {
    final raw = (override ?? serverUrl).trim().replaceAll(RegExp(r'/+$'), '');
    if (raw.isEmpty) {
      throw const FormatException('请先填写服务端同步地址');
    }
    final uri = Uri.tryParse(raw);
    if (uri == null ||
        !(uri.scheme == 'http' || uri.scheme == 'https') ||
        uri.host.isEmpty) {
      throw FormatException('同步地址格式无效: $raw');
    }
    return raw;
  }

  Future<Map<String, dynamic>> syncWithServer({String? baseUrl}) async {
    if (isOfflineMode) {
      return <String, dynamic>{
        'success': false,
        'skipped': true,
        'message': '当前处于「仅存本地」模式，已暂停向云端同步',
      };
    }
    if (serverResetDetected) {
      return <String, dynamic>{
        'success': false,
        'serverResetDetected': true,
        'message': '检测到云端数据曾发生重置或还原，请先在同步中心确认恢复方式',
      };
    }
    if (isSyncing) {
      return <String, dynamic>{
        'success': false,
        'message': '正在同步中，请稍候...',
      };
    }

    isSyncing = true;
    lastSyncError = null;
    try {
      final targetBase = _normalizedServerUrl(baseUrl);
      if (baseUrl != null) {
        serverUrl = targetBase;
      }

      final startIdx = syncedOplogCount.clamp(0, syncOplog.length);
      final opsToPush = syncOplog.sublist(startIdx);
      final data = await _httpPost(
        Uri.parse('$targetBase/api/sync/exchange'),
        <String, dynamic>{'ops': opsToPush},
      );

      final remoteEpoch = data['serverEpochId'] as String?;
      if (serverEpochId != null &&
          remoteEpoch != null &&
          remoteEpoch != serverEpochId) {
        serverResetDetected = true;
        return <String, dynamic>{
          'success': false,
          'serverResetDetected': true,
          'message': '检测到服务端数据已被重置，已保护性挂起自动同步！请打开同步中心确认处理。',
        };
      }
      if (remoteEpoch != null && remoteEpoch.isNotEmpty) {
        serverEpochId = remoteEpoch;
      }

      if (data['serverOps'] is List) {
        for (final op in data['serverOps'] as List<dynamic>) {
          if (op is Map && op['hlc'] is String) {
            try {
              hlc.receive(op['hlc'] as String);
            } catch (_) {}
          }
        }
      }

      if (data['fullBundle'] is Map) {
        final prevSuppress = _suppressPersist;
        _suppressPersist = true;
        try {
          importFullSyncBundle(
            Map<String, dynamic>.from(
              data['fullBundle'] as Map<dynamic, dynamic>,
            ),
          );
        } finally {
          _suppressPersist = prevSuppress;
        }
      }
      if (data['conflicts'] is List) {
        conflicts = (data['conflicts'] as List<dynamic>)
            .whereType<Map<dynamic, dynamic>>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
      }
      syncedOplogCount = syncOplog.length;
      lastSyncAt = _nowIso();
      lastSyncError = null;

      return <String, dynamic>{
        'success': true,
        'pushedCount': opsToPush.length,
        'appliedCount': (data['appliedCount'] as num?)?.toInt() ?? 0,
        'totalOplogCount': syncOplog.length,
        'pendingConflicts': pendingConflicts.length,
      };
    } catch (e) {
      lastSyncError = e.toString();
      return <String, dynamic>{
        'success': false,
        'error': lastSyncError,
        'message': '连接服务端失败: $e',
      };
    } finally {
      isSyncing = false;
      saveToDisk();
      notifyListeners();
    }
  }

  Future<Map<String, dynamic>> pullFromServerReset({String? baseUrl}) async {
    isSyncing = true;
    lastSyncError = null;
    try {
      final targetBase = _normalizedServerUrl(baseUrl);
      if (baseUrl != null) {
        serverUrl = targetBase;
      }
      final data = await _httpPost(
        Uri.parse('$targetBase/api/sync/exchange'),
        <String, dynamic>{'ops': <dynamic>[]},
      );
      if (data['serverEpochId'] is String) {
        serverEpochId = data['serverEpochId'] as String;
      }
      serverResetDetected = false;
      if (data['fullBundle'] is Map) {
        final prevSuppress = _suppressPersist;
        _suppressPersist = true;
        try {
          importFullSyncBundle(
            Map<String, dynamic>.from(
              data['fullBundle'] as Map<dynamic, dynamic>,
            ),
          );
        } finally {
          _suppressPersist = prevSuppress;
        }
      }
      if (data['conflicts'] is List) {
        conflicts = (data['conflicts'] as List<dynamic>)
            .whereType<Map<dynamic, dynamic>>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
      }
      syncedOplogCount = syncOplog.length;
      lastSyncAt = _nowIso();
      return <String, dynamic>{
        'success': true,
        'totalOplogCount': syncOplog.length,
      };
    } catch (e) {
      lastSyncError = e.toString();
      rethrow;
    } finally {
      isSyncing = false;
      saveToDisk();
      notifyListeners();
    }
  }

  Future<Map<String, dynamic>> pushLocalBundleToServer({String? baseUrl}) async {
    isSyncing = true;
    lastSyncError = null;
    try {
      final targetBase = _normalizedServerUrl(baseUrl);
      if (baseUrl != null) {
        serverUrl = targetBase;
      }
      final bundle = exportFullSyncBundle();
      final res = await _httpPost(
        Uri.parse('$targetBase/api/sync/reseed'),
        <String, dynamic>{'bundle': bundle},
      );
      serverEpochId = null;
      serverResetDetected = false;
      syncedOplogCount = syncOplog.length;
      lastSyncAt = _nowIso();
      lastSyncError = null;
      return <String, dynamic>{
        'success': true,
        'restored': res['restored'] == true,
        'oplogCount': (res['oplogCount'] as num?)?.toInt() ?? syncOplog.length,
        'transactionsCount': transactions.length,
      };
    } catch (e) {
      lastSyncError = e.toString();
      rethrow;
    } finally {
      isSyncing = false;
      saveToDisk();
      notifyListeners();
    }
  }

  Future<Map<String, dynamic>> resolveConflict(
    String conflictId,
    String resolution, {
    String? baseUrl,
  }) async {
    final targetBase = _normalizedServerUrl(baseUrl);
    final res = await _httpPost(
      Uri.parse(
        '$targetBase/api/conflicts/${Uri.encodeComponent(conflictId)}/resolve',
      ),
      <String, dynamic>{'resolution': resolution},
    );
    if (res['conflicts'] is List) {
      conflicts = (res['conflicts'] as List<dynamic>)
          .whereType<Map<dynamic, dynamic>>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();
      saveToDisk();
      notifyListeners();
    }
    return syncWithServer(baseUrl: targetBase);
  }
}
