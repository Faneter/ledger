import React, { useState, useEffect, useMemo } from 'react';
import { LocalLedgerEngine } from './sync/local-replica';
import { QuickInputBar } from './components/QuickInputBar';
import { BudgetPoolsDashboard } from './components/BudgetPoolsDashboard';
import { AccountMatrixPanel } from './components/AccountMatrixPanel';
import { AssetAndProjectTracker } from './components/AssetAndProjectTracker';
import { SyncAndConflictModal } from './components/SyncAndConflictModal';
import { TransactionAggregate } from '@ledger/core';

export const App: React.FC = () => {
  // 单例本地账本引擎
  const engine = useMemo(() => new LocalLedgerEngine(), []);
  const [, setTick] = useState(0);
  const [showSyncModal, setShowSyncModal] = useState(false);

  // 监听本地账本任何变动，驱动整树响应式刷新
  useEffect(() => {
    const unsubscribe = engine.subscribe(() => {
      setTick((t) => t + 1);
    });
    return unsubscribe;
  }, [engine]);

  const transactions: TransactionAggregate[] = engine.state.transactions.filter(
    (tx) => !tx.header.is_deleted
  );

  const pendingCount = engine.state.pendingSyncOps.length;
  const isOffline = engine.state.isOfflineMode;

  const handleResetSeed = () => {
    if (confirm('确定要将本地数据重置回 PRD 初始种子快照吗？')) {
      engine.resetToSeed();
    }
  };

  return (
    <div className="geek-ledger-workbench">
      {/* 顶部极客风状态导航栏 */}
      <header className="app-navbar">
        <div className="navbar-container flex-row items-center justify-between">
          <div className="flex-row items-center gap-sm">
            <span className="app-logo">⚡</span>
            <div>
              <div className="flex-row items-center gap-xs">
                <h1 className="app-title font-bold text-light">GeekLedger</h1>
                <span className="badge badge-accent">Stage 6</span>
                <span className="badge badge-outline">Local-First</span>
              </div>
              <p className="app-subtitle text-xs text-muted">
                极客大学生分布式个人记账与预算系统 · 纯前端本地优先离线工作台
              </p>
            </div>
          </div>

          <div className="navbar-right-actions flex-row items-center gap-sm">
            {/* 在线/离线网络状态药丸 */}
            <button
              type="button"
              className={`status-pill ${
                isOffline ? 'status-pill-offline' : 'status-pill-online'
              }`}
              onClick={() => engine.setOfflineMode(!isOffline)}
              title="点击可一键切换在线与离线无网模式"
            >
              <span className="status-dot" />
              <span>{isOffline ? '离线无网模式' : '在线同步中'}</span>
            </button>

            {/* 待同步队列标记 */}
            {pendingCount > 0 && (
              <span className="badge badge-warning" title="等待同步到服务端的 OpLog 数量">
                待同步: {pendingCount}
              </span>
            )}

            {/* 同步演练中心呼出按钮 */}
            <button
              type="button"
              className="btn btn-sm btn-outline-cyan flex-row items-center gap-xs"
              onClick={() => setShowSyncModal(true)}
            >
              <span>🛡️</span>
              <span>分布式协同与防炸机中心</span>
              {engine.state.conflicts.filter((c) => c.status === 'PENDING').length > 0 && (
                <span className="badge badge-danger">
                  {engine.state.conflicts.filter((c) => c.status === 'PENDING').length}
                </span>
              )}
            </button>

            {/* 重置种子 */}
            <button
              type="button"
              className="btn btn-sm btn-muted"
              onClick={handleResetSeed}
              title="重置本地为纯净种子数据"
            >
              ↺ 重置种子
            </button>
          </div>
        </div>
      </header>

      {/* 主体工作台内容区域 */}
      <main className="main-content-layout container">
        {/* 1. 模块 5：极速自然语言与公式记账台 */}
        <section className="workbench-section">
          <QuickInputBar engine={engine} />
        </section>

        {/* 2. 模块 2：松紧结合二级预算池与动态日均看板 */}
        <section className="workbench-section">
          <BudgetPoolsDashboard engine={engine} />
        </section>

        {/* 3. 模块 1 & 4：四层账户矩阵、万事达外币清算与虚拟卡包 */}
        <section className="workbench-section">
          <AccountMatrixPanel engine={engine} />
        </section>

        {/* 4. 模块 2.2：跨期专项立项 & 大件固定资产日均成本追踪 */}
        <section className="workbench-section">
          <AssetAndProjectTracker engine={engine} />
        </section>

        {/* 5. 模块 1 实时账单流水历史流水列表 */}
        <section className="workbench-section card recent-transactions-card">
          <div className="card-header flex-row items-center justify-between">
            <div className="flex-row items-center gap-xs">
              <span className="badge badge-primary">账目流水</span>
              <h3 className="card-title">本地账本最近流水明细 ({transactions.length} 笔)</h3>
            </div>
            <span className="text-xs text-muted">
              完全由本地 OpLogs 与离线引擎实时计算
            </span>
          </div>

          {transactions.length === 0 ? (
            <div className="empty-state text-muted text-center py-md text-sm">
              暂无交易流水。在上方单行记账台输入 DSL 命令或点击快捷胶囊立即记账！
            </div>
          ) : (
            <div className="table-responsive mt-sm">
              <table className="table">
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>类型</th>
                    <th>原始输入 / 备注</th>
                    <th>扣款账户</th>
                    <th className="text-right">原价 (Gross)</th>
                    <th className="text-right">分摊优惠 (Discount)</th>
                    <th className="text-right">实付净额 (Net)</th>
                    <th>清算状态</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.slice(0, 10).map((tx) => {
                    const h = tx.header;
                    const isFx = h.original_currency !== 'CNY';
                    const isPending = h.settlement_status === 'PENDING_HOLD';
                    return (
                      <tr key={h.id}>
                        <td className="text-muted text-xs font-mono">{h.tx_date}</td>
                        <td>
                          <span
                            className={`badge ${
                              h.tx_type === 'EXPENSE'
                                ? 'badge-primary'
                                : h.tx_type === 'TRANSFER'
                                ? 'badge-purple'
                                : 'badge-success'
                            }`}
                          >
                            {h.tx_type}
                          </span>
                        </td>
                        <td>
                          <div className="font-medium text-light">
                            {h.merchant_or_note || h.raw_input_text}
                          </div>
                          {h.raw_input_text && h.raw_input_text !== h.merchant_or_note && (
                            <div className="text-muted text-xs font-mono">
                              {h.raw_input_text}
                            </div>
                          )}
                        </td>
                        <td className="text-xs text-secondary font-mono">
                          {h.account_id}
                          {h.target_account_id && ` ➜ ${h.target_account_id}`}
                        </td>
                        <td className="text-right text-muted font-mono">
                          ¥{h.total_gross}
                          {isFx && h.original_amount && (
                            <span className="text-xs ml-xs">
                              ({h.original_currency} {h.original_amount})
                            </span>
                          )}
                        </td>
                        <td className="text-right text-success font-mono">
                          -¥{h.payment_discount || h.platform_discount}
                        </td>
                        <td className="text-right font-bold text-light font-mono">
                          ¥{h.total_net}
                        </td>
                        <td>
                          {isPending ? (
                            <span className="badge badge-warning">
                              ⏳ 待清算 (冻结 ¥{h.hold_amount_cny})
                            </span>
                          ) : (
                            <span className="badge badge-outline">已锁定</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      {/* 分布式多端同步与防炸机演练中心弹窗 */}
      <SyncAndConflictModal
        engine={engine}
        isOpen={showSyncModal}
        onClose={() => setShowSyncModal(false)}
      />

      {/* 极客底栏 */}
      <footer className="app-footer text-center py-md text-xs text-muted">
        <p>
          GeekLedger · 极客大学生分布式个人记账与预算管理系统 · 纯前端离线优先
          (Stage 6)
        </p>
        <p className="mt-xxs text-dim">
          基于 Decimal.js 精确算术 · 混合逻辑时钟 HLC 因果定序 · 守恒定律双轨校验
        </p>
      </footer>
    </div>
  );
};
