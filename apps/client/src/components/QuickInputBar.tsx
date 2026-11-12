import React, { useState, useMemo } from 'react';
import { LocalLedgerEngine } from '../sync/local-replica';
import { Voucher } from '@ledger/core';

interface QuickInputBarProps {
  engine: LocalLedgerEngine;
  onRecordSuccess?: () => void;
}

const PRESET_PILLS = [
  {
    label: '场景 1：拌面与饭卡立减',
    dsl: '咸蛋黄拌面 16.8-0.15 + 饭卡充值 20-1.08*3 #饮食',
    desc: '单据多品算式计算与自含立减',
  },
  {
    label: '场景 2：跨品类凑单信用卡满减',
    dsl: '牛奶 28 #饮食 + 晾衣架 12 #日用 + 排针 15 #电子 = 50 @招行信用卡',
    desc: '多品类权重等比分摊与最后一分尾差兜底',
  },
  {
    label: '场景 3：万事达外币预授权消费',
    dsl: 'Porkbun域名 $4.35 冻结31.95 #数字服务 @万事达A',
    desc: '自动唤醒外币借记卡 + 102%冻结 + 1%返现',
  },
  {
    label: '场景 4：花呗用券还款',
    dsl: '还款 @花呗 500 - 还款券 5 从 @主力银联卡',
    desc: '信用负债清偿与还款抵扣券核销',
  },
];

export const QuickInputBar: React.FC<QuickInputBarProps> = ({
  engine,
  onRecordSuccess,
}) => {
  const [dslInput, setDslInput] = useState(
    '咸蛋黄拌面 16.8-0.15 + 饭卡充值 20-1.08*3 #饮食'
  );
  const [selectedVoucherId, setSelectedVoucherId] = useState<number | null>(null);
  const [txDate, setTxDate] = useState('2026-11-12');
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 可用卡券列表
  const availableVouchers: Voucher[] = useMemo(() => {
    return engine.state.vouchers.filter((v) => v.status === 'AVAILABLE');
  }, [engine.state.vouchers]);

  // 实时编译解析 DSL
  const preview = useMemo(() => {
    if (!dslInput.trim()) return null;
    try {
      const res = engine.previewDsl(dslInput, selectedVoucherId);
      return res;
    } catch {
      return null;
    }
  }, [engine, dslInput, selectedVoucherId]);

  const handleRecord = () => {
    if (!dslInput.trim()) return;
    try {
      setErrorMsg(null);
      const tx = engine.recordFromDsl(dslInput, txDate, selectedVoucherId);
      setSuccessToast(`✅ 记账成功！单据号: ${tx.header.id}，实付 ¥${tx.header.total_net}`);
      setSelectedVoucherId(null);
      setTimeout(() => setSuccessToast(null), 3500);
      onRecordSuccess?.();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleRecord();
    }
  };

  // 辅助查找分类名和池名
  const getCategoryName = (id?: string) => {
    if (!id) return '-';
    const cat = engine.state.categories.find((c) => c.id === id);
    return cat ? cat.name : id;
  };

  const getPoolName = (id?: string) => {
    if (!id) return '-';
    const p = engine.state.budgetPools.find((b) => b.id === id);
    return p ? p.name : id;
  };

  const getAccountName = (id?: string) => {
    if (!id) return '-';
    const a = engine.state.accounts.find((acc) => acc.id === id);
    return a ? a.name : id;
  };

  return (
    <div className="card quick-input-card">
      <div className="card-header">
        <div className="flex-row items-center gap-sm">
          <span className="badge badge-primary">模块 5</span>
          <h2 className="card-title">极速公式与自然语言记账台</h2>
        </div>
        <div className="flex-row items-center gap-sm text-muted text-xs">
          <span>记账日期:</span>
          <input
            type="date"
            value={txDate}
            onChange={(e) => setTxDate(e.target.value)}
            className="input-date"
          />
        </div>
      </div>

      {/* 预设场景快捷填入胶囊 */}
      <div className="pills-container">
        {PRESET_PILLS.map((pill, idx) => (
          <button
            key={idx}
            type="button"
            className="pill-button"
            title={pill.desc}
            onClick={() => {
              setDslInput(pill.dsl);
              setErrorMsg(null);
            }}
          >
            <span className="pill-dot">⚡</span>
            <span>{pill.label}</span>
          </button>
        ))}
      </div>

      {/* 核心单行 DSL 命令输入框 */}
      <div className="dsl-input-wrapper">
        <div className="dsl-input-prefix">❯_</div>
        <input
          type="text"
          className="dsl-input"
          placeholder="输入如: 咸蛋黄拌面 16.8-0.15 + 饭卡充值 20-1.08*3 #饮食 @主力银联卡"
          value={dslInput}
          onChange={(e) => {
            setDslInput(e.target.value);
            setErrorMsg(null);
          }}
          onKeyDown={handleKeyDown}
        />
        <button
          type="button"
          className="btn btn-primary btn-record"
          onClick={handleRecord}
        >
          立即入账
        </button>
      </div>

      {/* 外币符号自动置顶唤醒通知 */}
      {preview?.should_wake_fx_account && (
        <div className="alert alert-cyan flex-row items-center justify-between">
          <div className="flex-row items-center gap-sm">
            <span className="icon-pulse">⚡</span>
            <div>
              <strong>外币消费自动感知：</strong>已智能唤醒外币借记卡（102% 预授权冻结挂起 + 1% 返现自动核算）
            </div>
          </div>
          <span className="badge badge-cyan">DEBIT_FX 激活中</span>
        </div>
      )}

      {/* 叠加立减金选择器 */}
      <div className="voucher-select-row flex-row items-center justify-between">
        <div className="flex-row items-center gap-sm text-sm">
          <span className="text-secondary font-medium">🎟️ 虚拟卡包立减金叠加核销：</span>
          <select
            className="select-voucher"
            value={selectedVoucherId ?? ''}
            onChange={(e) =>
              setSelectedVoucherId(e.target.value ? Number(e.target.value) : null)
            }
          >
            <option value="">(不使用卡券 / 纯现金原价实付)</option>
            {availableVouchers.map((v) => (
              <option key={v.id} value={v.id}>
                {v.title} · 面值 ¥{v.face_value} (购券成本 ¥{v.acquire_cost} / 门槛 ¥{v.min_spend})
              </option>
            ))}
          </select>
        </div>

        {preview?.voucherInfo && (
          <div className="text-xs text-success flex-row items-center gap-sm">
            <span>✨ 结转成本入账: ¥{preview.voucherInfo.acquire_cost}</span>
            <span className="badge badge-success">净省: ¥{preview.voucherSavings}</span>
          </div>
        )}
      </div>

      {/* 实时解析与凑单分摊表格 */}
      {preview && preview.parsed && (
        <div className="preview-container">
          <div className="preview-header flex-row items-center justify-between">
            <span className="text-xs font-semibold text-secondary">
              📊 拆单与满减分摊实时预览（分摊模式: {preview.parsed.allocation_mode} · 付款账户: {getAccountName(preview.parsed.account_id)}）
            </span>
            <div className="flex-row items-center gap-md text-xs">
              <span>商品原价: <strong>¥{preview.parsed.total_gross}</strong></span>
              <span className="text-success">优惠省额: <strong>¥{preview.parsed.payment_discount || preview.parsed.platform_discount}</strong></span>
              <span className="text-accent font-bold">最终实付: <strong>¥{preview.parsed.total_net}</strong></span>
            </div>
          </div>

          <div className="table-responsive">
            <table className="table">
              <thead>
                <tr>
                  <th>商品/明细子项</th>
                  <th className="text-right">原价/算式</th>
                  <th className="text-right">分摊优惠</th>
                  <th className="text-right">实付净额</th>
                  <th>属性分类</th>
                  <th>归属预算池</th>
                  <th>专项/场景标签</th>
                </tr>
              </thead>
              <tbody>
                {preview.parsed.items.map((item, idx) => (
                  <tr key={idx}>
                    <td>
                      <div className="font-medium text-light">
                        {item.item_name}
                        {item.is_primary_item && preview.parsed.items.length > 1 && (
                          <span className="badge badge-purple ml-xs">主商品</span>
                        )}
                      </div>
                    </td>
                    <td className="text-right text-muted">
                      ¥{item.item_gross}
                      {item.raw_formula_expr && item.raw_formula_expr !== item.item_gross && (
                        <span className="formula-tag">({item.raw_formula_expr})</span>
                      )}
                    </td>
                    <td className="text-right text-success">
                      -¥{item.allocated_discount}
                    </td>
                    <td className="text-right font-semibold text-light">
                      ¥{item.item_net}
                    </td>
                    <td>
                      <span className="tag tag-category">
                        {getCategoryName(item.category_id)}
                      </span>
                    </td>
                    <td>
                      <span className="tag tag-pool">
                        {getPoolName(item.budget_pool_id)}
                      </span>
                    </td>
                    <td>
                      {item.project_tag_id ? (
                        <span className="tag tag-project">
                          #{item.project_tag_id}
                        </span>
                      ) : (
                        <span className="text-muted text-xs">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 提示消息 */}
      {successToast && <div className="alert alert-success">{successToast}</div>}
      {errorMsg && <div className="alert alert-error">❌ {errorMsg}</div>}
    </div>
  );
};
