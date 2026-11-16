import React from 'react';
import { LocalLedgerEngine } from '../sync/local-replica';

interface AssetAndProjectTrackerProps {
  engine: LocalLedgerEngine;
  currentDate?: string;
  onRefresh?: () => void;
}

export const AssetAndProjectTracker: React.FC<AssetAndProjectTrackerProps> = ({
  engine,
}) => {
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

  return (
    <div className="asset-project-section">
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
                      跨期独立专项
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
    </div>
  );
};
