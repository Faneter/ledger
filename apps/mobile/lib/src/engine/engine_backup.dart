part of '../ledger_engine.dart';

mixin _LedgerEngineBackupMixin on _LedgerEngineBase {
  @override
  Map<String, dynamic> exportFullSyncBundle() {
    return <String, dynamic>{
      'nodeId': hlc.nodeId,
      'exportedAt': _nowIso(),
      'budgetPools': _cloneListOfMaps(budgetPools),
      'monthlyBudgets': _cloneListOfMaps(monthlyBudgets),
      'categories': _cloneListOfMaps(categories),
      'projectTags': _cloneListOfMaps(projectTags),
      'recurringRules': _cloneListOfMaps(recurringRules),
      'transactions': _cloneListOfMaps(transactions),
      'settings': Map<String, String>.from(settings),
      'oplogs': _cloneListOfMaps(syncOplog),
    };
  }

  String exportBackupJson() =>
      const JsonEncoder.withIndent('  ').convert(exportFullSyncBundle());

  @override
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
            row['pool_type'] = rawType == 'CAPITAL_ASSET' ? 'FLEX' : rawType;
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
            (b) => b['pool_id'] != 'POOL_FUND' && b['pool_id'] != 'POOL_ASSET',
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
            rawHeader.remove('applied_voucher_id');
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
          .where((tx) {
            final t = (tx['header'] as Map<String, dynamic>)['tx_type'];
            return t == 'EXPENSE' || t == 'INCOME';
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
                op['entity_type'] != 'FIXED_ASSET' &&
                op['entity_type'] != 'VOUCHER',
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
    if (!_suppressPersist) {
      notifyListeners();
    }
    return <String, int>{
      'transactionsCount': transactions
          .where(
            (t) => (t['header'] as Map<String, dynamic>)['is_deleted'] != true,
          )
          .length,
      'poolsCount': budgetPools.length,
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
    notifyListeners();
    return summary;
  }
}
