import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'rust_bridge.dart';

typedef JsonHttpPost = Future<Map<String, dynamic>> Function(
  Uri uri,
  Map<String, dynamic> body,
);

Future<Map<String, dynamic>> _defaultJsonHttpPost(
  Uri uri,
  Map<String, dynamic> body,
) async {
  final client = HttpClient()
    ..connectionTimeout = const Duration(seconds: 5);
  try {
    final req = await client.postUrl(uri);
    req.headers.contentType = ContentType.json;
    req.headers.set(HttpHeaders.acceptHeader, 'application/json');
    req.write(jsonEncode(body));
    final resp = await req.close().timeout(const Duration(seconds: 8));
    final respBody = await resp.transform(utf8.decoder).join();
    if (resp.statusCode >= 400) {
      String msg = 'HTTP ${resp.statusCode}';
      if (respBody.isNotEmpty) {
        try {
          final parsed = jsonDecode(respBody);
          if (parsed is Map && parsed['error'] != null) {
            msg = '${parsed['error']} (HTTP ${resp.statusCode})';
          }
        } catch (_) {}
      }
      throw HttpException(msg, uri: uri);
    }
    if (respBody.trim().isEmpty) {
      return <String, dynamic>{};
    }
    final decoded = jsonDecode(respBody);
    if (decoded is Map) {
      return Map<String, dynamic>.from(decoded);
    }
    throw const FormatException('同步服务端返回的响应格式无效');
  } finally {
    client.close(force: true);
  }
}

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

/// Deep-copies a JSON-compatible dynamic structure.
dynamic _deepClone(dynamic value) => jsonDecode(jsonEncode(value));

Map<String, dynamic> _cloneMap(Map<String, dynamic> map) =>
    Map<String, dynamic>.from(_deepClone(map) as Map<dynamic, dynamic>);

List<Map<String, dynamic>> _cloneListOfMaps(
  List<Map<String, dynamic>> list,
) =>
    list.map(_cloneMap).toList();

/// Exact integer-cents fixed-point helpers (zero binary floating point).
class _FixedMath {
  static BigInt toCents(RustCoreBridge bridge, Object value) {
    final formatted = bridge.formatCny(value);
    return BigInt.parse(formatted.replaceAll('.', ''));
  }

  static String fromCents(BigInt cents) {
    final neg = cents.isNegative;
    final absVal = cents.abs();
    final major = absVal ~/ BigInt.from(100);
    final minor = (absVal % BigInt.from(100)).toString().padLeft(2, '0');
    return '${neg ? '-' : ''}$major.$minor';
  }

  static BigInt divRoundHalfUp(BigInt numerator, BigInt denominator) {
    if (denominator == BigInt.zero) {
      throw ArgumentError('Division by zero');
    }
    final isNeg = (numerator < BigInt.zero) != (denominator < BigInt.zero);
    final a = numerator.abs();
    final b = denominator.abs();
    final q = a ~/ b;
    final r = a % b;
    final roundedAbs = (r * BigInt.two >= b) ? q + BigInt.one : q;
    return isNeg ? -roundedAbs : roundedAbs;
  }

  static BigInt mulDivCentsRoundHalfUp(
    BigInt value,
    BigInt numerator,
    BigInt denominator,
  ) =>
      divRoundHalfUp(value * numerator, denominator);

  /// Parses an arbitrary non-exponential decimal string into `(scaledInt, scale)`.
  static ({BigInt coeff, int scale}) _parseDecimalParts(String raw) {
    final trimmed = raw.trim();
    if (trimmed.isEmpty) {
      return (coeff: BigInt.zero, scale: 0);
    }
    final neg = trimmed.startsWith('-');
    final body =
        (neg || trimmed.startsWith('+')) ? trimmed.substring(1) : trimmed;
    final dotIdx = body.indexOf('.');
    if (dotIdx == -1) {
      final v = BigInt.parse(body.isEmpty ? '0' : body);
      return (coeff: neg ? -v : v, scale: 0);
    }
    final intPart = body.substring(0, dotIdx);
    final fracPart = body.substring(dotIdx + 1);
    final combined = '${intPart.isEmpty ? '0' : intPart}$fracPart';
    final v = BigInt.parse(combined);
    return (coeff: neg ? -v : v, scale: fracPart.length);
  }

  /// Multiplies two arbitrary decimal strings and rounds HALF_UP to 2 decimals.
  static String mulToCny(RustCoreBridge bridge, String a, String b) {
    final pa = _parseDecimalParts(a);
    final pb = _parseDecimalParts(b);
    final prod = pa.coeff * pb.coeff;
    final totalScale = pa.scale + pb.scale;
    if (totalScale <= 2) {
      final factor = BigInt.from(10).pow(2 - totalScale);
      return bridge.formatCny(fromCents(prod * factor));
    }
    final divisor = BigInt.from(10).pow(totalScale - 2);
    final cents = divRoundHalfUp(prod, divisor);
    return bridge.formatCny(fromCents(cents));
  }
}

/// Stateful Flutter/Dart offline ledger engine synchronized with Web (`LocalLedgerEngine`)
/// and Server (`LedgerRepository`), delegating all core domain calculations to
/// Rust Core Engine (`packages/core-rs`) over `dart:ffi`.
class FlutterLedgerEngine {
  FlutterLedgerEngine({
    RustCoreBridge? bridge,
    String nodeId = 'mobile-flutter',
    String serverUrl = 'http://127.0.0.1:3001',
    JsonHttpPost? httpPost,
    String? storageFilePath,
    bool seedDemoData = false,
  })  : _bridge = bridge ?? RustCoreBridge.instance(),
        _httpPost = httpPost ?? _defaultJsonHttpPost,
        _storageFilePath = storageFilePath,
        hlc = HybridLogicalClock(
          nodeId: nodeId,
          bridge: bridge ?? RustCoreBridge.instance(),
        ) {
    this.serverUrl = serverUrl;
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

  final RustCoreBridge _bridge;
  final JsonHttpPost _httpPost;
  final String? _storageFilePath;
  final HybridLogicalClock hlc;
  bool _suppressPersist = false;

  List<Map<String, dynamic>> budgetPools = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> monthlyBudgets = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> categories = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> projectTags = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> transactions = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> vouchers = <Map<String, dynamic>>[];
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
  int _voucherSeq = 0;
  int _monthlyBudgetSeq = 0;
  int _recurringSeq = 0;

  int get pendingSyncCount => math.max(0, syncOplog.length - syncedOplogCount);

  List<Map<String, dynamic>> get pendingConflicts =>
      conflicts.where((c) => c['status'] == 'PENDING').toList();

  static const List<Map<String, dynamic>> _seedBudgetPools =
      <Map<String, dynamic>>[
    <String, dynamic>{
      'id': 'POOL_FIXED',
      'name': '固定刚需与定投池',
      'pool_type': 'FIXED',
      'is_monthly_budget': true,
      'rollover_strategy': 'ACCUMULATE',
      'description': '房租、话费、游戏月卡、定期定投',
      'sort_order': 10,
    },
    <String, dynamic>{
      'id': 'POOL_DAILY',
      'name': '高频饮食与洗护池',
      'pool_type': 'DAILY',
      'is_monthly_budget': true,
      'rollover_strategy': 'ACCUMULATE',
      'description': '三餐、零食、水饮、日常洗护等高频动态管控池',
      'sort_order': 20,
    },
    <String, dynamic>{
      'id': 'POOL_FLEX',
      'name': '月度弹性发展池',
      'pool_type': 'FLEX',
      'is_monthly_budget': true,
      'rollover_strategy': 'ACCUMULATE',
      'description': '服饰、日用百货、单片机电路、软件外设、交通资料',
      'sort_order': 30,
    },
    <String, dynamic>{
      'id': 'POOL_EMERGENCY',
      'name': '医疗与突发应急池',
      'pool_type': 'EMERGENCY',
      'is_monthly_budget': true,
      'rollover_strategy': 'ACCUMULATE',
      'description': '纯粹看病买药、突发设备抢修',
      'sort_order': 40,
    },
  ];

  static const List<Map<String, dynamic>> _seedMonthlyBudgets202611 =
      <Map<String, dynamic>>[
    <String, dynamic>{
      'id': 1,
      'year_month': '2026-11',
      'pool_id': 'POOL_FIXED',
      'base_allocation': '204.00',
      'rollover_from_prev': '0.00',
      'reserved_fixed': '0.00',
      'swept_to_fund': '0.00',
      'note': null,
    },
    <String, dynamic>{
      'id': 2,
      'year_month': '2026-11',
      'pool_id': 'POOL_DAILY',
      'base_allocation': '650.00',
      'rollover_from_prev': '0.00',
      'reserved_fixed': '0.00',
      'swept_to_fund': '0.00',
      'note': null,
    },
    <String, dynamic>{
      'id': 3,
      'year_month': '2026-11',
      'pool_id': 'POOL_FLEX',
      'base_allocation': '450.00',
      'rollover_from_prev': '0.00',
      'reserved_fixed': '0.00',
      'swept_to_fund': '0.00',
      'note': null,
    },
    <String, dynamic>{
      'id': 4,
      'year_month': '2026-11',
      'pool_id': 'POOL_EMERGENCY',
      'base_allocation': '196.00',
      'rollover_from_prev': '0.00',
      'reserved_fixed': '0.00',
      'swept_to_fund': '0.00',
      'note': null,
    },
  ];

  static const List<Map<String, dynamic>> _seedCategories =
      <Map<String, dynamic>>[
    <String, dynamic>{
      'id': 'CAT_FOOD',
      'parent_id': null,
      'name': '餐饮零食与水饮',
      'default_pool_id': 'POOL_DAILY',
      'icon_name': null,
      'keywords': '饭卡,食堂,华莱士,塔斯汀,牛奶,芬达,可乐,面,面包,水果,甘果子,鱼干',
      'sort_order': 10,
    },
    <String, dynamic>{
      'id': 'CAT_CLEAN',
      'parent_id': null,
      'name': '日常洗护与消耗',
      'default_pool_id': 'POOL_DAILY',
      'icon_name': null,
      'keywords': '洗衣服,洗衣液,纸巾,抽纸,牙线,牙膏,洗发水',
      'sort_order': 20,
    },
    <String, dynamic>{
      'id': 'CAT_TELECOM',
      'parent_id': null,
      'name': '通信话费与理发',
      'default_pool_id': 'POOL_FIXED',
      'icon_name': null,
      'keywords': '话费,移动,电信,联通,理发,剪头',
      'sort_order': 30,
    },
    <String, dynamic>{
      'id': 'CAT_GAME_FIXED',
      'parent_id': null,
      'name': '游戏固定大小月卡',
      'default_pool_id': 'POOL_FIXED',
      'icon_name': null,
      'keywords': '小月卡,大月卡,空月祝福,珍珠纪行',
      'sort_order': 40,
    },
    <String, dynamic>{
      'id': 'CAT_CLOTH',
      'parent_id': null,
      'name': '服饰鞋帽与床品',
      'default_pool_id': 'POOL_FLEX',
      'icon_name': null,
      'keywords': '短袖,裤子,内裤,袜子,床单,被套,鞋子',
      'sort_order': 50,
    },
    <String, dynamic>{
      'id': 'CAT_DAILY_GOODS',
      'parent_id': null,
      'name': '宿舍日用百货',
      'default_pool_id': 'POOL_FLEX',
      'icon_name': null,
      'keywords': '衣架,挂钩,泡面碗,指甲剪,卷尺,理线器,书架,电池,打气筒',
      'sort_order': 60,
    },
    <String, dynamic>{
      'id': 'CAT_EE_DEV',
      'parent_id': null,
      'name': '电子电路与开发',
      'default_pool_id': 'POOL_FLEX',
      'icon_name': null,
      'keywords': 'MSP430,MSPM0,开发板,J-Link,示波器,探头,排针,电容,电阻,焊接',
      'sort_order': 70,
    },
    <String, dynamic>{
      'id': 'CAT_DIGITAL_SUB',
      'parent_id': null,
      'name': '软件订阅与外设',
      'default_pool_id': 'POOL_FLEX',
      'icon_name': null,
      'keywords': '域名,Porkbun,阿里云,MOJITEST,鼠标垫,数据线,磁吸镜片,Pico',
      'sort_order': 80,
    },
    <String, dynamic>{
      'id': 'CAT_STUDY_PRINT',
      'parent_id': null,
      'name': '打印与学习资料',
      'default_pool_id': 'POOL_FLEX',
      'icon_name': null,
      'keywords': '打印,复印,教材,题库,文具',
      'sort_order': 90,
    },
    <String, dynamic>{
      'id': 'CAT_TRAFFIC',
      'parent_id': null,
      'name': '日常市内交通',
      'default_pool_id': 'POOL_FLEX',
      'icon_name': null,
      'keywords': '公交,地铁,单车,打车',
      'sort_order': 100,
    },
    <String, dynamic>{
      'id': 'CAT_MEDICAL',
      'parent_id': null,
      'name': '医疗买药与保健',
      'default_pool_id': 'POOL_EMERGENCY',
      'icon_name': null,
      'keywords': '维生素,溃疡,医院,门诊,冷冻,碘伏,棉签,药',
      'sort_order': 110,
    },
    <String, dynamic>{
      'id': 'CAT_REPAIR',
      'parent_id': null,
      'name': '突发损坏与维修',
      'default_pool_id': 'POOL_EMERGENCY',
      'icon_name': null,
      'keywords': '修车,内外胎,卡槽,维修,发霉替换',
      'sort_order': 120,
    },
    <String, dynamic>{
      'id': 'CAT_EXAM_CERT',
      'parent_id': null,
      'name': '考证报名与差旅',
      'default_pool_id': 'POOL_FLEX',
      'icon_name': null,
      'keywords': 'JLPT,N2,报名费,护照,港澳通行证,青旅,考点住宿',
      'sort_order': 130,
    },
    <String, dynamic>{
      'id': 'CAT_MAJOR_ASSET',
      'parent_id': null,
      'name': '数码大件购置',
      'default_pool_id': 'POOL_FLEX',
      'icon_name': null,
      'keywords': 'iPhone,手机,机械硬盘,希捷,固态硬盘,显示器',
      'sort_order': 140,
    },
  ];

  static const List<Map<String, dynamic>> _seedProjectTags =
      <Map<String, dynamic>>[
    <String, dynamic>{
      'id': 'TAG_JLPT_N2',
      'name': 'JLPT_N2考试专项',
      'tag_type': 'PROJECT',
      'target_budget': '800.00',
      'is_active': true,
    },
    <String, dynamic>{
      'id': 'TAG_MCU_LAB',
      'name': '单片机硬件实验',
      'tag_type': 'SCENE',
      'target_budget': null,
      'is_active': true,
    },
    <String, dynamic>{
      'id': 'TAG_STOCK_EAT',
      'name': '靠存货/刷饭卡度日',
      'tag_type': 'STOCK_CONSUME',
      'target_budget': null,
      'is_active': true,
    },
  ];

  static const List<Map<String, dynamic>> _seedVouchers =
      <Map<String, dynamic>>[
    <String, dynamic>{
      'id': 1,
      'title': '微信支付10元立减金',
      'voucher_type': 'PREPAID_COUPON',
      'face_value': '10.00',
      'acquire_cost': '5.99',
      'min_spend': '10.01',
      'status': 'AVAILABLE',
      'purchase_tx_id': null,
      'used_tx_id': null,
      'expire_date': '2026-12-31',
    },
    <String, dynamic>{
      'id': 2,
      'title': '美团外卖5元无门槛优惠券',
      'voucher_type': 'FREE_COUPON',
      'face_value': '5.00',
      'acquire_cost': '0.00',
      'min_spend': '0.00',
      'status': 'AVAILABLE',
      'purchase_tx_id': null,
      'used_tx_id': null,
      'expire_date': '2026-12-31',
    },
  ];

  static const List<Map<String, dynamic>> _seedRecurringRules =
      <Map<String, dynamic>>[
    <String, dynamic>{
      'id': 1,
      'title': '每月固定话费(移动8+电信29+联通49)',
      'rule_type': 'FIXED_EXPENSE',
      'cron_cycle': 'MONTHLY',
      'trigger_day': 1,
      'currency': 'CNY',
      'amount': '86.00',
      'category_id': 'CAT_TELECOM',
      'budget_pool_id': 'POOL_FIXED',
      'auto_reserve_budget': true,
      'is_active': true,
    },
    <String, dynamic>{
      'id': 2,
      'title': 'Porkbun域名续费',
      'rule_type': 'FX_SUBSCRIPTION',
      'cron_cycle': 'YEARLY',
      'trigger_day': 1,
      'currency': 'USD',
      'amount': '10.37',
      'category_id': 'CAT_DIGITAL_SUB',
      'budget_pool_id': 'POOL_FLEX',
      'auto_reserve_budget': true,
      'is_active': true,
    },
  ];

  /// Resets engine state back to the clean `default_seed_2026_11` snapshot.
  void resetToDefaultSeed() {
    budgetPools = _cloneListOfMaps(_seedBudgetPools);
    monthlyBudgets = _cloneListOfMaps(_seedMonthlyBudgets202611);
    categories = _cloneListOfMaps(_seedCategories);
    projectTags = _cloneListOfMaps(_seedProjectTags);
    vouchers = _cloneListOfMaps(_seedVouchers);
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
    _voucherSeq = 2;
    _monthlyBudgetSeq = 4;
    _recurringSeq = 2;
    saveToDisk();
  }

  /// Resets engine state to a completely empty personal ledger with zero initial default data.
  void resetToCleanState() {
    budgetPools = <Map<String, dynamic>>[];
    monthlyBudgets = <Map<String, dynamic>>[];
    categories = <Map<String, dynamic>>[];
    projectTags = <Map<String, dynamic>>[];
    vouchers = <Map<String, dynamic>>[];
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
    };
    _txSeq = 0;
    _itemSeq = 0;
    _voucherSeq = 0;
    _monthlyBudgetSeq = 0;
    _recurringSeq = 0;
    saveToDisk();
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
    saveToDisk();
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

  // --------------------------------------------------------------------------
  // Write Operation 1 & 2: DSL & Manual Expense / Income Recording
  // --------------------------------------------------------------------------

  Map<String, dynamic> _compileDsl(
    String rawText, {
    int? appliedVoucherId,
    int? primaryItemOverrideIndex,
    Map<int, Map<String, String?>>? itemTargetOverrides,
    bool strictVoucherValidation = true,
  }) {
    final parsed = _bridge.parseQuickInputDsl(
      rawText,
      categories: categories,
      projectTags: projectTags,
      budgetPools: budgetPools,
      fxConfig: _getFxConfig(),
    );

    final txType = parsed['tx_type'] as String;
    var allocationMode =
        (parsed['allocation_mode'] as String?) ?? 'SINGLE';
    var totalGross = parsed['total_gross'] as String;
    var paymentDiscount = parsed['payment_discount'] as String;
    var platformDiscount = parsed['platform_discount'] as String;
    var totalNet = parsed['total_net'] as String;
    final parsedItems = (parsed['items'] as List<dynamic>)
        .map((e) => Map<String, dynamic>.from(e as Map<dynamic, dynamic>))
        .toList();

    if (itemTargetOverrides != null && itemTargetOverrides.isNotEmpty) {
      for (var i = 0; i < parsedItems.length; i++) {
        final ov = itemTargetOverrides[i];
        if (ov == null) continue;
        if (ov.containsKey('budget_pool_id') && ov['budget_pool_id'] != null) {
          parsedItems[i]['budget_pool_id'] = ov['budget_pool_id'];
        }
        if (ov.containsKey('project_tag_id')) {
          final tagId = ov['project_tag_id'];
          parsedItems[i]['project_tag_id'] = tagId;
          if (tagId != null && !ov.containsKey('budget_pool_id')) {
            parsedItems[i]['budget_pool_id'] =
                budgetPools.any((p) => p['id'] == 'POOL_FLEX')
                    ? 'POOL_FLEX'
                    : null;
          }
        }
      }
    }

    for (final it in parsedItems) {
      final pid = it['budget_pool_id'] as String?;
      if (pid != null && !budgetPools.any((p) => p['id'] == pid)) {
        it['budget_pool_id'] = null;
      }
      final cid = it['category_id'] as String?;
      if (cid != null && !categories.any((c) => c['id'] == cid)) {
        it['category_id'] = null;
      }
    }

    var allocationOverridden = false;
    if (primaryItemOverrideIndex != null && parsedItems.isNotEmpty) {
      allocationOverridden = true;
      if (primaryItemOverrideIndex < 0) {
        for (final it in parsedItems) {
          it['is_primary_item'] = false;
        }
        allocationMode = parsedItems.length > 1 ? 'PROPORTIONAL' : 'SINGLE';
      } else if (primaryItemOverrideIndex < parsedItems.length) {
        for (var i = 0; i < parsedItems.length; i++) {
          parsedItems[i]['is_primary_item'] = (i == primaryItemOverrideIndex);
        }
        allocationMode = parsedItems.length > 1 ? 'PRIMARY_ITEM' : 'SINGLE';
      }
    }

    final baseGrossCents = _FixedMath.toCents(_bridge, totalGross);
    final baseNetCents = _FixedMath.toCents(_bridge, totalNet);
    final eligibleVouchers = <Map<String, dynamic>>[];
    if (txType == 'EXPENSE') {
      for (final v in vouchers) {
        if (v['status'] != 'AVAILABLE') continue;
        final minSpendCents =
            _FixedMath.toCents(_bridge, v['min_spend'] as Object);
        if (baseGrossCents >= minSpendCents) {
          final faceCents =
              _FixedMath.toCents(_bridge, v['face_value'] as Object);
          final costCents =
              _FixedMath.toCents(_bridge, v['acquire_cost'] as Object);
          final usableFace =
              baseNetCents < faceCents ? baseNetCents : faceCents;
          final netSavings = usableFace - costCents;
          final vc = _cloneMap(v);
          vc['net_savings'] = _FixedMath.fromCents(
            netSavings > BigInt.zero ? netSavings : BigInt.zero,
          );
          eligibleVouchers.add(vc);
        }
      }
    }

    Map<String, dynamic>? voucherToUse;
    String voucherSavings = '0.00';
    String? voucherError;

    if (appliedVoucherId != null) {
      final idx = vouchers.indexWhere((v) => v['id'] == appliedVoucherId);
      if (idx == -1) {
        if (strictVoucherValidation) {
          throw ArgumentError('优惠券 "$appliedVoucherId" 不存在');
        }
        voucherError = '优惠券 "$appliedVoucherId" 不存在';
      } else {
        final v = vouchers[idx];
        final grossCents = _FixedMath.toCents(_bridge, totalGross);
        final minSpendCents =
            _FixedMath.toCents(_bridge, v['min_spend'] as Object);
        if (v['status'] != 'AVAILABLE') {
          final msg = '优惠券「${v['title']}」已被使用或已失效';
          if (strictVoucherValidation) throw StateError(msg);
          voucherError = msg;
        } else if (txType == 'INCOME') {
          const msg = '收入交易不可使用优惠券';
          if (strictVoucherValidation) throw StateError(msg);
          voucherError = msg;
        } else if (grossCents < minSpendCents) {
          final msg =
              '未达到优惠券「${v['title']}」的最低使用门槛（需满 ¥${v['min_spend']}，当前金额 ¥$totalGross）';
          if (strictVoucherValidation) throw StateError(msg);
          voucherError = msg;
        } else if (txType == 'EXPENSE') {
          final netCents = _FixedMath.toCents(_bridge, totalNet);
          final faceCents =
              _FixedMath.toCents(_bridge, v['face_value'] as Object);
          final cashPaidCents =
              netCents > faceCents ? netCents - faceCents : BigInt.zero;
          final cashPaid = _FixedMath.fromCents(cashPaidCents);

          final splitInputs = parsedItems
              .map(
                (it) => <String, dynamic>{
                  'name': it['item_name'],
                  'gross': it['item_gross'],
                  'category_id': it['category_id'],
                  'budget_pool_id': it['budget_pool_id'],
                  'project_tag_id': it['project_tag_id'],
                  'is_primary': it['is_primary_item'],
                },
              )
              .toList();

          final hasPrimary =
              parsedItems.any((it) => it['is_primary_item'] == true);
          final effectiveVoucherMode = parsedItems.length <= 1
              ? 'SINGLE'
              : (allocationMode == 'PRIMARY_ITEM' || hasPrimary)
                  ? 'PRIMARY_ITEM'
                  : 'PROPORTIONAL';

          final alloc = _bridge.computeOrderAllocation(
            items: splitInputs,
            cashActuallyPaid: cashPaid,
            mode: effectiveVoucherMode,
            voucher: <String, dynamic>{
              'face_value': v['face_value'],
              'acquire_cost': v['acquire_cost'],
              'voucher_type': v['voucher_type'],
            },
          );

          allocationMode = effectiveVoucherMode;
          totalGross = alloc['total_gross'] as String;
          paymentDiscount = alloc['total_discount'] as String;
          platformDiscount = '0.00';
          totalNet = alloc['total_net'] as String;
          voucherSavings =
              (alloc['voucher_net_savings'] as String?) ?? '0.00';

          final allocItems = alloc['items'] as List<dynamic>;
          for (var i = 0; i < parsedItems.length; i++) {
            final ai = allocItems[i] as Map<String, dynamic>;
            parsedItems[i]['item_gross'] = ai['gross'];
            parsedItems[i]['allocated_discount'] = ai['allocated_discount'];
            parsedItems[i]['item_net'] = ai['net'];
          }
          voucherToUse = v;
        }
      }
    }

    if (voucherToUse == null &&
        allocationOverridden &&
        txType == 'EXPENSE' &&
        parsedItems.length > 1) {
      final splitInputs = parsedItems
          .map(
            (it) => <String, dynamic>{
              'name': it['item_name'],
              'gross': it['item_gross'],
              'category_id': it['category_id'],
              'budget_pool_id': it['budget_pool_id'],
              'project_tag_id': it['project_tag_id'],
              'is_primary': it['is_primary_item'],
            },
          )
          .toList();
      final effectiveMode =
          allocationMode == 'MANUAL' ? 'PROPORTIONAL' : allocationMode;
      final allocated = _bridge.allocateSplitDiscounts(
        items: splitInputs,
        totalNetPaid: totalNet,
        mode: effectiveMode,
      );
      for (var i = 0; i < parsedItems.length; i++) {
        parsedItems[i]['item_gross'] = allocated[i]['gross'];
        parsedItems[i]['allocated_discount'] =
            allocated[i]['allocated_discount'];
        parsedItems[i]['item_net'] = allocated[i]['net'];
      }
    }

    parsed['allocation_mode'] = allocationMode;
    parsed['total_gross'] = totalGross;
    parsed['payment_discount'] = paymentDiscount;
    parsed['platform_discount'] = platformDiscount;
    parsed['total_net'] = totalNet;
    parsed['items'] = parsedItems;

    return <String, dynamic>{
      'parsed': parsed,
      'is_fx_detected': parsed['is_fx_detected'] == true ||
          ((parsed['original_currency'] as String?) ?? 'CNY') != 'CNY',
      'voucher_info': voucherToUse != null ? _cloneMap(voucherToUse) : null,
      'voucher_savings': voucherSavings,
      'voucher_error': voucherError,
      'eligible_vouchers': eligibleVouchers,
      '_voucher_ref': voucherToUse,
    };
  }

  /// Compiles quick-input DSL in real time for mobile live split preview without mutating state.
  Map<String, dynamic> previewDsl(
    String rawText, {
    int? appliedVoucherId,
    int? primaryItemOverrideIndex,
    Map<int, Map<String, String?>>? itemTargetOverrides,
  }) {
    final compiled = _compileDsl(
      rawText,
      appliedVoucherId: appliedVoucherId,
      primaryItemOverrideIndex: primaryItemOverrideIndex,
      itemTargetOverrides: itemTargetOverrides,
      strictVoucherValidation: false,
    );
    compiled.remove('_voucher_ref');
    return compiled;
  }

  Map<String, dynamic> recordFromDsl(
    String rawText, {
    String? txDate,
    int? appliedVoucherId,
    int? primaryItemOverrideIndex,
    Map<int, Map<String, String?>>? itemTargetOverrides,
  }) {
    final compiled = _compileDsl(
      rawText,
      appliedVoucherId: appliedVoucherId,
      primaryItemOverrideIndex: primaryItemOverrideIndex,
      itemTargetOverrides: itemTargetOverrides,
      strictVoucherValidation: true,
    );
    final parsed = compiled['parsed'] as Map<String, dynamic>;
    final voucherToUse = compiled['_voucher_ref'] as Map<String, dynamic>?;

    final effectiveDate =
        (txDate != null && txDate.isNotEmpty) ? txDate : getLocalTodayDateStr();
    final txType = parsed['tx_type'] as String;
    final totalGross = parsed['total_gross'] as String;
    final paymentDiscount = parsed['payment_discount'] as String;
    final platformDiscount = parsed['platform_discount'] as String;
    final totalNet = parsed['total_net'] as String;
    final parsedItems = (parsed['items'] as List<dynamic>)
        .map((e) => Map<String, dynamic>.from(e as Map<dynamic, dynamic>))
        .toList();

    final txId = _nextTxId();
    final nowIso = _nowIso();
    final currentHlc = hlc.now();
    final settlementStatus = parsed['settlement_status'] as String;

    final header = <String, dynamic>{
      'id': txId,
      'tx_date': effectiveDate,
      'tx_type': txType,
      'total_gross': totalGross,
      'platform_discount': platformDiscount,
      'payment_discount': paymentDiscount,
      'total_net': totalNet,
      'allocation_mode': parsed['allocation_mode'],
      'original_currency': parsed['original_currency'],
      'original_amount': parsed['original_amount'],
      'exchange_rate': parsed['exchange_rate'],
      'settlement_status': settlementStatus,
      'hold_amount_cny': parsed['hold_amount_cny'],
      'fx_cashback_rate': parsed['fx_cashback_rate'],
      'applied_voucher_id': voucherToUse != null ? voucherToUse['id'] : null,
      'raw_input_text': parsed['raw_input_text'],
      'merchant_or_note': parsed['merchant_or_note'],
      'created_at': nowIso,
      'settled_at': settlementStatus == 'SETTLED' ? nowIso : null,
      'updated_hlc': currentHlc,
      'is_deleted': false,
    };

    final builtItems = <Map<String, dynamic>>[];
    for (var i = 0; i < parsedItems.length; i++) {
      _itemSeq += 1;
      final it = parsedItems[i];
      builtItems.add(<String, dynamic>{
        'id': _itemSeq,
        'tx_id': txId,
        'item_index': i,
        'item_name': it['item_name'],
        'category_id': it['category_id'],
        'budget_pool_id': it['budget_pool_id'],
        'project_tag_id': it['project_tag_id'],
        'item_gross': it['item_gross'],
        'allocated_discount': it['allocated_discount'],
        'item_net': it['item_net'],
        'is_primary_item': it['is_primary_item'] == true,
        'raw_formula_expr': it['raw_formula_expr'],
      });
    }

    final agg = <String, dynamic>{
      'header': header,
      'items': builtItems,
    };
    _assertConservationLaw(agg);
    transactions.add(agg);

    if (voucherToUse != null) {
      voucherToUse['status'] = 'USED';
      voucherToUse['used_tx_id'] = txId;
      _appendOpLog('VOUCHER', '${voucherToUse['id']}', 'UPSERT', voucherToUse);
    }

    _appendOpLog('TRANSACTION', txId, 'UPSERT', agg, currentHlc);
    return _cloneMap(agg);
  }

  Map<String, dynamic> recordManualTransaction({
    String txType = 'EXPENSE',
    String? txDate,
    required String amount,
    String discount = '0.00',
    String? categoryId,
    String? budgetPoolId,
    String? projectTagId,
    required String merchantOrNote,
    String currency = 'CNY',
    String? holdAmountCny,
    String? fxHoldRatio,
    String? fxCashbackRate,
    int? appliedVoucherId,
  }) {
    final effectiveDate =
        (txDate != null && txDate.isNotEmpty) ? txDate : getLocalTodayDateStr();
    final txId = _nextTxId();
    final nowIso = _nowIso();
    final currentHlc = hlc.now();
    final upperCurr = currency.toUpperCase();
    final resolvedCategory = categoryId ??
        (categories.isNotEmpty ? categories.first['id'] as String : null);
    final catMatch = resolvedCategory != null
        ? categories.where((c) => c['id'] == resolvedCategory).toList()
        : <Map<String, dynamic>>[];
    final resolvedPool = budgetPoolId ??
        (catMatch.isNotEmpty
            ? (catMatch.first['default_pool_id'] as String?)
            : (budgetPools.isNotEmpty ? budgetPools.first['id'] as String : null));

    Map<String, dynamic>? voucherToUse;
    if (appliedVoucherId != null) {
      final vIdx = vouchers.indexWhere((v) => v['id'] == appliedVoucherId);
      if (vIdx == -1) {
        throw ArgumentError('优惠券 "$appliedVoucherId" 不存在');
      }
      final v = vouchers[vIdx];
      if (v['status'] != 'AVAILABLE') {
        throw StateError('优惠券「${v['title']}」已被使用或已失效');
      }
      if (txType == 'INCOME') {
        throw StateError('收入交易不可使用优惠券');
      }
      voucherToUse = v;
    }

    var totalGross = _bridge.formatCny(amount);
    var paymentDiscount = _bridge.formatCny(discount);
    String totalNet;
    String? origCurrency = 'CNY';
    String? origAmount;
    var exchangeRate = '1.000000';
    var settlementStatus = 'SETTLED';
    var holdCny = '0.00';
    String? appliedCashbackRate;
    String? settledAt = nowIso;

    if (txType == 'EXPENSE' && upperCurr != 'CNY') {
      origCurrency = upperCurr;
      origAmount = _bridge.formatCny(amount);
      final fxCfg = _getFxConfig();
      final holdRatioStr =
          fxHoldRatio ?? (fxCfg['defaultHoldRatio'] as String? ?? '1.02');
      final cashbackRateStr =
          fxCashbackRate ?? (fxCfg['defaultCashbackRate'] as String? ?? '0.01');
      final rateStr = defaultFxRates[upperCurr] ?? '7.200000';
      final effectiveHold = holdAmountCny ??
          _FixedMath.mulToCny(
            _bridge,
            _FixedMath.mulToCny(_bridge, amount, rateStr),
            holdRatioStr,
          );
      final fxRes = _bridge.processMastercardFxLifecycle(
        foreignAmount: amount,
        holdAmountCny: effectiveHold,
        holdRatio: holdRatioStr,
        cashbackRate: cashbackRateStr,
        monthlyRemainingCapCny: _getMonthlyRemainingFxCashbackCap(
          effectiveDate.substring(0, 7),
        ),
      );
      totalGross = fxRes['total_gross'] as String;
      paymentDiscount = fxRes['payment_discount'] as String;
      totalNet = fxRes['total_net'] as String;
      exchangeRate = fxRes['exchange_rate'] as String;
      settlementStatus = (fxRes['status'] ?? fxRes['settlement_status']) as String;
      holdCny = fxRes['hold_amount_cny'] as String;
      appliedCashbackRate = _bridge.roundRate(cashbackRateStr) == '0'
          ? '0.0000'
          : cashbackRateStr;
      // Preserve caller's 4-decimal string if passed explicitly (e.g. "0.0000").
      if (fxCashbackRate != null && fxCashbackRate.isNotEmpty) {
        appliedCashbackRate = fxCashbackRate;
      }
      settledAt = null;
    } else if (txType == 'INCOME') {
      origCurrency = 'CNY';
      paymentDiscount = '0.00';
      totalNet = totalGross;
    } else {
      final grossCents = _FixedMath.toCents(_bridge, totalGross);
      final discCents = _FixedMath.toCents(_bridge, paymentDiscount);
      if (voucherToUse != null) {
        final minCents =
            _FixedMath.toCents(_bridge, voucherToUse['min_spend'] as Object);
        if (grossCents < minCents) {
          throw StateError(
            '未达到优惠券「${voucherToUse['title']}」的最低使用门槛（需满 ¥${voucherToUse['min_spend']}，当前金额 ¥$totalGross）',
          );
        }
        final faceCents =
            _FixedMath.toCents(_bridge, voucherToUse['face_value'] as Object);
        final afterDisc =
            grossCents > discCents ? grossCents - discCents : BigInt.zero;
        final cashPaid = afterDisc > faceCents ? afterDisc - faceCents : BigInt.zero;
        final vRes = _bridge.applyVoucherToOrder(
          orderGross: totalGross,
          cashActuallyPaidAfterVoucher: _FixedMath.fromCents(cashPaid),
          voucher: voucherToUse,
        );
        totalNet = vRes['effective_budget_net'] as String;
        final netCents = _FixedMath.toCents(_bridge, totalNet);
        paymentDiscount = _FixedMath.fromCents(grossCents - netCents);
      } else {
        final netCents =
            grossCents > discCents ? grossCents - discCents : BigInt.zero;
        totalNet = _FixedMath.fromCents(netCents);
      }
    }

    final header = <String, dynamic>{
      'id': txId,
      'tx_date': effectiveDate,
      'tx_type': txType,
      'total_gross': totalGross,
      'platform_discount': '0.00',
      'payment_discount': paymentDiscount,
      'total_net': totalNet,
      'allocation_mode': 'SINGLE',
      'original_currency': origCurrency,
      'original_amount': origAmount,
      'exchange_rate': exchangeRate,
      'settlement_status': settlementStatus,
      'hold_amount_cny': holdCny,
      'fx_cashback_rate': appliedCashbackRate,
      'applied_voucher_id': voucherToUse != null ? voucherToUse['id'] : null,
      'raw_input_text': '手动录入：$merchantOrNote $amount',
      'merchant_or_note': merchantOrNote,
      'created_at': nowIso,
      'settled_at': settledAt,
      'updated_hlc': currentHlc,
      'is_deleted': false,
    };

    final items = <Map<String, dynamic>>[];
    if (txType == 'EXPENSE') {
      _itemSeq += 1;
      items.add(<String, dynamic>{
        'id': _itemSeq,
        'tx_id': txId,
        'item_index': 0,
        'item_name': merchantOrNote,
        'category_id': resolvedCategory,
        'budget_pool_id': resolvedPool,
        'project_tag_id': projectTagId,
        'item_gross': totalGross,
        'allocated_discount': paymentDiscount,
        'item_net': totalNet,
        'is_primary_item': true,
        'raw_formula_expr': null,
      });
    }

    final agg = <String, dynamic>{
      'header': header,
      'items': items,
    };
    _assertConservationLaw(agg);
    transactions.add(agg);

    if (voucherToUse != null) {
      voucherToUse['status'] = 'USED';
      voucherToUse['used_tx_id'] = txId;
      _appendOpLog('VOUCHER', '${voucherToUse['id']}', 'UPSERT', voucherToUse);
    }

    _appendOpLog('TRANSACTION', txId, 'UPSERT', agg, currentHlc);
    return _cloneMap(agg);
  }

  // --------------------------------------------------------------------------
  // Write Operation 3: Vouchers (Buy / Upsert / Delete)
  // --------------------------------------------------------------------------

  Map<String, dynamic> buyVoucher({
    String? title,
    required String voucherType,
    required String faceValue,
    required String acquireCost,
    String minSpend = '0.00',
    String? txDate,
    String? expireDate,
  }) {
    final finalTitle = (title != null && title.trim().isNotEmpty)
        ? title.trim()
        : _bridge.generateVoucherTitle(
            voucherType: voucherType,
            faceValue: faceValue,
            minSpend: minSpend,
          );
    final effectiveDate =
        (txDate != null && txDate.isNotEmpty) ? txDate : getLocalTodayDateStr();
    final txId = _nextTxId();
    final nowIso = _nowIso();
    final currentHlc = hlc.now();
    final costCny = _bridge.formatCny(acquireCost);

    final txHeader = <String, dynamic>{
      'id': txId,
      'tx_date': effectiveDate,
      'tx_type': 'VOUCHER_BUY',
      'total_gross': costCny,
      'platform_discount': '0.00',
      'payment_discount': '0.00',
      'total_net': costCny,
      'allocation_mode': 'SINGLE',
      'original_currency': 'CNY',
      'original_amount': null,
      'exchange_rate': '1.000000',
      'settlement_status': 'SETTLED',
      'hold_amount_cny': '0.00',
      'fx_cashback_rate': null,
      'applied_voucher_id': null,
      'raw_input_text': '购买卡券: $finalTitle',
      'merchant_or_note': '购买卡券: $finalTitle',
      'created_at': nowIso,
      'settled_at': nowIso,
      'updated_hlc': currentHlc,
      'is_deleted': false,
    };

    final txAgg = <String, dynamic>{
      'header': txHeader,
      'items': <Map<String, dynamic>>[],
    };
    transactions.add(txAgg);

    _voucherSeq += 1;
    final voucher = <String, dynamic>{
      'id': _voucherSeq,
      'title': finalTitle,
      'voucher_type': voucherType,
      'face_value': _bridge.formatCny(faceValue),
      'acquire_cost': costCny,
      'min_spend': _bridge.formatCny(minSpend),
      'status': 'AVAILABLE',
      'purchase_tx_id': txId,
      'used_tx_id': null,
      'expire_date': expireDate,
    };
    vouchers.add(voucher);

    _appendOpLog('TRANSACTION', txId, 'UPSERT', txAgg, currentHlc);
    _appendOpLog('VOUCHER', '${voucher['id']}', 'UPSERT', voucher);

    return <String, dynamic>{
      'voucher': _cloneMap(voucher),
      'transaction': _cloneMap(txAgg),
      'tx': _cloneMap(txAgg),
    };
  }

  Map<String, dynamic> upsertVoucher({
    int? id,
    String? title,
    required String voucherType,
    required String faceValue,
    required String acquireCost,
    String minSpend = '0.00',
    String? txDate,
    String? expireDate,
    String status = 'AVAILABLE',
  }) {
    final finalTitle = (title != null && title.trim().isNotEmpty)
        ? title.trim()
        : _bridge.generateVoucherTitle(
            voucherType: voucherType,
            faceValue: faceValue,
            minSpend: minSpend,
          );
    if (id == null && _FixedMath.toCents(_bridge, acquireCost) > BigInt.zero) {
      return buyVoucher(
        title: finalTitle,
        voucherType: voucherType,
        faceValue: faceValue,
        acquireCost: acquireCost,
        minSpend: minSpend,
        txDate: txDate,
        expireDate: expireDate,
      );
    }
    if (id != null) {
      final idx = vouchers.indexWhere((v) => v['id'] == id);
      if (idx == -1) {
        throw ArgumentError('Voucher "$id" not found');
      }
      final v = vouchers[idx];
      v['title'] = finalTitle;
      v['voucher_type'] = voucherType;
      v['face_value'] = _bridge.formatCny(faceValue);
      v['acquire_cost'] = _bridge.formatCny(acquireCost);
      v['min_spend'] = _bridge.formatCny(minSpend);
      v['expire_date'] = expireDate;
      v['status'] = status;
      _appendOpLog('VOUCHER', '$id', 'UPSERT', v);
      return <String, dynamic>{'voucher': _cloneMap(v)};
    }
    _voucherSeq += 1;
    final voucher = <String, dynamic>{
      'id': _voucherSeq,
      'title': finalTitle,
      'voucher_type': voucherType,
      'face_value': _bridge.formatCny(faceValue),
      'acquire_cost': _bridge.formatCny(acquireCost),
      'min_spend': _bridge.formatCny(minSpend),
      'status': status,
      'purchase_tx_id': null,
      'used_tx_id': null,
      'expire_date': expireDate,
    };
    vouchers.add(voucher);
    _appendOpLog('VOUCHER', '${voucher['id']}', 'UPSERT', voucher);
    return <String, dynamic>{'voucher': _cloneMap(voucher)};
  }

  void deleteVoucher(int id) {
    final idx = vouchers.indexWhere((v) => v['id'] == id);
    if (idx == -1) return;
    final voucher = vouchers[idx];

    for (final tx in transactions) {
      final h = tx['header'] as Map<String, dynamic>;
      if (h['applied_voucher_id'] == id) {
        h['applied_voucher_id'] = null;
        final upHlc = hlc.now();
        h['updated_hlc'] = upHlc;
        _appendOpLog('TRANSACTION', h['id'] as String, 'UPSERT', tx, upHlc);
      }
    }

    final purchaseTxId = voucher['purchase_tx_id'] as String?;
    if (purchaseTxId != null) {
      final pIdx = transactions.indexWhere(
        (t) => (t['header'] as Map<String, dynamic>)['id'] == purchaseTxId,
      );
      if (pIdx != -1) {
        final pTx = transactions[pIdx];
        final ph = pTx['header'] as Map<String, dynamic>;
        ph['is_deleted'] = true;
        final delHlc = hlc.now();
        ph['updated_hlc'] = delHlc;
        _appendOpLog('TRANSACTION', purchaseTxId, 'UPSERT', pTx, delHlc);
      }
    }

    vouchers.removeAt(idx);
    _appendOpLog('VOUCHER', '$id', 'DELETE', <String, dynamic>{'id': id});
  }

  // --------------------------------------------------------------------------
  // Write Operation 4: Mastercard FX Settlement
  // --------------------------------------------------------------------------

  Map<String, dynamic> settleMastercardTransaction(
    String txId,
    String settledAmountCny, {
    String? settledAt,
    String? cashbackRate,
  }) {
    final idx = transactions.indexWhere(
      (t) => (t['header'] as Map<String, dynamic>)['id'] == txId,
    );
    if (idx == -1) {
      throw ArgumentError('Transaction "$txId" not found');
    }
    final tx = transactions[idx];
    final h = tx['header'] as Map<String, dynamic>;
    final fxCfg = _getFxConfig();
    final effectiveCashbackRate = cashbackRate ??
        (h['fx_cashback_rate'] as String?) ??
        (fxCfg['defaultCashbackRate'] as String? ?? '0.01');

    final fxRes = _bridge.processMastercardFxLifecycle(
      foreignAmount: (h['original_amount'] as String?) ?? h['total_gross'] as String,
      holdAmountCny: (h['hold_amount_cny'] as String?) ?? h['total_gross'] as String,
      settledAmountCny: settledAmountCny,
      holdRatio: fxCfg['defaultHoldRatio'] as String? ?? '1.02',
      cashbackRate: effectiveCashbackRate,
      monthlyRemainingCapCny: _getMonthlyRemainingFxCashbackCap(
        (h['tx_date'] as String).substring(0, 7),
      ),
    );

    final prevGross = h['total_gross'] as String;
    final currentHlc = hlc.now();
    h['total_gross'] = fxRes['total_gross'];
    h['payment_discount'] = fxRes['payment_discount'];
    h['total_net'] = fxRes['total_net'];
    h['exchange_rate'] = fxRes['exchange_rate'];
    h['settlement_status'] = 'SETTLED';
    h['hold_amount_cny'] = '0.00';
    h['fx_cashback_rate'] = _bridge.roundRate(effectiveCashbackRate) == '0'
        ? '0.0000'
        : effectiveCashbackRate;
    if (h['fx_cashback_rate'] != '0.0000' &&
        (h['fx_cashback_rate'] as String) == '0.01') {
      h['fx_cashback_rate'] = '0.0100';
    } else if ((effectiveCashbackRate == '0.01' ||
            effectiveCashbackRate == '0.0100') &&
        _bridge.roundRate(effectiveCashbackRate) == '0.01') {
      h['fx_cashback_rate'] = '0.0100';
    }
    h['settled_at'] = settledAt ?? _nowIso();
    h['updated_hlc'] = currentHlc;

    final items = (tx['items'] as List<dynamic>)
        .map((e) => e as Map<String, dynamic>)
        .toList();

    if (items.length <= 1) {
      if (items.isNotEmpty) {
        items[0]['item_gross'] = h['total_gross'];
        items[0]['allocated_discount'] = h['payment_discount'];
        items[0]['item_net'] = h['total_net'];
      }
    } else {
      final oldGrossCents = _FixedMath.toCents(_bridge, prevGross);
      final newGrossCents = _FixedMath.toCents(_bridge, h['total_gross'] as Object);
      List<BigInt> scaledGrosses;
      if (!_bridge.equalsCny(prevGross, h['total_gross'] as Object) &&
          oldGrossCents > BigInt.zero) {
        scaledGrosses = items
            .map(
              (it) => _FixedMath.mulDivCentsRoundHalfUp(
                _FixedMath.toCents(_bridge, it['item_gross'] as Object),
                newGrossCents,
                oldGrossCents,
              ),
            )
            .toList();
        final sumScaled =
            scaledGrosses.fold<BigInt>(BigInt.zero, (a, b) => a + b);
        final diff = newGrossCents - sumScaled;
        if (diff != BigInt.zero && scaledGrosses.isNotEmpty) {
          scaledGrosses[0] = scaledGrosses[0] + diff;
        }
      } else {
        scaledGrosses = items
            .map((it) => _FixedMath.toCents(_bridge, it['item_gross'] as Object))
            .toList();
      }

      final splitInputs = <Map<String, dynamic>>[];
      for (var i = 0; i < items.length; i++) {
        splitInputs.add(<String, dynamic>{
          'name': items[i]['item_name'],
          'gross': _FixedMath.fromCents(scaledGrosses[i]),
          'category_id': items[i]['category_id'],
          'budget_pool_id': items[i]['budget_pool_id'],
          'project_tag_id': items[i]['project_tag_id'],
          'is_primary': items[i]['is_primary_item'],
        });
      }
      final allocMode = h['allocation_mode'] == 'MANUAL'
          ? 'PROPORTIONAL'
          : (h['allocation_mode'] as String);
      final allocated = _bridge.allocateSplitDiscounts(
        items: splitInputs,
        totalNetPaid: h['total_net'] as Object,
        mode: allocMode,
      );
      for (var i = 0; i < items.length; i++) {
        items[i]['item_gross'] = allocated[i]['gross'];
        items[i]['allocated_discount'] = allocated[i]['allocated_discount'];
        items[i]['item_net'] = allocated[i]['net'];
      }
    }

    _assertConservationLaw(tx);
    _appendOpLog('TRANSACTION', txId, 'UPSERT', tx, currentHlc);
    return _cloneMap(tx);
  }

  /// Alias matching Web `LocalLedgerEngine.settleMastercardPending`.
  Map<String, dynamic> settleMastercardPending(
    String txId,
    String actualCny, [
    String? settledAt,
  ]) =>
      settleMastercardTransaction(txId, actualCny, settledAt: settledAt);

  // --------------------------------------------------------------------------
  // Write Operation 5: Transaction Update
  // --------------------------------------------------------------------------

  Map<String, dynamic> updateTransaction(
    String txId,
    Map<String, dynamic> patch,
  ) {
    final idx = transactions.indexWhere(
      (t) => (t['header'] as Map<String, dynamic>)['id'] == txId,
    );
    if (idx == -1) {
      throw ArgumentError('Transaction "$txId" not found');
    }
    final tx = transactions[idx];
    final h = tx['header'] as Map<String, dynamic>;
    final prevGross = h['total_gross'] as String;
    final prevNet = h['total_net'] as String;

    if (patch.containsKey('tx_date') && patch['tx_date'] != null) {
      h['tx_date'] = patch['tx_date'];
    }
    if (patch.containsKey('merchant_or_note') &&
        patch['merchant_or_note'] != null) {
      h['merchant_or_note'] = patch['merchant_or_note'];
    }
    if (patch.containsKey('total_gross') && patch['total_gross'] != null) {
      h['total_gross'] = _bridge.formatCny(patch['total_gross'] as Object);
    }
    if (patch.containsKey('payment_discount') &&
        patch['payment_discount'] != null) {
      h['payment_discount'] =
          _bridge.formatCny(patch['payment_discount'] as Object);
    }
    if (patch.containsKey('total_net') && patch['total_net'] != null) {
      h['total_net'] = _bridge.formatCny(patch['total_net'] as Object);
    } else if (patch.containsKey('total_gross') ||
        patch.containsKey('payment_discount')) {
      final grossCents = _FixedMath.toCents(_bridge, h['total_gross'] as Object);
      final discCents =
          _FixedMath.toCents(_bridge, h['payment_discount'] as Object);
      final netCents =
          grossCents > discCents ? grossCents - discCents : BigInt.zero;
      h['total_net'] = _FixedMath.fromCents(netCents);
    }

    final amountsChanged =
        !_bridge.equalsCny(prevGross, h['total_gross'] as Object) ||
            !_bridge.equalsCny(prevNet, h['total_net'] as Object);

    final items = (tx['items'] as List<dynamic>)
        .map((e) => e as Map<String, dynamic>)
        .toList();
    final itemUpdatesRaw = patch['item_updates'] as List<dynamic>?;
    final itemUpdates = itemUpdatesRaw
        ?.map((u) => Map<String, dynamic>.from(u as Map<dynamic, dynamic>))
        .toList();

    if (items.length == 1) {
      final primary = items[0];
      Map<String, dynamic>? itemPatch;
      if (itemUpdates != null) {
        for (final u in itemUpdates) {
          if (u['index'] == 0 || (u['id'] != null && u['id'] == primary['id'])) {
            itemPatch = u;
            break;
          }
        }
      }
      if (itemPatch != null && itemPatch['item_name'] != null) {
        primary['item_name'] = itemPatch['item_name'];
      } else if (patch['merchant_or_note'] != null) {
        primary['item_name'] = patch['merchant_or_note'];
      }
      if (patch.containsKey('total_gross')) {
        primary['item_gross'] = h['total_gross'];
      }
      if (patch.containsKey('payment_discount')) {
        primary['allocated_discount'] = h['payment_discount'];
      }
      primary['item_net'] = h['total_net'];

      if (itemPatch != null && itemPatch.containsKey('category_id')) {
        primary['category_id'] = itemPatch['category_id'];
      } else if (patch.containsKey('category_id')) {
        primary['category_id'] = patch['category_id'];
      }
      if (itemPatch != null && itemPatch.containsKey('budget_pool_id')) {
        primary['budget_pool_id'] = itemPatch['budget_pool_id'];
      } else if (patch.containsKey('budget_pool_id')) {
        primary['budget_pool_id'] = patch['budget_pool_id'];
      }
      if (itemPatch != null && itemPatch.containsKey('project_tag_id')) {
        primary['project_tag_id'] = itemPatch['project_tag_id'];
      } else if (patch.containsKey('project_tag_id')) {
        primary['project_tag_id'] = patch['project_tag_id'];
      }
    } else if (items.length > 1) {
      for (var i = 0; i < items.length; i++) {
        final item = items[i];
        Map<String, dynamic>? itemPatch;
        if (itemUpdates != null) {
          for (final u in itemUpdates) {
            if (u['index'] == i ||
                (u['id'] != null && u['id'] != 0 && u['id'] == item['id'])) {
              itemPatch = u;
              break;
            }
          }
        }
        if (itemPatch != null) {
          if (itemPatch.containsKey('item_name')) {
            item['item_name'] = itemPatch['item_name'];
          }
          if (itemPatch.containsKey('category_id')) {
            item['category_id'] = itemPatch['category_id'];
          }
          if (itemPatch.containsKey('budget_pool_id')) {
            item['budget_pool_id'] = itemPatch['budget_pool_id'];
          }
          if (itemPatch.containsKey('project_tag_id')) {
            item['project_tag_id'] = itemPatch['project_tag_id'];
          }
        } else if (item['is_primary_item'] == true) {
          if (patch.containsKey('category_id')) {
            item['category_id'] = patch['category_id'];
          }
          if (patch.containsKey('budget_pool_id')) {
            item['budget_pool_id'] = patch['budget_pool_id'];
          }
          if (patch.containsKey('project_tag_id')) {
            item['project_tag_id'] = patch['project_tag_id'];
          }
        }
      }

      if (amountsChanged) {
        final oldGrossCents = _FixedMath.toCents(_bridge, prevGross);
        final newGrossCents = _FixedMath.toCents(_bridge, h['total_gross'] as Object);
        List<BigInt> scaledGrosses;
        if (!_bridge.equalsCny(prevGross, h['total_gross'] as Object) &&
            oldGrossCents > BigInt.zero) {
          scaledGrosses = items
              .map(
                (it) => _FixedMath.mulDivCentsRoundHalfUp(
                  _FixedMath.toCents(_bridge, it['item_gross'] as Object),
                  newGrossCents,
                  oldGrossCents,
                ),
              )
              .toList();
          final sumScaled =
              scaledGrosses.fold<BigInt>(BigInt.zero, (a, b) => a + b);
          final diff = newGrossCents - sumScaled;
          if (diff != BigInt.zero && scaledGrosses.isNotEmpty) {
            scaledGrosses[0] = scaledGrosses[0] + diff;
          }
        } else {
          scaledGrosses = items
              .map((it) => _FixedMath.toCents(_bridge, it['item_gross'] as Object))
              .toList();
        }

        final splitInputs = <Map<String, dynamic>>[];
        for (var i = 0; i < items.length; i++) {
          splitInputs.add(<String, dynamic>{
            'name': items[i]['item_name'],
            'gross': _FixedMath.fromCents(scaledGrosses[i]),
            'category_id': items[i]['category_id'],
            'budget_pool_id': items[i]['budget_pool_id'],
            'project_tag_id': items[i]['project_tag_id'],
            'is_primary': items[i]['is_primary_item'],
            'raw_formula_expr': items[i]['raw_formula_expr'],
          });
        }
        final mode = h['allocation_mode'] == 'MANUAL'
            ? 'PROPORTIONAL'
            : (h['allocation_mode'] as String);
        final allocated = _bridge.allocateSplitDiscounts(
          items: splitInputs,
          totalNetPaid: h['total_net'] as Object,
          mode: mode,
        );
        for (var i = 0; i < items.length; i++) {
          items[i]['item_gross'] = allocated[i]['gross'];
          items[i]['allocated_discount'] = allocated[i]['allocated_discount'];
          items[i]['item_net'] = allocated[i]['net'];
        }
      }
    }

    final currentHlc = hlc.now();
    h['updated_hlc'] = currentHlc;
    _assertConservationLaw(tx);
    _appendOpLog('TRANSACTION', txId, 'UPSERT', tx, currentHlc);
    return _cloneMap(tx);
  }

  // --------------------------------------------------------------------------
  // Write Operation 6: Transaction Soft Delete with Voucher Rollback
  // --------------------------------------------------------------------------

  Map<String, dynamic> deleteTransaction(String txId) {
    final idx = transactions.indexWhere(
      (t) => (t['header'] as Map<String, dynamic>)['id'] == txId,
    );
    if (idx == -1) {
      throw ArgumentError('Transaction "$txId" not found');
    }
    final tx = transactions[idx];
    final h = tx['header'] as Map<String, dynamic>;
    final appliedVoucherId = h['applied_voucher_id'] as int?;
    if (appliedVoucherId != null) {
      final vIdx = vouchers.indexWhere((v) => v['id'] == appliedVoucherId);
      if (vIdx != -1) {
        final v = vouchers[vIdx];
        v['status'] = 'AVAILABLE';
        v['used_tx_id'] = null;
        _appendOpLog('VOUCHER', '$appliedVoucherId', 'UPSERT', v);
      }
    }

    final purchasedVouchers =
        vouchers.where((v) => v['purchase_tx_id'] == txId).toList();
    if (purchasedVouchers.isNotEmpty) {
      final purchasedIds = purchasedVouchers.map((v) => v['id']).toSet();
      for (final other in transactions) {
        final oh = other['header'] as Map<String, dynamic>;
        if (oh['is_deleted'] != true &&
            purchasedIds.contains(oh['applied_voucher_id'])) {
          oh['applied_voucher_id'] = null;
          final otherHlc = hlc.now();
          oh['updated_hlc'] = otherHlc;
          _appendOpLog(
            'TRANSACTION',
            oh['id'] as String,
            'UPSERT',
            other,
            otherHlc,
          );
        }
      }
      vouchers.removeWhere((v) => purchasedIds.contains(v['id']));
      for (final vid in purchasedIds) {
        _appendOpLog('VOUCHER', '$vid', 'DELETE', <String, dynamic>{'id': vid});
      }
    }

    final delHlc = hlc.now();
    h['is_deleted'] = true;
    h['updated_hlc'] = delHlc;
    _appendOpLog('TRANSACTION', txId, 'UPSERT', tx, delHlc);
    return _cloneMap(tx);
  }

  /// Restores a previously soft-deleted transaction and re-binds its voucher if still available.
  Map<String, dynamic> restoreTransaction(String txId) {
    final idx = transactions.indexWhere(
      (t) => (t['header'] as Map<String, dynamic>)['id'] == txId,
    );
    if (idx == -1) {
      throw ArgumentError('Transaction "$txId" not found');
    }
    final tx = transactions[idx];
    final h = tx['header'] as Map<String, dynamic>;
    final restoreHlc = hlc.now();
    h['is_deleted'] = false;
    h['updated_hlc'] = restoreHlc;

    final appliedVoucherId = h['applied_voucher_id'] as int?;
    if (appliedVoucherId != null) {
      final vIdx = vouchers.indexWhere((v) => v['id'] == appliedVoucherId);
      if (vIdx != -1) {
        final v = vouchers[vIdx];
        if (v['status'] == 'AVAILABLE') {
          v['status'] = 'USED';
          v['used_tx_id'] = txId;
          _appendOpLog('VOUCHER', '$appliedVoucherId', 'UPSERT', v);
        } else if (v['used_tx_id'] != txId) {
          h['applied_voucher_id'] = null;
        }
      } else {
        h['applied_voucher_id'] = null;
      }
    }

    _appendOpLog('TRANSACTION', txId, 'UPSERT', tx, restoreHlc);
    return _cloneMap(tx);
  }

  // --------------------------------------------------------------------------
  // Write Operation 7 & Configuration Management
  // --------------------------------------------------------------------------

  Map<String, dynamic> upsertBudgetPool({
    required String id,
    String? name,
    String? poolType,
    bool? isMonthlyBudget,
    String? rolloverStrategy,
    String? description,
    int? sortOrder,
  }) {
    final idx = budgetPools.indexWhere((p) => p['id'] == id);
    Map<String, dynamic> pool;
    if (idx != -1) {
      pool = budgetPools[idx];
      if (name != null) pool['name'] = name;
      if (poolType != null) pool['pool_type'] = poolType;
      if (isMonthlyBudget != null) pool['is_monthly_budget'] = isMonthlyBudget;
      if (rolloverStrategy != null) {
        pool['rollover_strategy'] = rolloverStrategy;
      }
      if (description != null) pool['description'] = description;
      if (sortOrder != null) pool['sort_order'] = sortOrder;
    } else {
      pool = <String, dynamic>{
        'id': id,
        'name': name ?? id,
        'pool_type': poolType ?? 'FLEX',
        'is_monthly_budget': isMonthlyBudget ?? true,
        'rollover_strategy': rolloverStrategy ?? 'ACCUMULATE',
        'description': description,
        'sort_order': sortOrder ?? 50,
      };
      budgetPools.add(pool);
    }
    _appendOpLog('BUDGET_POOL', id, 'UPSERT', pool);
    return _cloneMap(pool);
  }

  void setMonthlyBudget({
    required String yearMonth,
    required String poolId,
    required String baseAllocation,
    String rolloverFromPrev = '0.00',
  }) {
    final baseStr = _bridge.formatCny(baseAllocation);
    final rolloverStr = _bridge.formatCny(rolloverFromPrev);
    final idx = monthlyBudgets.indexWhere(
      (b) => b['year_month'] == yearMonth && b['pool_id'] == poolId,
    );
    Map<String, dynamic> row;
    if (idx != -1) {
      row = monthlyBudgets[idx];
      row['base_allocation'] = baseStr;
      row['rollover_from_prev'] = rolloverStr;
    } else {
      _monthlyBudgetSeq += 1;
      row = <String, dynamic>{
        'id': _monthlyBudgetSeq,
        'year_month': yearMonth,
        'pool_id': poolId,
        'base_allocation': baseStr,
        'rollover_from_prev': rolloverStr,
        'reserved_fixed': '0.00',
        'swept_to_fund': '0.00',
        'note': null,
      };
      monthlyBudgets.add(row);
    }
    _appendOpLog('MONTHLY_BUDGET', '$yearMonth:$poolId', 'UPSERT', row);
  }

  List<Map<String, dynamic>> executeMonthRollover(
    String fromYearMonth,
    String toYearMonth,
  ) {
    final fromStatus = getMonthlyBudgetStatus(fromYearMonth);
    for (final pool in budgetPools) {
      final poolId = pool['id'] as String;
      final fromPoolRow = monthlyBudgets
          .where((b) => b['year_month'] == fromYearMonth && b['pool_id'] == poolId)
          .toList();
      final statusRow = fromStatus.firstWhere((r) => r['pool_id'] == poolId);

      final rollover = pool['rollover_strategy'] == 'ACCUMULATE'
          ? statusRow['remaining_budget'] as String
          : '0.00';

      final existingIdx = monthlyBudgets.indexWhere(
        (b) => b['year_month'] == toYearMonth && b['pool_id'] == poolId,
      );
      Map<String, dynamic> targetRow;
      if (existingIdx != -1) {
        targetRow = monthlyBudgets[existingIdx];
        targetRow['rollover_from_prev'] = rollover;
      } else {
        _monthlyBudgetSeq += 1;
        final baseAlloc = fromPoolRow.isNotEmpty
            ? fromPoolRow.first['base_allocation'] as String
            : '0.00';
        targetRow = <String, dynamic>{
          'id': _monthlyBudgetSeq,
          'year_month': toYearMonth,
          'pool_id': poolId,
          'base_allocation': baseAlloc,
          'rollover_from_prev': rollover,
          'reserved_fixed': '0.00',
          'swept_to_fund': '0.00',
          'note': null,
        };
        monthlyBudgets.add(targetRow);
      }
      _appendOpLog(
        'MONTHLY_BUDGET',
        '$toYearMonth:$poolId',
        'UPSERT',
        targetRow,
      );
    }
    return getMonthlyBudgetStatus(toYearMonth);
  }

  Map<String, dynamic> executeRecurringRule(int ruleId, {String? txDate}) {
    final idx = recurringRules.indexWhere((r) => r['id'] == ruleId);
    if (idx == -1) {
      throw ArgumentError('Recurring rule "$ruleId" not found');
    }
    final rule = recurringRules[idx];
    final ruleType = rule['rule_type'] as String;
    final preferredCat =
        ruleType == 'FX_SUBSCRIPTION' ? 'CAT_DIGITAL_SUB' : 'CAT_TELECOM';
    final defaultCat = categories.any((c) => c['id'] == preferredCat)
        ? preferredCat
        : (categories.isNotEmpty ? categories.first['id'] as String? : null);
    final preferredPool =
        ruleType == 'FX_SUBSCRIPTION' ? 'POOL_FLEX' : 'POOL_FIXED';
    final defaultPool = budgetPools.any((p) => p['id'] == preferredPool)
        ? preferredPool
        : (budgetPools.isNotEmpty ? budgetPools.first['id'] as String? : null);
    return recordManualTransaction(
      txType: 'EXPENSE',
      txDate: txDate,
      amount: rule['amount'] as String,
      discount: '0.00',
      categoryId: (rule['category_id'] as String?) ?? defaultCat,
      budgetPoolId: (rule['budget_pool_id'] as String?) ?? defaultPool,
      merchantOrNote: rule['title'] as String,
      currency: (rule['currency'] as String?) ?? 'CNY',
    );
  }

  // --------------------------------------------------------------------------
  // Queries: Monthly Budget Status, Dashboard, Daily Budget Summary
  // --------------------------------------------------------------------------

  List<Map<String, dynamic>> getMonthlyBudgetStatus(String yearMonth) {
    final sortedPools = List<Map<String, dynamic>>.from(budgetPools)
      ..sort(
        (a, b) => (a['id'] as String).compareTo(b['id'] as String),
      );

    final rows = <Map<String, dynamic>>[];
    for (final pool in sortedPools) {
      final poolId = pool['id'] as String;
      final isMonthly = pool['is_monthly_budget'] != false;
      final mbMatch = monthlyBudgets
          .where((b) => b['year_month'] == yearMonth && b['pool_id'] == poolId)
          .toList();
      final mb = mbMatch.isNotEmpty ? mbMatch.first : null;

      final baseCents = mb != null
          ? _FixedMath.toCents(_bridge, mb['base_allocation'] as Object)
          : BigInt.zero;
      final rolloverCents = mb != null
          ? _FixedMath.toCents(_bridge, mb['rollover_from_prev'] as Object)
          : BigInt.zero;
      final reservedCents = mb != null
          ? _FixedMath.toCents(_bridge, mb['reserved_fixed'] as Object)
          : BigInt.zero;
      final sweptCents = mb != null
          ? _FixedMath.toCents(_bridge, mb['swept_to_fund'] as Object)
          : BigInt.zero;

      var spentGrossCents = BigInt.zero;
      var savedDiscCents = BigInt.zero;
      var spentNetCents = BigInt.zero;

      for (final tx in transactions) {
        final h = tx['header'] as Map<String, dynamic>;
        if (h['is_deleted'] == true || h['tx_type'] != 'EXPENSE') continue;
        final txDate = (h['tx_date'] as String?) ?? '';
        if (!txDate.startsWith(yearMonth)) continue;

        final items = tx['items'] as List<dynamic>;
        for (final rawItem in items) {
          final it = rawItem as Map<String, dynamic>;
          if (it['project_tag_id'] != null && isMonthly) continue;
          if (it['budget_pool_id'] == poolId) {
            spentGrossCents += _FixedMath.toCents(_bridge, it['item_gross'] as Object);
            savedDiscCents +=
                _FixedMath.toCents(_bridge, it['allocated_discount'] as Object);
            spentNetCents += _FixedMath.toCents(_bridge, it['item_net'] as Object);
          }
        }
      }

      final totalAvailCents = baseCents + rolloverCents;
      final remainingCents = totalAvailCents - sweptCents - spentNetCents;

      rows.add(<String, dynamic>{
        'year_month': yearMonth,
        'pool_id': poolId,
        'pool_name': pool['name'],
        'pool_type': pool['pool_type'],
        'base_allocation': _FixedMath.fromCents(baseCents),
        'rollover_from_prev': _FixedMath.fromCents(rolloverCents),
        'total_available_budget': _FixedMath.fromCents(totalAvailCents),
        'reserved_fixed': _FixedMath.fromCents(reservedCents),
        'spent_gross': _FixedMath.fromCents(spentGrossCents),
        'total_saved_discount': _FixedMath.fromCents(savedDiscCents),
        'spent_net': _FixedMath.fromCents(spentNetCents),
        'remaining_budget': _FixedMath.fromCents(remainingCents),
      });
    }
    return rows;
  }

  static int _daysInMonth(String yearMonth) {
    final parts = yearMonth.split('-');
    if (parts.length == 2) {
      final y = int.tryParse(parts[0]);
      final m = int.tryParse(parts[1]);
      if (y != null && m != null && m >= 1 && m <= 12) {
        return DateTime(y, m + 1, 0).day;
      }
    }
    return 30;
  }

  Map<String, dynamic> getMonthlyBudgetDashboard(
    String yearMonth, [
    String? currentDateStr,
  ]) {
    final effectiveToday = currentDateStr ?? getLocalTodayDateStr();
    final pools = getMonthlyBudgetStatus(yearMonth);
    final daysInMonth = _daysInMonth(yearMonth);
    final isCurrentMonth = effectiveToday.startsWith(yearMonth);
    final currentDay = isCurrentMonth
        ? (int.tryParse(effectiveToday.substring(8, 10)) ?? 1)
        : 1;
    final remainingDays = math.max(1, daysInMonth - currentDay + 1);

    final dailyPool = pools.where((p) => p['pool_id'] == 'POOL_DAILY').toList();
    final dailyRemainingCents = dailyPool.isNotEmpty
        ? _FixedMath.toCents(_bridge, dailyPool.first['remaining_budget'] as Object)
        : BigInt.zero;
    final perDayCents = _FixedMath.divRoundHalfUp(
      dailyRemainingCents,
      BigInt.from(remainingDays),
    );

    var totalBudget = BigInt.zero;
    var totalSpent = BigInt.zero;
    var totalSaved = BigInt.zero;
    for (final p in pools) {
      totalBudget +=
          _FixedMath.toCents(_bridge, p['total_available_budget'] as Object);
      totalSpent += _FixedMath.toCents(_bridge, p['spent_net'] as Object);
      totalSaved +=
          _FixedMath.toCents(_bridge, p['total_saved_discount'] as Object);
    }

    return <String, dynamic>{
      'pools': pools,
      'dailyPoolRemainingPerDay': _FixedMath.fromCents(perDayCents),
      'totalMonthlyBudget': _FixedMath.fromCents(totalBudget),
      'totalMonthlySpent': _FixedMath.fromCents(totalSpent),
      'totalMonthlySaved': _FixedMath.fromCents(totalSaved),
    };
  }

  Map<String, dynamic> getDailyBudgetSummary([
    String? yearMonth,
    String? currentDate,
  ]) {
    final targetDate = currentDate ?? getLocalTodayDateStr();
    final targetYm = yearMonth ?? targetDate.substring(0, 7);
    final statuses = getMonthlyBudgetStatus(targetYm);
    final dailyList =
        statuses.where((s) => s['pool_id'] == 'POOL_DAILY').toList();
    final dailyRow = dailyList.isNotEmpty
        ? dailyList.first
        : (statuses.isNotEmpty ? statuses.first : null);

    final daysInMonth = _daysInMonth(targetYm);
    final currentDay = targetDate.startsWith(targetYm)
        ? (int.tryParse(targetDate.substring(8, 10)) ?? 1)
        : 1;
    final remainingDays = math.max(1, daysInMonth - currentDay + 1);

    final remainingRaw =
        dailyRow != null ? (dailyRow['remaining_budget'] as String) : '0.00';
    final remainingCents = _FixedMath.toCents(_bridge, remainingRaw);
    final clampedRemainingCents =
        remainingCents < BigInt.zero ? BigInt.zero : remainingCents;
    final dailyAvailCents = _FixedMath.divRoundHalfUp(
      clampedRemainingCents,
      BigInt.from(remainingDays),
    );
    final dailyAvailStr = _FixedMath.fromCents(dailyAvailCents);
    final clampedRemainingStr = _FixedMath.fromCents(clampedRemainingCents);

    var totalSavedWoolCents = BigInt.zero;
    for (final s in statuses) {
      totalSavedWoolCents +=
          _FixedMath.toCents(_bridge, s['total_saved_discount'] as Object);
    }

    return <String, dynamic>{
      'poolName': dailyRow != null
          ? '${dailyRow['pool_name']} (${dailyRow['pool_id']})'
          : '日均预算概览',
      'totalAvailable':
          dailyRow != null ? dailyRow['total_available_budget'] : '0.00',
      'spentNet': dailyRow != null ? dailyRow['spent_net'] : '0.00',
      'remainingBudget': remainingRaw,
      'remainingDays': remainingDays,
      'dailyAvailableAmount': dailyAvailStr,
      'formula': '($clampedRemainingStr 元 ÷ $remainingDays 剩余天数)',
      'totalSavedWool': _FixedMath.fromCents(totalSavedWoolCents),
    };
  }

  List<Map<String, dynamic>> getRecentTransactions([int limit = 50]) {
    final active = transactions
        .where((tx) => (tx['header'] as Map<String, dynamic>)['is_deleted'] != true)
        .toList();
    active.sort((a, b) {
      final ah = a['header'] as Map<String, dynamic>;
      final bh = b['header'] as Map<String, dynamic>;
      final cmpDate = (bh['tx_date'] as String).compareTo(ah['tx_date'] as String);
      if (cmpDate != 0) return cmpDate;
      return (bh['created_at'] as String).compareTo(ah['created_at'] as String);
    });
    return active.take(limit).map(_cloneMap).toList();
  }

  // --------------------------------------------------------------------------
  // Sync OpLog LWW Merge
  // --------------------------------------------------------------------------

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
      ..sort((a, b) => ((a['hlc'] ?? a['hlc_ts']) as String)
          .compareTo((b['hlc'] ?? b['hlc_ts']) as String));

    for (final op in accepted) {
      hlc.receive((op['hlc'] ?? op['hlc_ts']) as String);
      _applyAcceptedOp(op);
    }
    return <String, dynamic>{
      'acceptedCount': accepted.length,
      'totalOplogCount': syncOplog.length,
    };
  }

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

  // --------------------------------------------------------------------------
  // Mobile Dashboard Pending Banners, Projects, Pools, Rules & Settings
  // --------------------------------------------------------------------------

  /// Returns all non-deleted transactions waiting for Mastercard FX settlement.
  List<Map<String, dynamic>> getPendingFxTransactions() {
    return transactions
        .where((tx) {
          final h = tx['header'] as Map<String, dynamic>;
          return h['is_deleted'] != true &&
              h['settlement_status'] == 'PENDING_HOLD';
        })
        .map(_cloneMap)
        .toList();
  }

  /// Returns active recurring rules not yet dismissed or recorded in [yearMonth].
  List<Map<String, dynamic>> getPendingRecurringRules([String? yearMonth]) {
    final ym = yearMonth ?? getLocalTodayDateStr().substring(0, 7);
    final recordedTitlesThisMonth = <String>{};
    for (final tx in transactions) {
      final h = tx['header'] as Map<String, dynamic>;
      if (h['is_deleted'] == true) continue;
      final txDate = (h['tx_date'] as String?) ?? '';
      if (!txDate.startsWith(ym)) continue;
      final note = (h['merchant_or_note'] as String?) ?? '';
      if (note.isNotEmpty) recordedTitlesThisMonth.add(note);
    }

    return recurringRules
        .where((rule) {
          if (rule['is_active'] != true) return false;
          final id = rule['id'] as int;
          if (dismissedRecurringRuleIds.contains(id)) return false;
          final title = (rule['title'] as String?) ?? '';
          return !recordedTitlesThisMonth.contains(title);
        })
        .map(_cloneMap)
        .toList();
  }

  void dismissRecurringRule(int ruleId) {
    dismissedRecurringRuleIds.add(ruleId);
    saveToDisk();
  }

  Map<String, dynamic> upsertRecurringRule({
    int? id,
    required String title,
    String ruleType = 'FIXED_EXPENSE',
    String cronCycle = 'MONTHLY',
    int triggerDay = 1,
    String currency = 'CNY',
    required String amount,
    String? budgetPoolId,
    String? categoryId,
    bool autoReserveBudget = true,
    bool isActive = true,
  }) {
    final amtFormatted = _bridge.formatCny(amount);
    final clampedDay = math.min(31, math.max(1, triggerDay));
    final upperCurr = currency.toUpperCase();
    final derivedType =
        upperCurr == 'CNY' ? ruleType : 'FX_SUBSCRIPTION';

    if (id != null) {
      final idx = recurringRules.indexWhere((r) => r['id'] == id);
      if (idx == -1) throw ArgumentError('Recurring rule "$id" not found');
      final r = recurringRules[idx];
      r['title'] = title.trim();
      r['rule_type'] = derivedType;
      r['cron_cycle'] = cronCycle;
      r['trigger_day'] = clampedDay;
      r['currency'] = upperCurr;
      r['amount'] = amtFormatted;
      r['budget_pool_id'] = budgetPoolId;
      if (categoryId != null) r['category_id'] = categoryId;
      r['auto_reserve_budget'] = autoReserveBudget;
      r['is_active'] = isActive;
      _appendOpLog('RECURRING_RULE', '$id', 'UPSERT', r);
      return _cloneMap(r);
    }

    _recurringSeq += 1;
    final preferredCat =
        derivedType == 'FX_SUBSCRIPTION' ? 'CAT_DIGITAL_SUB' : 'CAT_TELECOM';
    final fallbackCat =
        categories.any((c) => c['id'] == preferredCat) ? preferredCat : null;
    final rule = <String, dynamic>{
      'id': _recurringSeq,
      'title': title.trim(),
      'rule_type': derivedType,
      'cron_cycle': cronCycle,
      'trigger_day': clampedDay,
      'currency': upperCurr,
      'amount': amtFormatted,
      'category_id': categoryId ?? fallbackCat,
      'budget_pool_id': budgetPoolId,
      'auto_reserve_budget': autoReserveBudget,
      'is_active': isActive,
    };
    recurringRules.add(rule);
    _appendOpLog('RECURRING_RULE', '${rule['id']}', 'UPSERT', rule);
    return _cloneMap(rule);
  }

  void deleteRecurringRule(int ruleId) {
    final idx = recurringRules.indexWhere((r) => r['id'] == ruleId);
    if (idx == -1) return;
    recurringRules.removeAt(idx);
    dismissedRecurringRuleIds.remove(ruleId);
    _appendOpLog(
      'RECURRING_RULE',
      '$ruleId',
      'DELETE',
      <String, dynamic>{'id': ruleId},
    );
  }

  void deleteBudgetPool(String poolId) {
    final inCategories =
        categories.any((c) => c['default_pool_id'] == poolId);
    final inItems = transactions.any((tx) {
      final h = tx['header'] as Map<String, dynamic>;
      if (h['is_deleted'] == true) return false;
      final items = tx['items'] as List<dynamic>;
      return items.any(
        (it) => (it as Map<String, dynamic>)['budget_pool_id'] == poolId,
      );
    });
    if (inCategories || inItems) {
      throw StateError('预算池正在被分类或交易使用，无法直接删除！请先重新分配相关交易。');
    }
    budgetPools.removeWhere((p) => p['id'] == poolId);
    monthlyBudgets.removeWhere((b) => b['pool_id'] == poolId);
    _appendOpLog('BUDGET_POOL', poolId, 'DELETE', <String, dynamic>{'id': poolId});
  }

  Map<String, dynamic> upsertProjectTag({
    String? id,
    required String name,
    String tagType = 'PROJECT',
    String? targetBudget,
    bool isActive = true,
    String? startDate,
    String? endDate,
  }) {
    final cleanName = name.trim();
    if (cleanName.isEmpty) {
      throw ArgumentError('专项名称不能为空');
    }
    final idx = projectTags.indexWhere(
      (t) => (id != null && t['id'] == id) || t['name'] == cleanName,
    );
    final formattedTarget =
        (targetBudget != null && targetBudget.trim().isNotEmpty)
            ? _bridge.formatCny(targetBudget.trim())
            : null;
    final cleanStart =
        startDate != null && startDate.trim().isNotEmpty ? startDate.trim() : null;
    final cleanEnd =
        endDate != null && endDate.trim().isNotEmpty ? endDate.trim() : null;

    if (idx != -1) {
      final tag = projectTags[idx];
      tag['name'] = cleanName;
      tag['tag_type'] = tagType;
      tag['target_budget'] = formattedTarget;
      tag.remove('linked_pool_id');
      tag['is_active'] = isActive;
      if (startDate != null) tag['start_date'] = cleanStart;
      if (endDate != null) tag['end_date'] = cleanEnd;
      _appendOpLog('PROJECT_TAG', tag['id'] as String, 'UPSERT', tag);
      return _cloneMap(tag);
    }

    final newId =
        id ?? 'TAG_${DateTime.now().millisecondsSinceEpoch}';
    final tag = <String, dynamic>{
      'id': newId,
      'name': cleanName,
      'tag_type': tagType,
      'target_budget': formattedTarget,
      'is_active': isActive,
      if (cleanStart != null) 'start_date': cleanStart,
      if (cleanEnd != null) 'end_date': cleanEnd,
    };
    projectTags.add(tag);
    _appendOpLog('PROJECT_TAG', newId, 'UPSERT', tag);
    return _cloneMap(tag);
  }

  void deleteProjectTag(String tagId) {
    final inUse = transactions.any((tx) {
      final h = tx['header'] as Map<String, dynamic>;
      if (h['is_deleted'] == true) return false;
      final items = tx['items'] as List<dynamic>;
      return items.any(
        (it) => (it as Map<String, dynamic>)['project_tag_id'] == tagId,
      );
    });
    if (inUse) {
      throw StateError('专项预算已被交易流水引用，无法直接删除！');
    }
    projectTags.removeWhere((t) => t['id'] == tagId);
    _appendOpLog('PROJECT_TAG', tagId, 'DELETE', <String, dynamic>{'id': tagId});
  }

  /// Computes spent, target, remaining and tx counts per project tag.
  Map<String, dynamic> getProjectTagsSummary([String? currentDateStr]) {
    final today = currentDateStr ?? getLocalTodayDateStr();
    var totalTargetCents = BigInt.zero;
    var totalSpentCents = BigInt.zero;
    final rows = <Map<String, dynamic>>[];

    for (final tag in projectTags) {
      final tagId = tag['id'] as String;
      final endDate = tag['end_date'] as String?;
      final effectiveActive = (tag['is_active'] != false) &&
          (endDate == null || endDate.isEmpty || today.compareTo(endDate) <= 0);
      final targetStr = tag['target_budget'] as String?;
      final targetCents = targetStr != null && targetStr.isNotEmpty
          ? _FixedMath.toCents(_bridge, targetStr)
          : BigInt.zero;

      var tagSpentCents = BigInt.zero;
      var txCount = 0;
      for (final tx in transactions) {
        final h = tx['header'] as Map<String, dynamic>;
        if (h['is_deleted'] == true || h['tx_type'] != 'EXPENSE') continue;
        final items = tx['items'] as List<dynamic>;
        var matched = false;
        for (final rawItem in items) {
          final it = rawItem as Map<String, dynamic>;
          if (it['project_tag_id'] == tagId) {
            matched = true;
            tagSpentCents +=
                _FixedMath.toCents(_bridge, it['item_net'] as Object);
          }
        }
        if (matched) txCount += 1;
      }

      totalTargetCents += targetCents;
      totalSpentCents += tagSpentCents;

      final copy = _cloneMap(tag);
      copy['effective_active'] = effectiveActive;
      copy['spent_net'] = _FixedMath.fromCents(tagSpentCents);
      copy['remaining_budget'] = targetStr != null
          ? _FixedMath.fromCents(targetCents - tagSpentCents)
          : null;
      copy['tx_count'] = txCount;
      rows.add(copy);
    }

    return <String, dynamic>{
      'projects': rows,
      'active_count':
          rows.where((r) => r['effective_active'] == true).length,
      'total_target': _FixedMath.fromCents(totalTargetCents),
      'total_spent': _FixedMath.fromCents(totalSpentCents),
      'total_remaining':
          _FixedMath.fromCents(totalTargetCents - totalSpentCents),
    };
  }

  void updateFxSettings({
    String? defaultHoldRatio,
    String? defaultCashbackRate,
    String? monthlyCashbackCapCny,
  }) {
    if (defaultHoldRatio != null && defaultHoldRatio.trim().isNotEmpty) {
      settings['fx_default_hold_ratio'] = defaultHoldRatio.trim();
    }
    if (defaultCashbackRate != null && defaultCashbackRate.trim().isNotEmpty) {
      settings['fx_default_cashback_rate'] = defaultCashbackRate.trim();
    }
    if (monthlyCashbackCapCny != null) {
      final cleanCap = monthlyCashbackCapCny.trim();
      if (cleanCap.isEmpty) {
        settings.remove('fx_monthly_cashback_cap_cny');
      } else {
        settings['fx_monthly_cashback_cap_cny'] = _bridge.formatCny(cleanCap);
      }
    }
    saveToDisk();
  }

  // --------------------------------------------------------------------------
  // Mobile Sync Indicator, Pull-to-Refresh Sync, Conflict Resolution & Backup
  // --------------------------------------------------------------------------

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

  static bool _asBool(dynamic v, {bool fallback = false}) {
    if (v is bool) return v;
    if (v is num) return v != 0;
    if (v is String) return v == '1' || v.toLowerCase() == 'true';
    return fallback;
  }

  static int _asInt(dynamic v, [int fallback = 0]) {
    if (v is int) return v;
    if (v is num) return v.toInt();
    if (v is String) {
      final trimmed = v.trim();
      final i = int.tryParse(trimmed);
      if (i != null) return i;
      final d = double.tryParse(trimmed);
      if (d != null) return d.toInt();
    }
    return fallback;
  }

  static int? _asNullableInt(dynamic v) {
    if (v == null) return null;
    if (v is String && v.trim().isEmpty) return null;
    return _asInt(v, 0);
  }

  static String _asStr(dynamic v, [String fallback = '']) {
    if (v == null) return fallback;
    return v.toString();
  }

  static String? _asNullableStr(dynamic v) {
    if (v == null) return null;
    final s = v.toString();
    return s.isEmpty ? null : s;
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

  void _recomputeSeqWatermarks() {
    var maxVoucherId = 0;
    for (final v in vouchers) {
      final id = _asInt(v['id']);
      if (id > maxVoucherId) maxVoucherId = id;
    }
    _voucherSeq = maxVoucherId;

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

  void saveToDisk() {
    if (_suppressPersist || _storageFilePath == null) return;
    try {
      final file = File(_storageFilePath);
      final dir = file.parent;
      if (!dir.existsSync()) {
        dir.createSync(recursive: true);
      }
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
      final encoded = jsonEncode(snapshot);
      final tmpFile = File('${file.path}.tmp');
      tmpFile.writeAsStringSync(encoded, flush: true);
      if (file.existsSync()) {
        try {
          tmpFile.renameSync(file.path);
          return;
        } catch (_) {
          // Fallback on filesystems disallowing overwrite on rename
        }
      }
      file.writeAsStringSync(encoded, flush: true);
      if (tmpFile.existsSync()) {
        try {
          tmpFile.deleteSync();
        } catch (_) {}
      }
    } catch (_) {
      // Avoid crashing UI actions on transient storage IO failures
    }
  }

  void _loadFromDisk() {
    if (_storageFilePath == null) return;
    try {
      final file = File(_storageFilePath);
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
            .toList();
      }
      if (map['dismissedRecurringRuleIds'] is List) {
        dismissedRecurringRuleIds = (map['dismissedRecurringRuleIds'] as List<dynamic>)
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
            Map<String, dynamic>.from(data['fullBundle'] as Map<dynamic, dynamic>),
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
            Map<String, dynamic>.from(data['fullBundle'] as Map<dynamic, dynamic>),
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
        'oplogCount':
            (res['oplogCount'] as num?)?.toInt() ?? syncOplog.length,
        'transactionsCount': transactions.length,
      };
    } catch (e) {
      lastSyncError = e.toString();
      rethrow;
    } finally {
      isSyncing = false;
      saveToDisk();
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
    }
    return syncWithServer(baseUrl: targetBase);
  }

  Map<String, dynamic> exportFullSyncBundle() {
    return <String, dynamic>{
      'nodeId': hlc.nodeId,
      'exportedAt': _nowIso(),
      'budgetPools': _cloneListOfMaps(budgetPools),
      'monthlyBudgets': _cloneListOfMaps(monthlyBudgets),
      'categories': _cloneListOfMaps(categories),
      'projectTags': _cloneListOfMaps(projectTags),
      'vouchers': _cloneListOfMaps(vouchers),
      'recurringRules': _cloneListOfMaps(recurringRules),
      'transactions': _cloneListOfMaps(transactions),
      'settings': Map<String, String>.from(settings),
      'oplogs': _cloneListOfMaps(syncOplog),
    };
  }

  String exportBackupJson() =>
      const JsonEncoder.withIndent('  ').convert(exportFullSyncBundle());

  Map<String, int> importFullSyncBundle(Map<String, dynamic> rawMap) {
    final map = rawMap['bundle'] is Map
        ? Map<String, dynamic>.from(rawMap['bundle'] as Map<dynamic, dynamic>)
        : rawMap;

    if (map['budgetPools'] is List) {
      budgetPools = (map['budgetPools'] as List<dynamic>)
          .whereType<Map<dynamic, dynamic>>()
          .map((e) {
            final row = Map<String, dynamic>.from(e);
            final rawType = _asStr(row['pool_type'], 'FLEX');
            row['id'] = _asStr(row['id']);
            row['name'] = _asStr(row['name'], row['id'] as String);
            row['pool_type'] =
                rawType == 'CAPITAL_ASSET' ? 'FLEX' : rawType;
            row['is_monthly_budget'] = _asBool(
              row['is_monthly_budget'],
              fallback: true,
            );
            row['rollover_strategy'] = _asStr(
              row['rollover_strategy'],
              'ACCUMULATE',
            );
            row['description'] = _asNullableStr(row['description']);
            row['sort_order'] = _asInt(row['sort_order'], 100);
            return row;
          })
          .where(
            (p) => p['id'] != 'POOL_FUND' && p['id'] != 'POOL_ASSET',
          )
          .toList();
    }
    if (map['monthlyBudgets'] is List) {
      monthlyBudgets = (map['monthlyBudgets'] as List<dynamic>)
          .whereType<Map<dynamic, dynamic>>()
          .map((e) {
            final row = Map<String, dynamic>.from(e);
            row['id'] = _asInt(row['id']);
            row['year_month'] = _asStr(row['year_month']);
            row['pool_id'] = _asStr(row['pool_id']);
            row['base_allocation'] = _asMoney(row['base_allocation']);
            row['rollover_from_prev'] = _asMoney(row['rollover_from_prev']);
            row['reserved_fixed'] = _asMoney(row['reserved_fixed']);
            row['swept_to_fund'] = _asMoney(row['swept_to_fund']);
            row['note'] = _asNullableStr(row['note']);
            return row;
          })
          .where(
            (b) =>
                b['pool_id'] != 'POOL_FUND' && b['pool_id'] != 'POOL_ASSET',
          )
          .toList();
    }
    if (map['categories'] is List) {
      categories = (map['categories'] as List<dynamic>)
          .whereType<Map<dynamic, dynamic>>()
          .map((e) {
            final row = Map<String, dynamic>.from(e);
            row['id'] = _asStr(row['id']);
            row['parent_id'] = _asNullableStr(row['parent_id']);
            row['name'] = _asStr(row['name'], row['id'] as String);
            final rawPool = _asStr(row['default_pool_id'], 'POOL_FLEX');
            row['default_pool_id'] =
                (rawPool == 'POOL_FUND' || rawPool == 'POOL_ASSET')
                    ? 'POOL_FLEX'
                    : rawPool;
            row['icon_name'] = _asNullableStr(row['icon_name']);
            row['keywords'] = _asNullableStr(row['keywords']);
            row['sort_order'] = _asInt(row['sort_order'], 100);
            return row;
          })
          .toList();
    }
    if (map['projectTags'] is List) {
      projectTags = (map['projectTags'] as List<dynamic>)
          .whereType<Map<dynamic, dynamic>>()
          .map((e) {
            final row = Map<String, dynamic>.from(e);
            row.remove('linked_pool_id');
            row['id'] = _asStr(row['id']);
            row['name'] = _asStr(row['name'], row['id'] as String);
            row['tag_type'] = _asStr(row['tag_type'], 'PROJECT');
            row['target_budget'] = _asNullableMoney(row['target_budget']);
            row['start_date'] = _asNullableStr(row['start_date']);
            row['end_date'] = _asNullableStr(row['end_date']);
            row['is_active'] = _asBool(row['is_active'], fallback: true);
            return row;
          })
          .toList();
    }
    if (map['vouchers'] is List) {
      vouchers = (map['vouchers'] as List<dynamic>)
          .whereType<Map<dynamic, dynamic>>()
          .map((e) {
            final row = Map<String, dynamic>.from(e);
            row['id'] = _asInt(row['id']);
            row['title'] = _asStr(row['title'], '优惠券');
            final rawType = _asStr(row['voucher_type'], 'FREE_COUPON');
            row['voucher_type'] =
                rawType == 'REPAY_COUPON' ? 'FREE_COUPON' : rawType;
            row['face_value'] = _asMoney(row['face_value']);
            row['acquire_cost'] = _asMoney(row['acquire_cost']);
            row['min_spend'] = _asMoney(row['min_spend']);
            row['status'] = _asStr(row['status'], 'AVAILABLE');
            row['purchase_tx_id'] = _asNullableStr(row['purchase_tx_id']);
            row['used_tx_id'] = _asNullableStr(row['used_tx_id']);
            row['expire_date'] = _asNullableStr(row['expire_date']);
            return row;
          })
          .toList();
    }
    if (map['recurringRules'] is List) {
      recurringRules = (map['recurringRules'] as List<dynamic>)
          .whereType<Map<dynamic, dynamic>>()
          .map((e) {
            final row = Map<String, dynamic>.from(e);
            row['id'] = _asInt(row['id']);
            row['title'] = _asStr(row['title'], '固定规则');
            row['rule_type'] = _asStr(row['rule_type'], 'FIXED_EXPENSE');
            row['cron_cycle'] = _asStr(row['cron_cycle'], 'MONTHLY');
            row['trigger_day'] = _asInt(row['trigger_day'], 1).clamp(1, 31);
            row['currency'] = _asStr(row['currency'], 'CNY');
            row['amount'] = _asMoney(row['amount']);
            row['category_id'] = _asNullableStr(row['category_id']);
            final rawPool = _asNullableStr(row['budget_pool_id']);
            row['budget_pool_id'] =
                (rawPool == 'POOL_FUND' || rawPool == 'POOL_ASSET')
                    ? 'POOL_FLEX'
                    : rawPool;
            row['auto_reserve_budget'] = _asBool(
              row['auto_reserve_budget'],
              fallback: true,
            );
            row['is_active'] = _asBool(row['is_active'], fallback: true);
            return row;
          })
          .where((r) => r['rule_type'] != 'AUTO_INVEST')
          .toList();
    }
    if (map['transactions'] is List) {
      transactions = (map['transactions'] as List<dynamic>)
          .whereType<Map<dynamic, dynamic>>()
          .map((e) {
            final row = Map<String, dynamic>.from(e);
            final rawHeader = row['header'] is Map
                ? Map<String, dynamic>.from(
                    row['header'] as Map<dynamic, dynamic>,
                  )
                : Map<String, dynamic>.from(row);
            rawHeader.remove('account_id');
            rawHeader.remove('target_account_id');
            final txId = _asStr(rawHeader['id']);
            final rawDate = _asStr(
              rawHeader['tx_date'],
              getLocalTodayDateStr(),
            );
            final txDate =
                rawDate.length >= 10 ? rawDate.substring(0, 10) : rawDate;
            rawHeader['id'] = txId;
            rawHeader['tx_date'] = txDate;
            rawHeader['tx_type'] = _asStr(rawHeader['tx_type'], 'EXPENSE');
            rawHeader['total_gross'] = _asMoney(rawHeader['total_gross']);
            rawHeader['platform_discount'] =
                _asMoney(rawHeader['platform_discount']);
            rawHeader['payment_discount'] =
                _asMoney(rawHeader['payment_discount']);
            rawHeader['total_net'] = _asMoney(rawHeader['total_net']);
            rawHeader['allocation_mode'] =
                _asStr(rawHeader['allocation_mode'], 'SINGLE');
            rawHeader['original_currency'] =
                _asStr(rawHeader['original_currency'], 'CNY');
            rawHeader['original_amount'] =
                _asNullableMoney(rawHeader['original_amount']);
            rawHeader['exchange_rate'] =
                _asNullableStr(rawHeader['exchange_rate']) ?? '1.000000';
            rawHeader['settlement_status'] =
                _asStr(rawHeader['settlement_status'], 'SETTLED');
            rawHeader['hold_amount_cny'] =
                _asMoney(rawHeader['hold_amount_cny']);
            rawHeader['fx_cashback_rate'] =
                _asNullableStr(rawHeader['fx_cashback_rate']);
            rawHeader['applied_voucher_id'] =
                _asNullableInt(rawHeader['applied_voucher_id']);
            rawHeader['raw_input_text'] =
                _asNullableStr(rawHeader['raw_input_text']);
            rawHeader['merchant_or_note'] = _asStr(
              rawHeader['merchant_or_note'] ?? rawHeader['raw_input_text'],
              '未命名账单',
            );
            rawHeader['created_at'] = _asNullableStr(rawHeader['created_at']);
            rawHeader['settled_at'] = _asNullableStr(rawHeader['settled_at']);
            rawHeader['updated_hlc'] = _asNullableStr(rawHeader['updated_hlc']);
            rawHeader['is_deleted'] = _asBool(rawHeader['is_deleted']);

            final rawItems = row['items'] is List
                ? row['items'] as List<dynamic>
                : <dynamic>[];
            final normalizedItems = <Map<String, dynamic>>[];
            for (var i = 0; i < rawItems.length; i++) {
              final item = rawItems[i];
              if (item is! Map) continue;
              final m = Map<String, dynamic>.from(item);
              m['id'] = _asInt(m['id'], i + 1);
              m['tx_id'] = _asStr(m['tx_id'], txId);
              m['item_index'] = _asInt(m['item_index'], i);
              m['item_name'] = _asStr(m['item_name'], '消费明细');
              m['category_id'] = _asNullableStr(m['category_id']);
              final rawPool = _asNullableStr(m['budget_pool_id']);
              m['budget_pool_id'] =
                  (rawPool == 'POOL_FUND' || rawPool == 'POOL_ASSET')
                      ? 'POOL_FLEX'
                      : rawPool;
              m['project_tag_id'] = _asNullableStr(m['project_tag_id']);
              m['item_gross'] = _asMoney(m['item_gross']);
              m['allocated_discount'] = _asMoney(m['allocated_discount']);
              m['item_net'] = _asMoney(m['item_net']);
              m['is_primary_item'] = _asBool(m['is_primary_item']);
              m['raw_formula_expr'] = _asNullableStr(m['raw_formula_expr']);
              normalizedItems.add(m);
            }

            return <String, dynamic>{
              'header': rawHeader,
              'items': normalizedItems,
            };
          })
          .toList();
    }
    if (map['settings'] is Map) {
      settings = (map['settings'] as Map<dynamic, dynamic>).map(
        (k, v) => MapEntry(k.toString(), v?.toString() ?? ''),
      );
    }
    if (map['fxConfig'] is Map) {
      final fx = map['fxConfig'] as Map<dynamic, dynamic>;
      if (fx['defaultHoldRatio'] != null) {
        settings['fx_default_hold_ratio'] = fx['defaultHoldRatio'].toString();
      }
      if (fx['defaultCashbackRate'] != null) {
        settings['fx_default_cashback_rate'] =
            fx['defaultCashbackRate'].toString();
      }
    }
    if (map['oplogs'] is List) {
      syncOplog = (map['oplogs'] as List<dynamic>)
          .whereType<Map<dynamic, dynamic>>()
          .map((e) {
            final row = Map<String, dynamic>.from(e);
            final payloadVal = row['payload_json'];
            if (payloadVal is Map || payloadVal is List) {
              row['payload_json'] = jsonEncode(payloadVal);
            } else {
              row['payload_json'] = _asStr(payloadVal, '{}');
            }
            row['hlc'] = _asStr(row['hlc'] ?? row['hlc_ts']);
            row['node_id'] = _asStr(row['node_id'], hlc.nodeId);
            row['entity_type'] = _asStr(row['entity_type']);
            row['entity_id'] = _asStr(row['entity_id']);
            row['op_type'] = _asStr(row['op_type'], 'UPSERT');
            row['created_at'] = _asStr(row['created_at'], _nowIso());
            return row;
          })
          .where(
            (op) =>
                op['entity_type'] != 'ACCOUNT' &&
                op['entity_type'] != 'FIXED_ASSET',
          )
          .toList();
    }
    if (map['transactions'] is! List && syncOplog.isNotEmpty) {
      transactions = <Map<String, dynamic>>[];
      for (final op in syncOplog) {
        if (op['entity_type'] == 'TRANSACTION') {
          try {
            _applyAcceptedOp(op);
          } catch (_) {}
        }
      }
    }
    _recomputeSeqWatermarks();
    saveToDisk();
    return <String, int>{
      'transactionsCount': transactions
          .where((t) => (t['header'] as Map<String, dynamic>)['is_deleted'] != true)
          .length,
      'poolsCount': budgetPools.length,
      'vouchersCount': vouchers.length,
    };
  }

  Map<String, int> importBackupJson(String rawJson) {
    final cleaned = rawJson.replaceFirst(RegExp(r'^\uFEFF+'), '').trim();
    if (cleaned.isEmpty) {
      throw const FormatException('所选文件为空，请重新选择 GeekLedger 备份文件');
    }
    final decoded = jsonDecode(cleaned);
    if (decoded is! Map) {
      throw const FormatException('JSON 备份必须是对象格式');
    }
    final map = Map<String, dynamic>.from(decoded);
    final payload = map['bundle'] is Map
        ? Map<String, dynamic>.from(map['bundle'] as Map<dynamic, dynamic>)
        : map;
    final hasCoreArray = payload['transactions'] is List ||
        payload['budgetPools'] is List ||
        payload['vouchers'] is List ||
        payload['monthlyBudgets'] is List ||
        payload['projectTags'] is List ||
        payload['recurringRules'] is List ||
        payload['oplogs'] is List;
    if (!hasCoreArray) {
      throw const FormatException('所选 JSON 文件不是有效的 GeekLedger 账本备份');
    }

    final prevSuppress = _suppressPersist;
    _suppressPersist = true;
    late final Map<String, int> summary;
    try {
      resetToCleanState();
      summary = importFullSyncBundle(payload);
      syncedOplogCount = 0;
      lastSyncAt = null;
      lastSyncError = null;
    } finally {
      _suppressPersist = prevSuppress;
    }
    saveToDisk();
    return summary;
  }
}
