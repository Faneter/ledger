import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:isolate';
import 'dart:math' as math;

import 'rust_bridge.dart';

part 'engine/engine_helpers.dart';
part 'engine/engine_seed.dart';
part 'engine/engine_base.dart';
part 'engine/engine_dsl_transactions.dart';
part 'engine/engine_tx_mutations.dart';
part 'engine/engine_budgets.dart';
part 'engine/engine_rules_projects.dart';
part 'engine/engine_persistence.dart';
part 'engine/engine_sync.dart';
part 'engine/engine_backup.dart';

typedef JsonHttpPost = Future<Map<String, dynamic>> Function(
  Uri uri,
  Map<String, dynamic> body,
);

/// Default FX rates matching `packages/core/src/types.ts` & `DEFAULT_FX_RATES`.
const Map<String, String> defaultFxRates = <String, String>{
  'CNY': '1.000000',
  'USD': '7.200000',
  'EUR': '7.800000',
  'JPY': '0.048000',
  'GBP': '9.100000',
  'HKD': '0.920000',
};

/// Returns today's date string (`YYYY-MM-DD`) in local timezone.
String getLocalTodayDateStr([DateTime? now]) {
  final d = now ?? DateTime.now();
  final y = d.year.toString().padLeft(4, '0');
  final m = d.month.toString().padLeft(2, '0');
  final day = d.day.toString().padLeft(2, '0');
  return '$y-$m-$day';
}

/// Stateful Flutter/Dart offline ledger engine synchronized with Web (`LocalLedgerEngine`)
/// and Server (`LedgerRepository`), delegating all core domain calculations to
/// Rust Core Engine (`packages/core-rs`) over `dart:ffi`.
class FlutterLedgerEngine extends _LedgerEngineBase
    with
        _LedgerEnginePersistenceMixin,
        _LedgerEngineBackupMixin,
        _LedgerEngineSyncMixin,
        _LedgerEngineBudgetsMixin,
        _LedgerEngineDslTransactionsMixin,
        _LedgerEngineTxMutationsMixin,
        _LedgerEngineRulesProjectsMixin {
  FlutterLedgerEngine({
    super.bridge,
    super.nodeId,
    super.serverUrl,
    super.httpPost,
    super.storageFilePath,
    bool seedDemoData = false,
  }) {
    _suppressPersist = true;
    try {
      if (seedDemoData) {
        resetToDefaultSeed();
      } else {
        resetToCleanState();
      }
      _loadFromDisk();
    } finally {
      _suppressPersist = false;
    }
  }
}
