import React, { useState } from 'react';
import { LocalLedgerEngine } from '../sync/local-replica';
import { FixedAssetWithCost, getLocalTodayDateStr } from '@ledger/core';

interface AssetAndProjectTrackerProps {
  engine: LocalLedgerEngine;
  currentDate?: string;
  onRefresh?: () => void;
}

export const AssetAndProjectTracker: React.FC<AssetAndProjectTrackerProps> = ({
  engine,
  currentDate = getLocalTodayDateStr(),
  onRefresh,
}) => {
  const [resaleModalAsset, setResaleModalAsset] =
    useState<FixedAssetWithCost | null>(null);
  const [resaleAmount, setResaleAmount] = useState('800.00');

  const assets: FixedAssetWithCost[] = engine.getFixedAssetsWithCost(currentDate);

  // 跨期专项项目列表 (tag_type === 'PROJECT')
  const projectTags = engine.state.projectTags.filter(
    (t) => t.tag_type === 'PROJECT'
  );

  // 汇总每个专项的累计支出流水
  const getProjectSpent = (tagId: string) => {
    let spent = 0;
    const relatedTxs: Array<{
      date: string;
      item_name: string;
      net: string;
    }> = [];

    for (const tx of engine.state.transactions) {
      if (tx.header.is_deleted) continue;
      for (const it of tx.items) {
        if (it.project_tag_id === tagId) {
          spent += Number(it.item_net);
          relatedTxs.push({
            date: tx.header.tx_date,
            item_name: it.item_name,
            net: it.item_net,
          });
        }
      }
    }

    return { spent: spent.toFixed(2), relatedTxs };
  };

  const handleResaleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!resaleModalAsset) return;
    try {
      engine.recordAssetResale(resaleModalAsset.id, resaleAmount);
      setResaleModalAsset(null);
      onRefresh?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="asset-project-section">
      <div className="grid-2-col gap-md">
        {/* 左侧：跨期考证专项立项看板 */}
        <div className="card project-tracker-card">
          <div className="card-header flex-row items-center justify-between">
            <div className="flex-row items-center gap-xs">
              <span className="badge badge-purple">模块 2.2</span>
              <h3 className="card-title">跨期专项立项追踪 (Projects)</h3>
            </div>
            <span className="text-xs text-muted">跨月专项全周期支出追踪</span>
          </div>

          <div className="project-list mt-sm">
            {projectTags.map((proj) => {
              const { spent, relatedTxs } = getProjectSpent(proj.id);
              const targetBudget = proj.target_budget ? Number(proj.target_budget) : 0;
              const spentNum = Number(spent);
              const progress =
                targetBudget > 0
                  ? Math.min(100, Math.round((spentNum / targetBudget) * 100))
                  : 0;

              return (
                <div key={proj.id} className="project-item-box">
                  <div className="flex-row items-center justify-between">
                    <div>
                      <span className="project-name font-bold text-light">
                        #{proj.name}
                      </span>
                      <span className="badge badge-outline text-xs ml-xs">
                        关联池: {proj.linked_pool_id || 'POOL_FUND'}
                      </span>
                    </div>
                    <div className="text-right text-xs">
                      目标预算: <strong>¥{proj.target_budget}</strong>
                    </div>
                  </div>

                  <div className="flex-row items-baseline justify-between text-xs mt-sm">
                    <span className="text-muted">已支出累计: </span>
                    <span className="font-bold text-accent">¥{spent}</span>
                  </div>

                  <div className="progress-bar-container mt-xs">
                    <div
                      className="progress-bar bg-purple"
                      style={{ width: `${progress}%` }}
                    />
                  </div>

                  <div className="flex-row items-center justify-between text-xs text-muted mt-xs">
                    <span>预算执行率: {progress}%</span>
                    <span>
                      剩余额度: ¥{(targetBudget - spentNum).toFixed(2)}
                    </span>
                  </div>

                  {/* 关联流水列表 */}
                  {relatedTxs.length > 0 && (
                    <div className="project-tx-sublist mt-sm">
                      <div className="text-xs text-muted mb-xs">关联明细:</div>
                      {relatedTxs.map((t, idx) => (
                        <div
                          key={idx}
                          className="flex-row items-center justify-between text-xs py-xxs border-b-dim"
                        >
                          <span className="text-light">
                            {t.date} · {t.item_name}
                          </span>
                          <span className="text-secondary">¥{t.net}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 右侧：大件数码固定资产日均持有成本追踪 */}
        <div className="card fixed-asset-tracker-card">
          <div className="card-header flex-row items-center justify-between">
            <div className="flex-row items-center gap-xs">
              <span className="badge badge-cyan">数码固定资产</span>
              <h3 className="card-title">大件固定资产日均成本追踪</h3>
            </div>
            <span className="text-xs text-muted">折旧摊薄与二手回血对冲</span>
          </div>

          <div className="asset-list mt-sm">
            {assets.map((asset) => {
              const isSold = asset.status === 'SOLD';
              const resaleNum = Number(asset.resale_recovery);
              return (
                <div key={asset.id} className="asset-item-box">
                  <div className="flex-row items-center justify-between">
                    <div>
                      <span className="asset-name font-bold text-light">
                        {asset.asset_name}
                      </span>
                      {isSold && (
                        <span className="badge badge-success ml-xs">已转售回血</span>
                      )}
                    </div>
                    <span className="text-xs text-muted">
                      购置: {asset.purchase_date} (已持有 {asset.daysHeld} 天)
                    </span>
                  </div>

                  <div className="asset-stats-row flex-row items-baseline justify-between mt-sm">
                    <div>
                      <span className="text-xs text-muted">当前日均持有成本: </span>
                      <span className="font-bold text-cyan text-lg">
                        ¥{asset.currentDailyCost}
                      </span>
                      <span className="text-xs text-muted"> / 天</span>
                    </div>

                    <div className="text-right text-xs text-muted">
                      目标: ¥{asset.target_daily_cost || '2.00'} / 天
                    </div>
                  </div>

                  <div className="progress-bar-container mt-xs">
                    <div
                      className="progress-bar bg-cyan"
                      style={{ width: `${asset.progressPercent}%` }}
                    />
                  </div>

                  <div className="flex-row items-center justify-between text-xs text-muted mt-xs">
                    <span>回本进度: {asset.progressPercent}%</span>
                    <span>
                      原成本: ¥{asset.purchase_net_cost}
                      {resaleNum > 0 && (
                        <span className="text-success ml-xs">
                          (二手回血: -¥{asset.resale_recovery})
                        </span>
                      )}
                    </span>
                  </div>

                  <div className="asset-action-row mt-sm flex-row justify-end">
                    <button
                      type="button"
                      className="btn btn-xs btn-outline-success"
                      onClick={() => {
                        setResaleModalAsset(asset);
                        setResaleAmount(asset.resale_recovery || '800.00');
                      }}
                    >
                      💰 登记二手转售回血冲抵
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 登记二手回血弹窗 */}
      {resaleModalAsset && (
        <div className="modal-backdrop">
          <div className="modal-box">
            <div className="modal-header flex-row items-center justify-between">
              <h3 className="modal-title">
                💰 登记二手回血：{resaleModalAsset.asset_name}
              </h3>
              <button
                type="button"
                className="btn-close"
                onClick={() => setResaleModalAsset(null)}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleResaleSubmit} className="modal-form mt-md">
              <div className="form-group">
                <label className="label">
                  转售回收金额（元，将从资产净成本中全额冲抵，大幅摊薄日均成本）
                </label>
                <input
                  type="number"
                  step="0.01"
                  className="input"
                  value={resaleAmount}
                  onChange={(e) => setResaleAmount(e.target.value)}
                  required
                />
              </div>

              <div className="text-xs text-muted mt-sm">
                购置原价: ¥{resaleModalAsset.purchase_net_cost} · 已持有:{' '}
                {resaleModalAsset.daysHeld} 天 · 回血后净成本: ¥
                {(
                  Number(resaleModalAsset.purchase_net_cost) -
                  Number(resaleAmount || 0)
                ).toFixed(2)}
              </div>

              <div className="modal-actions flex-row justify-end gap-sm mt-lg">
                <button
                  type="button"
                  className="btn btn-muted"
                  onClick={() => setResaleModalAsset(null)}
                >
                  取消
                </button>
                <button type="submit" className="btn btn-success">
                  确认登记回血
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
