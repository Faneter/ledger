part of '../ledger_engine.dart';

mixin _LedgerEngineTxMutationsMixin on _LedgerEngineBase {
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
      foreignAmount:
          (h['original_amount'] as String?) ?? h['total_gross'] as String,
      holdAmountCny:
          (h['hold_amount_cny'] as String?) ?? h['total_gross'] as String,
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
      final newGrossCents =
          _FixedMath.toCents(_bridge, h['total_gross'] as Object);
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
    final txDateStr = h['tx_date'] as String?;
    if (txDateStr != null && txDateStr.length >= 7) {
      recomputeSubsequentRolloversFrom(txDateStr.substring(0, 7));
    }
    return _cloneMap(tx);
  }

  /// Alias matching Web `LocalLedgerEngine.settleMastercardPending`.
  Map<String, dynamic> settleMastercardPending(
    String txId,
    String actualCny, [
    String? settledAt,
  ]) =>
      settleMastercardTransaction(txId, actualCny, settledAt: settledAt);

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
      final grossCents =
          _FixedMath.toCents(_bridge, h['total_gross'] as Object);
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
          if (u['index'] == 0 ||
              (u['id'] != null && u['id'] == primary['id'])) {
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
        final newGrossCents =
            _FixedMath.toCents(_bridge, h['total_gross'] as Object);
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
              .map(
                (it) => _FixedMath.toCents(_bridge, it['item_gross'] as Object),
              )
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
    final txDateStr = h['tx_date'] as String?;
    if (txDateStr != null && txDateStr.length >= 7) {
      recomputeSubsequentRolloversFrom(txDateStr.substring(0, 7));
    }
    return _cloneMap(tx);
  }

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
    final txDateStr = h['tx_date'] as String?;
    if (txDateStr != null && txDateStr.length >= 7) {
      recomputeSubsequentRolloversFrom(txDateStr.substring(0, 7));
    }
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
    final txDateStr = h['tx_date'] as String?;
    if (txDateStr != null && txDateStr.length >= 7) {
      recomputeSubsequentRolloversFrom(txDateStr.substring(0, 7));
    }
    return _cloneMap(tx);
  }
}
