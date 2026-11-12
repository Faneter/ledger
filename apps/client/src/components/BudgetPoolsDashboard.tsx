import React, { useState } from 'react';
import { LocalLedgerEngine, DailyBudgetSummary } from '../sync/local-replica';
import { MonthlyBudgetStatusRow } from '@ledger/core';

interface BudgetPoolsDashboardProps {
  engine: LocalLedgerEngine;
  currentYearMonth?: string;
  currentDate?: string;
  onRefresh?: () => void;
}

export const BudgetPoolsDashboard: React.FC<BudgetPoolsDashboardProps> = ({
  engine,
  currentYearMonth = '2026-11',
  currentDate = '2026-11-12',
  onRefresh,
}) => {
  const [sweepToast, setSweepToast] = useState<string | null>(null);

  const budgetStatuses: MonthlyBudgetStatusRow[] =
    engine.getMonthlyBudgetStatus(currentYearMonth);

  const dailySummary: DailyBudgetSummary = engine.getDailyBudgetSummary(
    currentYearMonth,
    currentDate
  );

  // 计算常规月度 4 大池的整体预算总水位
  const regularPools = budgetStatuses.filter((b) =>
    ['POOL_FIXED', 'POOL_DAILY', 'POOL_FLEX', 'POOL_EMERGENCY'].includes(b.pool_id)
  );

  const totalMonthlyBudget = regularPools.reduce(
    (acc, cur) => acc + Number(cur.total_available_budget),
    0
  );
  const totalMonthlySpent = regularPools.reduce(
    (acc, cur) => acc + Number(cur.spent_net),
    0
  );
  const totalMonthlyRemaining = regularPools.reduce(
    (acc, cur) => acc + Number(cur.remaining_budget),
    0
  );
  const overallUsagePercent =
    totalMonthlyBudget > 0
      ? Math.min(100, Math.round((totalMonthlySpent / totalMonthlyBudget) * 100))
      : 0;

  const handleSweepDaily = () => {
    try {
      const res = engine.sweepDailyToFund(currentYearMonth);
      setSweepToast(
        `✨ 划转成功！高频饮食池结余 ¥${res.sweptAmount} 已全额划入【年度专项考证基金池】`
      );
      setTimeout(() => setSweepToast(null), 4000);
      onRefresh?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const getRolloverBadge = (poolId: string) => {
    const p = engine.state.budgetPools.find((it) => it.id === poolId);
    if (!p) return null;
    switch (p.rollover_strategy) {
      case 'SWEEP_TO_FUND':
        return <span className="badge badge-cyan">结余划转 (SWEEP)</span>;
      case 'RESET':
        return <span className="badge badge-muted">月末清零 (RESET)</span>;
      case 'ACCUMULATE':
        return <span className="badge badge-purple">全额滚存 (ACCUMULATE)</span>;
      default:
        return null;
    }
  };

  return (
    <div className="budget-dashboard-section">
      {/* 顶部核心看板大卡片 */}
      <div className="card hero-budget-card">
        <div className="hero-budget-grid">
          {/* 左侧：今日剩余日均可用额度（高频池动态管控引擎） */}
          <div className="hero-main-stat">
            <div className="text-muted text-xs uppercase tracking-wider mb-xs flex-row items-center gap-xs">
              <span className="badge badge-primary">动态日均管控</span>
              <span>高频生活池今日剩余日均可用</span>
            </div>
            <div className="hero-amount-row flex-row items-baseline gap-sm">
              <span className="hero-currency">¥</span>
              <span className="hero-amount">{dailySummary.dailyAvailableAmount}</span>
              <span className="hero-unit">/ 天</span>
            </div>
            <div className="text-secondary text-xs mt-xs">
              计算公式: <span className="code-font">{dailySummary.formula}</span>
            </div>
          </div>

          {/* 右侧：关键指标概览 */}
          <div className="hero-sub-stats-grid">
            <div className="hero-stat-box">
              <div className="text-muted text-xs">本月累计薅羊毛省钱</div>
              <div className="hero-stat-value text-success font-bold mt-xs">
                +¥{dailySummary.totalSavedWool}
              </div>
              <div className="text-muted text-xs mt-xs">立减金/满减等比分摊</div>
            </div>

            <div className="hero-stat-box">
              <div className="text-muted text-xs">月度常规总预算水位</div>
              <div className="hero-stat-value text-light font-bold mt-xs">
                ¥{totalMonthlyRemaining.toFixed(2)}
                <span className="text-muted text-xs"> / ¥{totalMonthlyBudget.toFixed(2)}</span>
              </div>
              <div className="progress-bar-container mt-xs">
                <div
                  className="progress-bar"
                  style={{ width: `${overallUsagePercent}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {sweepToast && <div className="alert alert-success mt-md">{sweepToast}</div>}

      {/* 六大预算池卡片网格 */}
      <div className="budget-pools-grid mt-md">
        {budgetStatuses.map((pool) => {
          const totalAvail = Number(pool.total_available_budget);
          const spent = Number(pool.spent_net);
          const remaining = Number(pool.remaining_budget);
          const percent =
            totalAvail > 0
              ? Math.min(100, Math.round((spent / totalAvail) * 100))
              : 0;

          const isDailyPool = pool.pool_id === 'POOL_DAILY';
          const isFundPool = pool.pool_id === 'POOL_FUND';
          const isOverspent = remaining < 0;

          return (
            <div
              key={pool.pool_id}
              className={`card pool-card ${isDailyPool ? 'border-primary' : ''}`}
            >
              <div className="pool-card-header flex-row items-center justify-between">
                <div>
                  <h3 className="pool-title">{pool.pool_name}</h3>
                  <div className="text-muted text-xs mt-xs">
                    基准: ¥{pool.base_allocation}
                    {Number(pool.rollover_from_prev) !== 0 && (
                      <span> · 滚入: ¥{pool.rollover_from_prev}</span>
                    )}
                  </div>
                </div>
                {getRolloverBadge(pool.pool_id)}
              </div>

              <div className="pool-balance-row flex-row items-baseline justify-between mt-sm">
                <div>
                  <span className="text-xs text-muted">可用结余: </span>
                  <span
                    className={`font-bold text-lg ${
                      isOverspent ? 'text-danger' : 'text-light'
                    }`}
                  >
                    ¥{pool.remaining_budget}
                  </span>
                </div>
                <div className="text-xs text-muted text-right">
                  已用: <strong className="text-light">¥{pool.spent_net}</strong>
                  {Number(pool.total_saved_discount) > 0 && (
                    <span className="text-success ml-xs">
                      (省 ¥{pool.total_saved_discount})
                    </span>
                  )}
                </div>
              </div>

              <div className="progress-bar-container mt-sm">
                <div
                  className={`progress-bar ${
                    isOverspent ? 'bg-danger' : isDailyPool ? 'bg-cyan' : ''
                  }`}
                  style={{ width: `${percent}%` }}
                />
              </div>

              <div className="flex-row items-center justify-between text-xs text-muted mt-xs">
                <span>使用进度: {percent}%</span>
                <span>总额度: ¥{pool.total_available_budget}</span>
              </div>

              {/* 高频饮食池专属划转按钮 */}
              {isDailyPool && (
                <div className="pool-action-row mt-md">
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-cyan w-full"
                    onClick={handleSweepDaily}
                  >
                    ✨ 月末正结余划入考证专项基金 (SWEEP)
                  </button>
                </div>
              )}

              {/* 考证专项池专属标识 */}
              {isFundPool && (
                <div className="pool-badge-desc mt-sm text-xs text-purple">
                  🎯 接收高频池结余划转，专款专用支持考证与差旅
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
