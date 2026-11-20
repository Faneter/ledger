part of '../ledger_engine.dart';

mixin _LedgerEngineBudgetsMixin on _LedgerEngineBase {
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
    _appendOpLog(
      'BUDGET_POOL',
      poolId,
      'DELETE',
      <String, dynamic>{'id': poolId},
    );
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
    recomputeSubsequentRolloversFrom(yearMonth);
  }

  static String _nextYearMonthStr(String ym) {
    final parts = ym.split('-');
    if (parts.length != 2) return ym;
    var y = int.tryParse(parts[0]) ?? 2026;
    var m = int.tryParse(parts[1]) ?? 1;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    return '${y.toString().padLeft(4, '0')}-${m.toString().padLeft(2, '0')}';
  }

  static int _monthsBetween(String fromYm, String toYm) {
    final fp = fromYm.split('-');
    final tp = toYm.split('-');
    if (fp.length != 2 || tp.length != 2) return 0;
    final fy = int.tryParse(fp[0]);
    final fm = int.tryParse(fp[1]);
    final ty = int.tryParse(tp[0]);
    final tm = int.tryParse(tp[1]);
    if (fy == null || fm == null || ty == null || tm == null) return 0;
    return (ty - fy) * 12 + (tm - fm);
  }

  /// Automatically performs sequential month-end balance rollover up to [targetYearMonth]
  /// whenever earlier monthly budgets exist and intermediate months lack rolled-over entries.
  bool ensureAutoRolloverForMonth(String targetYearMonth) {
    if (budgetPools.isEmpty || monthlyBudgets.isEmpty) return false;
    final priorMonths = monthlyBudgets
        .map((b) => b['year_month'] as String?)
        .whereType<String>()
        .where((ym) => ym.compareTo(targetYearMonth) < 0)
        .toSet()
        .toList()
      ..sort();
    if (priorMonths.isEmpty) return false;

    final latestPrior = priorMonths.last;
    final gap = _monthsBetween(latestPrior, targetYearMonth);
    if (gap <= 0 || gap > 24) return false;

    var cur = latestPrior;
    var changed = false;
    while (cur.compareTo(targetYearMonth) < 0) {
      final next = _nextYearMonthStr(cur);
      final hasAnyInNext =
          monthlyBudgets.any((b) => b['year_month'] == next);
      if (!hasAnyInNext) {
        executeMonthRollover(cur, next);
        changed = true;
      }
      cur = next;
    }
    return changed;
  }

  /// Refreshes `rollover_from_prev` across contiguous existing later months whenever an
  /// earlier month's budget allocation or transactions are modified.
  @override
  void recomputeSubsequentRolloversFrom(String sourceYearMonth) {
    if (budgetPools.isEmpty || monthlyBudgets.isEmpty) return;
    var cur = sourceYearMonth;
    for (var step = 0; step < 24; step++) {
      final next = _nextYearMonthStr(cur);
      final hasNext = monthlyBudgets.any((b) => b['year_month'] == next);
      if (!hasNext) break;
      final hasCur = monthlyBudgets.any((b) => b['year_month'] == cur);
      if (!hasCur) break;
      executeMonthRollover(cur, next);
      cur = next;
    }
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
        if (targetRow['rollover_from_prev'] == rollover) {
          continue;
        }
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

  List<Map<String, dynamic>> getMonthlyBudgetStatus(String yearMonth) {
    if (_cachedMonthlyVersion == _stateVersion) {
      final cached = _monthlyStatusCache[yearMonth];
      if (cached != null) {
        return _cloneListOfMaps(cached);
      }
    } else {
      _monthlyStatusCache.clear();
      _cachedMonthlyVersion = _stateVersion;
    }

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
            spentGrossCents +=
                _FixedMath.toCents(_bridge, it['item_gross'] as Object);
            savedDiscCents +=
                _FixedMath.toCents(_bridge, it['allocated_discount'] as Object);
            spentNetCents +=
                _FixedMath.toCents(_bridge, it['item_net'] as Object);
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
    _monthlyStatusCache[yearMonth] = rows;
    return _cloneListOfMaps(rows);
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
        .where(
          (tx) => (tx['header'] as Map<String, dynamic>)['is_deleted'] != true,
        )
        .toList();
    active.sort((a, b) {
      final ah = a['header'] as Map<String, dynamic>;
      final bh = b['header'] as Map<String, dynamic>;
      final cmpDate =
          (bh['tx_date'] as String).compareTo(ah['tx_date'] as String);
      if (cmpDate != 0) return cmpDate;
      return (bh['created_at'] as String).compareTo(ah['created_at'] as String);
    });
    return active.take(limit).map(_cloneMap).toList();
  }

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
}
