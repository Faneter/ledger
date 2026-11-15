import 'dart:convert';
import 'dart:ffi';
import 'dart:io';
import 'dart:typed_data';

typedef _LedgerAllocNative = Pointer<Uint8> Function(Uint32 len);
typedef _LedgerAllocDart = Pointer<Uint8> Function(int len);

typedef _LedgerDeallocNative = Void Function(Pointer<Uint8> ptr, Uint32 len);
typedef _LedgerDeallocDart = void Function(Pointer<Uint8> ptr, int len);

typedef _LedgerInvokeNative = Pointer<Uint8> Function(
  Pointer<Uint8> reqPtr,
  Uint32 reqLen,
  Pointer<Uint32> outLenPtr,
);
typedef _LedgerInvokeDart = Pointer<Uint8> Function(
  Pointer<Uint8> reqPtr,
  int reqLen,
  Pointer<Uint32> outLenPtr,
);

/// Error thrown when the Rust Core Engine returns `ok: false` or FFI fails.
class RustCoreException implements Exception {
  RustCoreException(this.message, [this.op]);

  final String message;
  final String? op;

  @override
  String toString() =>
      op != null ? 'RustCoreException($op): $message' : 'RustCoreException: $message';
}

/// Zero-dependency dart:ffi bridge to the compiled `packages/core-rs` native library.
class RustCoreBridge {
  RustCoreBridge._(DynamicLibrary library)
      : _alloc = library
            .lookupFunction<_LedgerAllocNative, _LedgerAllocDart>('ledger_alloc'),
        _dealloc = library
            .lookupFunction<_LedgerDeallocNative, _LedgerDeallocDart>('ledger_dealloc'),
        _invoke = library
            .lookupFunction<_LedgerInvokeNative, _LedgerInvokeDart>('ledger_invoke');

  static RustCoreBridge? _shared;

  final _LedgerAllocDart _alloc;
  final _LedgerDeallocDart _dealloc;
  final _LedgerInvokeDart _invoke;

  /// Returns a cached singleton instance loaded from the default native library path.
  static RustCoreBridge instance({String? libraryPath}) {
    if (libraryPath != null) {
      return RustCoreBridge._(DynamicLibrary.open(libraryPath));
    }
    return _shared ??= RustCoreBridge._(_loadDefaultLibrary());
  }

  static DynamicLibrary _loadDefaultLibrary() {
    final envPath = Platform.environment['LEDGER_CORE_RS_LIB'];
    if (envPath != null && envPath.isNotEmpty && File(envPath).existsSync()) {
      return DynamicLibrary.open(envPath);
    }

    if (Platform.isIOS) {
      return DynamicLibrary.process();
    }

    final exeDir = File(Platform.resolvedExecutable).parent.path;
    final candidates = <String>[];

    if (Platform.isWindows) {
      candidates.addAll(<String>[
        'apps/mobile/native/win64/ledger_core_rs.dll',
        'native/win64/ledger_core_rs.dll',
        'packages/core-rs/target/release/ledger_core_rs.dll',
        '../../packages/core-rs/target/release/ledger_core_rs.dll',
        '$exeDir${Platform.pathSeparator}ledger_core_rs.dll',
        'ledger_core_rs.dll',
      ]);
    } else if (Platform.isAndroid || Platform.isLinux) {
      candidates.addAll(<String>[
        'libledger_core_rs.so',
        'apps/mobile/native/linux/libledger_core_rs.so',
        'packages/core-rs/target/release/libledger_core_rs.so',
        '../../packages/core-rs/target/release/libledger_core_rs.so',
        '$exeDir${Platform.pathSeparator}libledger_core_rs.so',
      ]);
    } else if (Platform.isMacOS) {
      candidates.addAll(<String>[
        'libledger_core_rs.dylib',
        'apps/mobile/native/macos/libledger_core_rs.dylib',
        'packages/core-rs/target/release/libledger_core_rs.dylib',
        '../../packages/core-rs/target/release/libledger_core_rs.dylib',
        '$exeDir${Platform.pathSeparator}libledger_core_rs.dylib',
      ]);
    }

    Object? lastError;
    for (final candidate in candidates) {
      if (candidate.contains(Platform.pathSeparator) || candidate.contains('/')) {
        if (!File(candidate).existsSync()) continue;
      }
      try {
        return DynamicLibrary.open(candidate);
      } catch (e) {
        lastError = e;
        // Continue trying fallback paths.
      }
    }

    throw StateError(
      'Unable to locate ledger_core_rs native library. '
      'Run `pnpm build:core-rs` or set LEDGER_CORE_RS_LIB.'
      '${lastError != null ? ' (last error: $lastError)' : ''}',
    );
  }

  /// Synchronously invokes a Rust Core operation via `ledger_invoke`.
  dynamic invokeRaw(Map<String, dynamic> payload) {
    final op = payload['op'] as String?;
    final reqBytes = utf8.encode(jsonEncode(payload));
    final allocLen = reqBytes.isEmpty ? 1 : reqBytes.length;

    final reqPtr = _alloc(allocLen);
    if (reqPtr == nullptr) {
      throw RustCoreException('ledger_alloc failed for request buffer', op);
    }

    // `ledger_alloc` guarantees 8-byte alignment, safe to cast to `Pointer<Uint32>`.
    final outLenPtr = _alloc(4).cast<Uint32>();
    if (outLenPtr == nullptr) {
      _dealloc(reqPtr, allocLen);
      throw RustCoreException('ledger_alloc failed for outLen pointer', op);
    }

    try {
      if (reqBytes.isNotEmpty) {
        reqPtr.asTypedList(reqBytes.length).setAll(0, reqBytes);
      }
      outLenPtr.value = 0;

      final respPtr = _invoke(reqPtr, reqBytes.length, outLenPtr);
      final respLen = outLenPtr.value;
      if (respPtr == nullptr || respLen == 0) {
        throw RustCoreException('ledger_invoke returned empty response', op);
      }

      try {
        final respCopy = Uint8List.fromList(respPtr.asTypedList(respLen));
        final decoded = jsonDecode(utf8.decode(respCopy)) as Map<String, dynamic>;
        if (decoded['ok'] != true) {
          final err = (decoded['error'] as String?) ?? 'Unknown Rust core error';
          throw RustCoreException(err, op);
        }
        return decoded['data'];
      } finally {
        _dealloc(respPtr, respLen);
      }
    } finally {
      _dealloc(reqPtr, allocLen);
      _dealloc(outLenPtr.cast<Uint8>(), 4);
    }
  }

  Map<String, dynamic> _invokeMap(Map<String, dynamic> payload) {
    final data = invokeRaw(payload);
    if (data is! Map) {
      throw RustCoreException(
        'Expected JSON object response, got ${data.runtimeType}',
        payload['op'] as String?,
      );
    }
    return Map<String, dynamic>.from(data);
  }

  List<Map<String, dynamic>> _invokeListOfMaps(Map<String, dynamic> payload) {
    final data = invokeRaw(payload);
    if (data is! List) {
      throw RustCoreException(
        'Expected JSON array response, got ${data.runtimeType}',
        payload['op'] as String?,
      );
    }
    return data
        .map((item) => Map<String, dynamic>.from(item as Map<dynamic, dynamic>))
        .toList();
  }

  // --------------------------------------------------------------------------
  // Money & Formatting Operations
  // --------------------------------------------------------------------------

  String roundCny(Object value) => invokeRaw(<String, dynamic>{
        'op': 'round_cny',
        'value': value.toString(),
      }) as String;

  String formatCny(Object value) => invokeRaw(<String, dynamic>{
        'op': 'format_cny',
        'value': value.toString(),
      }) as String;

  String roundRate(Object value) => invokeRaw(<String, dynamic>{
        'op': 'round_rate',
        'value': value.toString(),
      }) as String;

  String formatRate(Object value) => invokeRaw(<String, dynamic>{
        'op': 'format_rate',
        'value': value.toString(),
      }) as String;

  String sumCny(List<Object> values) => invokeRaw(<String, dynamic>{
        'op': 'sum_cny',
        'values': values.map((v) => v.toString()).toList(),
      }) as String;

  bool equalsCny(Object a, Object b) => invokeRaw(<String, dynamic>{
        'op': 'equals_cny',
        'a': a.toString(),
        'b': b.toString(),
      }) as bool;

  String generateVoucherTitle({
    required String voucherType,
    required Object faceValue,
    Object minSpend = '0.00',
  }) =>
      invokeRaw(<String, dynamic>{
        'op': 'generate_voucher_title',
        'voucherType': voucherType,
        'faceValue': faceValue.toString(),
        'minSpend': minSpend.toString(),
      }) as String;

  // --------------------------------------------------------------------------
  // DSL Parser & Math Evaluator
  // --------------------------------------------------------------------------

  Map<String, dynamic> evaluateMathFormula(String expr) =>
      _invokeMap(<String, dynamic>{
        'op': 'evaluate_math_formula',
        'expr': expr,
      });

  Map<String, dynamic> parseQuickInputDsl(
    String rawText, {
    List<Map<String, dynamic>>? categories,
    List<Map<String, dynamic>>? projectTags,
    List<Map<String, dynamic>>? budgetPools,
    Map<String, dynamic>? fxConfig,
  }) {
    final context = <String, dynamic>{
      if (categories != null) 'categories': categories,
      if (projectTags != null) 'projectTags': projectTags,
      if (budgetPools != null) 'budgetPools': budgetPools,
      if (fxConfig != null) 'fxConfig': fxConfig,
    };
    return _invokeMap(<String, dynamic>{
      'op': 'parse_quick_input_dsl',
      'rawText': rawText,
      if (context.isNotEmpty) 'context': context,
    });
  }

  // --------------------------------------------------------------------------
  // Allocation & Voucher Carryover Operations
  // --------------------------------------------------------------------------

  List<Map<String, dynamic>> allocateSplitDiscounts({
    required List<Map<String, dynamic>> items,
    required Object totalNetPaid,
    String mode = 'PROPORTIONAL',
    List<Object>? manualNets,
  }) =>
      _invokeListOfMaps(<String, dynamic>{
        'op': 'allocate_split_discounts',
        'items': items,
        'totalNetPaid': totalNetPaid.toString(),
        'mode': mode,
        if (manualNets != null)
          'manualNets': manualNets.map((v) => v.toString()).toList(),
      });

  Map<String, dynamic> applyVoucherToOrder({
    required Object orderGross,
    required Object cashActuallyPaidAfterVoucher,
    required Map<String, dynamic> voucher,
  }) =>
      _invokeMap(<String, dynamic>{
        'op': 'apply_voucher_to_order',
        'orderGross': orderGross.toString(),
        'cashActuallyPaidAfterVoucher': cashActuallyPaidAfterVoucher.toString(),
        'voucher': voucher,
      });

  Map<String, dynamic> computeOrderAllocation({
    required List<Map<String, dynamic>> items,
    required Object cashActuallyPaid,
    String mode = 'PROPORTIONAL',
    Map<String, dynamic>? voucher,
    List<Object>? manualNets,
  }) =>
      _invokeMap(<String, dynamic>{
        'op': 'compute_order_allocation',
        'items': items,
        'cashActuallyPaid': cashActuallyPaid.toString(),
        'mode': mode,
        if (voucher != null) 'voucher': voucher,
        if (manualNets != null)
          'manualNets': manualNets.map((v) => v.toString()).toList(),
      });

  // --------------------------------------------------------------------------
  // Mastercard FX Lifecycle
  // --------------------------------------------------------------------------

  Map<String, dynamic> processMastercardFxLifecycle({
    required Object foreignAmount,
    required Object holdAmountCny,
    Object? settledAmountCny,
    Object? holdRatio,
    Object? cashbackRate,
    Object? monthlyRemainingCapCny,
  }) =>
      _invokeMap(<String, dynamic>{
        'op': 'process_mastercard_fx_lifecycle',
        'foreignAmount': foreignAmount.toString(),
        'holdAmountCny': holdAmountCny.toString(),
        if (settledAmountCny != null)
          'settledAmountCny': settledAmountCny.toString(),
        if (holdRatio != null) 'holdRatio': holdRatio.toString(),
        if (cashbackRate != null) 'cashbackRate': cashbackRate.toString(),
        if (monthlyRemainingCapCny != null)
          'monthlyRemainingCapCny': monthlyRemainingCapCny.toString(),
      });

  // --------------------------------------------------------------------------
  // HLC & Sync OpLog LWW Merge
  // --------------------------------------------------------------------------

  Map<String, dynamic> hlcParse(String hlc) => _invokeMap(<String, dynamic>{
        'op': 'hlc_parse',
        'hlc': hlc,
      });

  int hlcCompare(String a, String b) => (invokeRaw(<String, dynamic>{
        'op': 'hlc_compare',
        'a': a,
        'b': b,
      }) as num)
          .toInt();

  Map<String, dynamic> hlcNow({
    required String nodeId,
    required int lastPhysicalTimeMs,
    required int counter,
    required int physicalTimeMs,
  }) =>
      _invokeMap(<String, dynamic>{
        'op': 'hlc_now',
        'nodeId': nodeId,
        'lastPhysicalTimeMs': lastPhysicalTimeMs,
        'counter': counter,
        'physicalTimeMs': physicalTimeMs,
      });

  Map<String, dynamic> hlcReceive({
    required String nodeId,
    required int lastPhysicalTimeMs,
    required int counter,
    required String remoteHlc,
    required int physicalTimeMs,
  }) =>
      _invokeMap(<String, dynamic>{
        'op': 'hlc_receive',
        'nodeId': nodeId,
        'lastPhysicalTimeMs': lastPhysicalTimeMs,
        'counter': counter,
        'remoteHlc': remoteHlc,
        'physicalTimeMs': physicalTimeMs,
      });

  Map<String, dynamic> mergeOplogEntries({
    required List<Map<String, dynamic>> existingOps,
    required List<Map<String, dynamic>> incomingOps,
    String? nowIso,
  }) =>
      _invokeMap(<String, dynamic>{
        'op': 'merge_oplog_entries',
        'existingOps': existingOps,
        'incomingOps': incomingOps,
        if (nowIso != null) 'nowIso': nowIso,
      });
}

/// Monotonic Hybrid Logical Clock backed by the shared Rust Core Engine.
class HybridLogicalClock {
  HybridLogicalClock({
    required this.nodeId,
    RustCoreBridge? bridge,
    int initialLastPhysicalTimeMs = 0,
    int initialCounter = 0,
  })  : _bridge = bridge ?? RustCoreBridge.instance(),
        _lastPhysicalTimeMs = initialLastPhysicalTimeMs,
        _counter = initialCounter;

  final String nodeId;
  final RustCoreBridge _bridge;
  int _lastPhysicalTimeMs;
  int _counter;

  int get lastPhysicalTimeMs => _lastPhysicalTimeMs;
  int get counter => _counter;

  String now([int? physicalTimeMs]) {
    final pt = physicalTimeMs ?? DateTime.now().millisecondsSinceEpoch;
    final res = _bridge.hlcNow(
      nodeId: nodeId,
      lastPhysicalTimeMs: _lastPhysicalTimeMs,
      counter: _counter,
      physicalTimeMs: pt,
    );
    _lastPhysicalTimeMs = (res['lastPhysicalTimeMs'] as num).toInt();
    _counter = (res['counter'] as num).toInt();
    return res['hlc'] as String;
  }

  String receive(String remoteHlc, [int? physicalTimeMs]) {
    final pt = physicalTimeMs ?? DateTime.now().millisecondsSinceEpoch;
    final res = _bridge.hlcReceive(
      nodeId: nodeId,
      lastPhysicalTimeMs: _lastPhysicalTimeMs,
      counter: _counter,
      remoteHlc: remoteHlc,
      physicalTimeMs: pt,
    );
    _lastPhysicalTimeMs = (res['lastPhysicalTimeMs'] as num).toInt();
    _counter = (res['counter'] as num).toInt();
    return res['hlc'] as String;
  }
}
