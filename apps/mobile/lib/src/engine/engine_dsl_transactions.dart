part of '../ledger_engine.dart';

mixin _LedgerEngineDslTransactionsMixin on _LedgerEngineBase {
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
    var voucherSavings = '0.00';
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
    if (effectiveDate.length >= 7) {
      recomputeSubsequentRolloversFrom(effectiveDate.substring(0, 7));
    }
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
        final cashPaid =
            afterDisc > faceCents ? afterDisc - faceCents : BigInt.zero;
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
    if (effectiveDate.length >= 7) {
      recomputeSubsequentRolloversFrom(effectiveDate.substring(0, 7));
    }
    return _cloneMap(agg);
  }
}
