part of '../ledger_engine.dart';

mixin _LedgerEngineVouchersMixin on _LedgerEngineBase {
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
}
