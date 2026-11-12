import React, { useState } from 'react';
import { LocalLedgerEngine } from '../sync/local-replica';
import { SyncConflict } from '@ledger/core';

interface SyncAndConflictModalProps {
  engine: LocalLedgerEngine;
  isOpen: boolean;
  onClose: () => void;
  onRefresh?: () => void;
}

export const SyncAndConflictModal: React.FC<SyncAndConflictModalProps> = ({
  engine,
  isOpen,
  onClose,
  onRefresh,
}) => {
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncLogs, setSyncLogs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'status' | 'conflicts' | 'drill'>('status');

  if (!isOpen) return null;

  const conflicts: SyncConflict[] = engine.state.conflicts;
  const pendingConflicts = conflicts.filter((c) => c.status === 'PENDING');

  const addLog = (msg: string) => {
    setSyncLogs((prev) => [
      `[${new Date().toLocaleTimeString()}] ${msg}`,
      ...prev.slice(0, 50),
    ]);
  };

  // 1. 切换离线模式
  const handleToggleOffline = () => {
    const nextMode = !engine.state.isOfflineMode;
    engine.setOfflineMode(nextMode);
    addLog(`用户切换同步模式为：【${nextMode ? '离线无网模式 ✈️' : '在线同步模式 🌐'}】`);
    onRefresh?.();
  };

  // 2. 增量同步
  const handleSyncExchange = async () => {
    setSyncLoading(true);
    addLog('正在向服务端 POST /api/sync/exchange 发起增量操作同步...');
    try {
      const res = await engine.syncWithServer();
      if (res.serverResetDetected) {
        addLog('⚠️ 警告：检测到服务端 ServerEpochId 变更且数据库为空！触发防炸机保护！');
      } else if (res.success) {
        addLog(
          `✅ 增量同步完成！拉取远端变更 ${res.appliedRemoteCount} 条，检测冲突 ${res.conflictsDetected} 项`
        );
      } else {
        addLog(`❌ 同步失败: ${res.error}`);
      }
      onRefresh?.();
    } catch (err) {
      addLog(`❌ 同步异常: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSyncLoading(false);
    }
  };

  // 3. 模拟并发冲突
  const handleSimulateConflict = () => {
    try {
      const cf = engine.simulateConcurrentConflict();
      addLog(
        `⚡ 成功模拟多端离线并发冲突！已生成冲突记录 ID: ${cf.id} (${cf.conflict_type})`
      );
      setActiveTab('conflicts');
      onRefresh?.();
    } catch (err) {
      addLog(`❌ 模拟冲突失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // 冲突仲裁
  const handleResolveConflict = (
    conflictId: string,
    resolution: 'KEEP_WINNER' | 'USE_LOSER'
  ) => {
    try {
      engine.resolveConflict(conflictId, resolution);
      addLog(
        `🛡️ 冲突仲裁完成！采用决策: ${
          resolution === 'KEEP_WINNER' ? '保留胜出版本 (LWW)' : '采纳落败版本'
        }`
      );
      onRefresh?.();
    } catch (err) {
      addLog(`❌ 解决冲突失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // 4. 模拟服务器炸机与反向一键推流恢复
  const handleCrashAndRecover = async () => {
    setSyncLoading(true);
    addLog('💥 [演练步骤 1] 正在请求服务端调用 POST /api/sync/simulate-crash 模拟数据库彻底摧毁...');
    try {
      const res = await engine.simulateServerCrashAndRecover();
      addLog(
        `💥 服务端数据库已清空！[演练步骤 2] 立即将本机完整账本推流反向恢复服务端（已推送 ${res.restoredAccounts} 个账户，${res.restoredOpLogs} 条 OpLogs）！`
      );
      addLog('🎉 演练大获成功！服务器已从前端本机副本 100% 无损重建！');
      onRefresh?.();
    } catch (err) {
      addLog(`❌ 演练失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSyncLoading(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-box modal-lg sync-center-modal">
        <div className="modal-header flex-row items-center justify-between">
          <div className="flex-row items-center gap-sm">
            <span className="badge badge-primary">分布式同步中心</span>
            <h3 className="modal-title">HLC 混合逻辑时钟、多端协同与防炸机演练</h3>
          </div>
          <button type="button" className="btn-close" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* 服务器重置/炸机醒目提示栏 */}
        {engine.serverResetDetected && (
          <div className="alert alert-danger mt-sm flex-row items-center justify-between">
            <div>
              <strong>⚠️ 检测到服务端空库或已重启重置！</strong>
              <div className="text-xs">
                服务端 EpochId 已发生变更。是否立即从本机离线账本推流反向恢复服务端？
              </div>
            </div>
            <button
              type="button"
              className="btn btn-sm btn-light"
              onClick={handleCrashAndRecover}
            >
              一键从本机恢复服务端
            </button>
          </div>
        )}

        {/* 顶部状态与四大操作入口栏 */}
        <div className="sync-top-actions-bar flex-row items-center justify-between mt-sm">
          <div className="flex-row items-center gap-sm">
            <button
              type="button"
              className={`btn btn-sm ${
                engine.state.isOfflineMode ? 'btn-danger' : 'btn-success'
              }`}
              onClick={handleToggleOffline}
            >
              {engine.state.isOfflineMode ? '✈️ 离线无网模式' : '🌐 在线同步模式'}
            </button>

            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={syncLoading || engine.state.isOfflineMode}
              onClick={handleSyncExchange}
            >
              {syncLoading ? '同步中...' : '🔄 立即增量同步 (/api/sync/exchange)'}
            </button>
          </div>

          <div className="flex-row items-center gap-sm">
            <button
              type="button"
              className="btn btn-sm btn-outline-purple"
              onClick={handleSimulateConflict}
            >
              ⚡ 模拟多端离线并发冲突
            </button>

            <button
              type="button"
              className="btn btn-sm btn-outline-danger"
              disabled={syncLoading}
              onClick={handleCrashAndRecover}
            >
              🛡️ 模拟服务器删库 & 反向推流恢复
            </button>
          </div>
        </div>

        {/* Tab 导航 */}
        <div className="tabs-nav mt-md flex-row gap-xs border-b-dim">
          <button
            type="button"
            className={`tab-btn ${activeTab === 'status' ? 'tab-active' : ''}`}
            onClick={() => setActiveTab('status')}
          >
            📊 节点与时钟状态
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === 'conflicts' ? 'tab-active' : ''}`}
            onClick={() => setActiveTab('conflicts')}
          >
            ⚖️ 冲突解决中心 ({pendingConflicts.length})
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === 'drill' ? 'tab-active' : ''}`}
            onClick={() => setActiveTab('drill')}
          >
            📝 实时交互与同步日志
          </button>
        </div>

        {/* Tab 1: 节点与时钟状态 */}
        {activeTab === 'status' && (
          <div className="tab-content mt-sm">
            <div className="grid-2-col gap-sm">
              <div className="info-stat-card">
                <div className="text-muted text-xs">本机客户端 Node ID</div>
                <div className="stat-code text-light font-mono mt-xs">
                  {engine.state.nodeId}
                </div>
              </div>

              <div className="info-stat-card">
                <div className="text-muted text-xs">当前混合逻辑时钟 (HLC)</div>
                <div className="stat-code text-accent font-mono mt-xs">
                  {engine.hlc.now()}
                </div>
              </div>

              <div className="info-stat-card">
                <div className="text-muted text-xs">本地操作日志总数 (OpLog)</div>
                <div className="stat-val font-bold text-light mt-xs">
                  {engine.state.oplogs.length} 条
                </div>
              </div>

              <div className="info-stat-card">
                <div className="text-muted text-xs">待推送同步队列 (Pending)</div>
                <div className="stat-val font-bold text-cyan mt-xs">
                  {engine.state.pendingSyncOps.length} 条
                </div>
              </div>

              <div className="info-stat-card">
                <div className="text-muted text-xs">服务端纪元标识 (Server Epoch)</div>
                <div className="stat-code text-muted font-mono mt-xs">
                  {engine.state.serverEpochId || '(尚未连接服务端)'}
                </div>
              </div>

              <div className="info-stat-card">
                <div className="text-muted text-xs">上次同步完成时间</div>
                <div className="stat-val text-xs text-light mt-xs">
                  {engine.state.lastSyncAt
                    ? new Date(engine.state.lastSyncAt).toLocaleString()
                    : '从未同步 (完全离线)'}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: 冲突解决中心 */}
        {activeTab === 'conflicts' && (
          <div className="tab-content mt-sm">
            {conflicts.length === 0 ? (
              <div className="empty-state text-muted text-center py-lg">
                暂无因果并发冲突。点击顶部「⚡ 模拟多端离线并发冲突」可立即生成并体验仲裁！
              </div>
            ) : (
              <div className="conflicts-list">
                {conflicts.map((cf) => {
                  const isPending = cf.status === 'PENDING';
                  return (
                    <div
                      key={cf.id}
                      className={`conflict-box ${
                        isPending ? 'border-purple' : 'opacity-75'
                      }`}
                    >
                      <div className="flex-row items-center justify-between">
                        <span className="badge badge-purple">
                          {cf.conflict_type}
                        </span>
                        <span
                          className={`badge ${
                            isPending ? 'badge-warning' : 'badge-muted'
                          }`}
                        >
                          {isPending ? '待仲裁' : '已解决'}
                        </span>
                      </div>

                      <div className="conflict-summaries-grid mt-sm">
                        <div className="summary-box winner-box">
                          <div className="text-xs text-success font-semibold">
                            🏆 胜出版本 (Winner - 字典序更高 HLC)
                          </div>
                          <div className="text-xs text-light mt-xs font-mono">
                            HLC: {cf.winner_hlc}
                          </div>
                          <div className="text-xs text-secondary mt-xs">
                            {cf.winner_summary}
                          </div>
                        </div>

                        <div className="summary-box loser-box">
                          <div className="text-xs text-danger font-semibold">
                            🛡️ 落败版本 (Loser - 字典序较低 HLC)
                          </div>
                          <div className="text-xs text-light mt-xs font-mono">
                            HLC: {cf.loser_hlc}
                          </div>
                          <div className="text-xs text-secondary mt-xs">
                            {cf.loser_summary}
                          </div>
                        </div>
                      </div>

                      {isPending && (
                        <div className="conflict-actions-row flex-row justify-end gap-sm mt-sm">
                          <button
                            type="button"
                            className="btn btn-xs btn-outline-success"
                            onClick={() =>
                              handleResolveConflict(cf.id, 'KEEP_WINNER')
                            }
                          >
                            ✓ 保留胜出版本 (Keep Winner)
                          </button>
                          <button
                            type="button"
                            className="btn btn-xs btn-outline-purple"
                            onClick={() =>
                              handleResolveConflict(cf.id, 'USE_LOSER')
                            }
                          >
                            ↺ 采纳落败版本 (Use Loser)
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Tab 3: 实时同步日志 */}
        {activeTab === 'drill' && (
          <div className="tab-content mt-sm">
            <div className="terminal-log-box font-mono text-xs">
              {syncLogs.length === 0 ? (
                <div className="text-muted">暂无操作日志输出...</div>
              ) : (
                syncLogs.map((log, idx) => (
                  <div key={idx} className="log-line">
                    {log}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        <div className="modal-actions flex-row justify-end mt-md">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            关闭面板
          </button>
        </div>
      </div>
    </div>
  );
};
