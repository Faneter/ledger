import 'dart:convert';
import 'dart:math' as math;

import 'rust_bridge.dart';

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
  })  : _bridge = bridge ?? RustCoreBridge.instance(),
        hlc = HybridLogicalClock(
          nodeId: nodeId,
          bridge: bridge ?? RustCoreBridge.instance(),
        ) {
    resetToDefaultSeed();
  }

  final RustCoreBridge _bridge;
  final HybridLogicalClock hlc;

  List<Map<String, dynamic>> budgetPools = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> monthlyBudgets = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> categories = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> projectTags = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> transactions = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> vouchers = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> recurringRules = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> fixedAssets = <Map<String, dynamic>>[];
  Map<String, String> settings = <String, String>{};
  List<Map<String, dynamic>> syncOplog = <Map<String, dynamic>>[];

  int _txSeq = 0;
  int _itemSeq = 0;
  int _voucherSeq = 2;
  int _assetSeq = 2;
  int _monthlyBudgetSeq = 4;

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
      'linked_pool_id': 'POOL_FLEX',
      'is_active': true,
    },
    <String, dynamic>{
      'id': 'TAG_MCU_LAB',
      'name': '单片机硬件实验',
      'tag_type': 'SCENE',
      'target_budget': null,
      'linked_pool_id': 'POOL_FLEX',
      'is_active': true,
    },
    <String, dynamic>{
      'id': 'TAG_STOCK_EAT',
      'name': '靠存货/刷饭卡度日',
      'tag_type': 'STOCK_CONSUME',
      'target_budget': null,
      'linked_pool_id': 'POOL_DAILY',
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

  static const List<Map<String, dynamic>> _seedFixedAssets =
      <Map<String, dynamic>>[
    <String, dynamic>{
      'id': 1,
      'asset_name': '二手 iPhone 13 mini',
      'purchase_item_id': null,
      'purchase_date': '2026-09-01',
      'purchase_net_cost': '1150.00',
      'target_daily_cost': '2.00',
      'status': 'IN_USE',
      'resale_date': null,
      'resale_recovery': '0.00',
      'note': '购于 2026-09-01，目标日均 2 元',
    },
    <String, dynamic>{
      'id': 2,
      'asset_name': '希捷3T监控级硬盘+硬盘盒',
      'purchase_item_id': null,
      'purchase_date': '2026-10-01',
      'purchase_net_cost': '409.80',
      'target_daily_cost': '1.00',
      'status': 'IN_USE',
      'resale_date': null,
      'resale_recovery': '0.00',
      'note': '购于 2026-10-01，目标日均 1 元',
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
    fixedAssets = _cloneListOfMaps(_seedFixedAssets);
    recurringRules = _cloneListOfMaps(_seedRecurringRules);
    transactions = <Map<String, dynamic>>[];
    syncOplog = <Map<String, dynamic>>[];
    settings = <String, String>{
      'fx_default_cashback_rate': '0.0100',
      'fx_default_hold_ratio': '1.020',
    };
    _txSeq = 0;
    _itemSeq = 0;
    _voucherSeq = 2;
    _assetSeq = 2;
    _monthlyBudgetSeq = 4;
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

  Map<String, dynamic> recordFromDsl(
    String rawText, {
    String? txDate,
    int? appliedVoucherId,
  }) {
    final parsed = _bridge.parseQuickInputDsl(
      rawText,
      categories: categories,
      projectTags: projectTags,
      budgetPools: budgetPools,
      fxConfig: _getFxConfig(),
    );

    final effectiveDate =
        (txDate != null && txDate.isNotEmpty) ? txDate : getLocalTodayDateStr();
    final txType = parsed['tx_type'] as String;
    var totalGross = parsed['total_gross'] as String;
    var paymentDiscount = parsed['payment_discount'] as String;
    var platformDiscount = parsed['platform_discount'] as String;
    var totalNet = parsed['total_net'] as String;
    final parsedItems = (parsed['items'] as List<dynamic>)
        .map((e) => Map<String, dynamic>.from(e as Map<dynamic, dynamic>))
        .toList();

    Map<String, dynamic>? voucherToUse;
    if (appliedVoucherId != null) {
      final idx = vouchers.indexWhere((v) => v['id'] == appliedVoucherId);
      if (idx == -1) {
        throw ArgumentError('优惠券 "$appliedVoucherId" 不存在');
      }
      final v = vouchers[idx];
      if (v['status'] != 'AVAILABLE') {
        throw StateError('优惠券「${v['title']}」已被使用或已失效');
      }
      if (txType == 'INCOME') {
        throw StateError('收入交易不可使用优惠券');
      }
      final grossCents = _FixedMath.toCents(_bridge, totalGross);
      final minSpendCents = _FixedMath.toCents(_bridge, v['min_spend'] as Object);
      if (grossCents < minSpendCents) {
        throw StateError(
          '未达到优惠券「${v['title']}」的最低使用门槛（需满 ¥${v['min_spend']}，当前金额 ¥$totalGross）',
        );
      }

      if (txType == 'EXPENSE') {
        final netCents = _FixedMath.toCents(_bridge, totalNet);
        final faceCents = _FixedMath.toCents(_bridge, v['face_value'] as Object);
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

        final alloc = _bridge.computeOrderAllocation(
          items: splitInputs,
          cashActuallyPaid: cashPaid,
          mode: (parsed['allocation_mode'] as String?) ?? 'SINGLE',
          voucher: <String, dynamic>{
            'face_value': v['face_value'],
            'acquire_cost': v['acquire_cost'],
            'voucher_type': v['voucher_type'],
          },
        );

        totalGross = alloc['total_gross'] as String;
        paymentDiscount = alloc['total_discount'] as String;
        platformDiscount = '0.00';
        totalNet = alloc['total_net'] as String;

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
    final resolvedCategory =
        categoryId ?? (categories.isNotEmpty ? categories.first['id'] as String : 'CAT_FOOD');
    final catMatch = categories.where((c) => c['id'] == resolvedCategory).toList();
    final resolvedPool = budgetPoolId ??
        (catMatch.isNotEmpty
            ? (catMatch.first['default_pool_id'] as String?) ?? 'POOL_DAILY'
            : 'POOL_DAILY');

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
    final defaultCat =
        ruleType == 'FX_SUBSCRIPTION' ? 'CAT_DIGITAL_SUB' : 'CAT_TELECOM';
    final defaultPool =
        ruleType == 'FX_SUBSCRIPTION' ? 'POOL_FLEX' : 'POOL_FIXED';
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
          : '高频饮食与洗护池 (POOL_DAILY)',
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
  // Fixed Assets & Daily Holding Cost
  // --------------------------------------------------------------------------

  Map<String, dynamic> upsertFixedAsset({
    int? id,
    required String assetName,
    required String purchaseDate,
    required String purchaseNetCost,
    String targetDailyCost = '1.00',
    String status = 'IN_USE',
    String? resaleDate,
    String resaleRecovery = '0.00',
    String? note,
  }) {
    if (id != null) {
      final idx = fixedAssets.indexWhere((a) => a['id'] == id);
      if (idx == -1) throw ArgumentError('FixedAsset "$id" not found');
      final a = fixedAssets[idx];
      a['asset_name'] = assetName;
      a['purchase_date'] = purchaseDate;
      a['purchase_net_cost'] = _bridge.formatCny(purchaseNetCost);
      a['target_daily_cost'] = _bridge.formatCny(targetDailyCost);
      a['status'] = status;
      a['resale_date'] = resaleDate;
      a['resale_recovery'] = _bridge.formatCny(resaleRecovery);
      a['note'] = note;
      _appendOpLog('FIXED_ASSET', '$id', 'UPSERT', a);
      return _cloneMap(a);
    }
    _assetSeq += 1;
    final asset = <String, dynamic>{
      'id': _assetSeq,
      'asset_name': assetName,
      'purchase_item_id': null,
      'purchase_date': purchaseDate,
      'purchase_net_cost': _bridge.formatCny(purchaseNetCost),
      'target_daily_cost': _bridge.formatCny(targetDailyCost),
      'status': status,
      'resale_date': resaleDate,
      'resale_recovery': _bridge.formatCny(resaleRecovery),
      'note': note,
    };
    fixedAssets.add(asset);
    _appendOpLog('FIXED_ASSET', '${asset['id']}', 'UPSERT', asset);
    return _cloneMap(asset);
  }

  Map<String, dynamic> recordAssetResale(int assetId, String resaleRecovery) {
    final idx = fixedAssets.indexWhere((a) => a['id'] == assetId);
    if (idx == -1) throw ArgumentError('FixedAsset "$assetId" not found');
    final a = fixedAssets[idx];
    a['status'] = 'SOLD';
    a['resale_date'] = getLocalTodayDateStr();
    a['resale_recovery'] = _bridge.formatCny(resaleRecovery);
    _appendOpLog('FIXED_ASSET', '$assetId', 'UPSERT', a);
    return _cloneMap(a);
  }

  List<Map<String, dynamic>> getFixedAssetsWithCost([String? currentDateStr]) {
    final todayStr = currentDateStr ?? getLocalTodayDateStr();
    final todayUtc = DateTime.parse('${todayStr}T00:00:00Z');
    return fixedAssets.map((a) {
      final buyUtc = DateTime.parse('${a['purchase_date']}T00:00:00Z');
      var endUtc = todayUtc;
      if (a['status'] == 'SOLD' && a['resale_date'] != null) {
        final resaleUtc = DateTime.parse('${a['resale_date']}T00:00:00Z');
        if (resaleUtc.isBefore(endUtc)) {
          endUtc = resaleUtc;
        }
      }
      final daysHeld = math.max(1, endUtc.difference(buyUtc).inDays);
      final netCostCents = _FixedMath.toCents(_bridge, a['purchase_net_cost'] as Object) -
          _FixedMath.toCents(_bridge, (a['resale_recovery'] as Object?) ?? '0.00');
      final dailyCostCents =
          _FixedMath.divRoundHalfUp(netCostCents, BigInt.from(daysHeld));
      final copy = _cloneMap(a);
      copy['days_held'] = daysHeld;
      copy['net_cost'] = _FixedMath.fromCents(netCostCents);
      copy['current_daily_cost'] = _FixedMath.fromCents(dailyCostCents);
      return copy;
    }).toList();
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
      default:
        break;
    }
  }
}
