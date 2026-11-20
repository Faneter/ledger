part of '../ledger_engine.dart';

mixin _LedgerEngineRulesProjectsMixin
    on _LedgerEngineBase, _LedgerEngineDslTransactionsMixin {
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
    scheduleSave();
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
        startDate != null && startDate.trim().isNotEmpty
            ? startDate.trim()
            : null;
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

    final newId = id ?? 'TAG_${DateTime.now().millisecondsSinceEpoch}';
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

  void updateAppearanceSettings({
    String? themeMode,
    bool? useMonetColor,
  }) {
    if (themeMode == 'system' || themeMode == 'light' || themeMode == 'dark') {
      settings['theme_mode'] = themeMode!;
    }
    if (useMonetColor != null) {
      settings['use_monet_color'] = useMonetColor ? 'true' : 'false';
    }
    scheduleSave();
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
    scheduleSave();
  }
}
