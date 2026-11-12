import React, { useState } from 'react';
import { LocalLedgerEngine } from '../sync/local-replica';
import { AccountDashboardRow, TransactionAggregate, VoucherType } from '@ledger/core';

interface AccountMatrixPanelProps {
  engine: LocalLedgerEngine;
  onRefresh?: () => void;
}

export const AccountMatrixPanel: React.FC<AccountMatrixPanelProps> = ({
  engine,
  onRefresh,
}) => {
  const [showDormant, setShowDormant] = useState(false);
  const [settleInputs, setSettleInputs] = useState<Record<string, string>>({});
  const [etfInput, setEtfInput] = useState('');
  const [showEtfEditor, setShowEtfEditor] = useState(false);

  // 快捷购券表单状态
  const [showBuyVoucherModal, setShowBuyVoucherModal] = useState(false);
  const [voucherTitle, setVoucherTitle] = useState('微信支付10元立减金');
  const [voucherType, setVoucherType] = useState<VoucherType>('PREPAID_COUPON');
  const [faceValue, setFaceValue] = useState('10.00');
  const [acquireCost, setAcquireCost] = useState('5.99');
  const [minSpend, setMinSpend] = useState('10.01');
  const [voucherAccount, setVoucherAccount] = useState('ACC_UNION_MAIN');

  const accounts: AccountDashboardRow[] = engine.getAccountDashboard();
  const pendingFxTxs: TransactionAggregate[] = engine.getPendingFxTransactions();

  // 分层过滤
  const creditAccounts = accounts.filter((a) => a.account_role === 'CREDIT');
  const mainDebitAccounts = accounts.filter(
    (a) => a.account_role === 'DEBIT_MAIN' || a.account_role === 'PREPAID'
  );
  const fxAccounts = accounts.filter((a) => a.account_role === 'DEBIT_FX');
  const investmentAccounts = accounts.filter(
    (a) => a.account_role === 'INVESTMENT'
  );
  const dormantAccounts = accounts.filter((a) => a.account_role === 'DORMANT');

  // 处理万事达外币预授权正式清算
  const handleSettle = (txId: string) => {
    const val = settleInputs[txId];
    if (!val || isNaN(Number(val)) || Number(val) <= 0) {
      alert('请输入有效的银行最终正式清算人民币金额（如 31.20）');
      return;
    }
    try {
      engine.settleMastercardPending(txId, val);
      setSettleInputs((prev) => {
        const next = { ...prev };
        delete next[txId];
        return next;
      });
      onRefresh?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  // 处理更新 ETF 市值
  const handleUpdateEtf = (accountId: string) => {
    if (!etfInput || isNaN(Number(etfInput))) {
      alert('请输入有效市值金额');
      return;
    }
    try {
      engine.updateEtfMarketValue(accountId, etfInput);
      setShowEtfEditor(false);
      setEtfInput('');
      onRefresh?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  // 购券入库
  const handleBuyVoucher = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      engine.buyVoucher({
        title: voucherTitle,
        voucher_type: voucherType,
        face_value: faceValue,
        acquire_cost: acquireCost,
        min_spend: minSpend,
        accountId: voucherAccount,
      });
      setShowBuyVoucherModal(false);
      onRefresh?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="account-matrix-section">
      {/* 置顶橙色待清算预警栏 */}
      {pendingFxTxs.length > 0 && (
        <div className="alert alert-warning mb-md">
          <div className="flex-row items-center justify-between mb-sm">
            <div className="flex-row items-center gap-sm">
              <span className="icon-badge">⏳</span>
              <strong>万事达外币预授权待清算确认 ({pendingFxTxs.length} 笔)</strong>
            </div>
            <span className="text-xs text-muted">
              T+1/T+2 银行入账后，输入正式清算金额释放 102% 冻结并入账 1% 返现
            </span>
          </div>

          <div className="pending-fx-list">
            {pendingFxTxs.map((tx) => {
              const h = tx.header;
              const inputVal = settleInputs[h.id] ?? '';
              return (
                <div key={h.id} className="pending-fx-item flex-row items-center justify-between">
                  <div>
                    <span className="font-semibold text-light">{h.merchant_or_note || '外币消费'}</span>
                    <span className="text-muted text-xs ml-sm">
                      原币: {h.original_currency} {h.original_amount} · 冻结中: ¥{h.hold_amount_cny}
                    </span>
                  </div>

                  <div className="flex-row items-center gap-sm">
                    <span className="text-xs text-muted">银行最终账单实付: ¥</span>
                    <input
                      type="number"
                      step="0.01"
                      className="input-sm input-settle"
                      placeholder="如 31.20"
                      value={inputVal}
                      onChange={(e) =>
                        setSettleInputs({ ...settleInputs, [h.id]: e.target.value })
                      }
                    />
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      onClick={() => handleSettle(h.id)}
                    >
                      清算解冻锁定
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 四层账户结构 */}
      <div className="accounts-four-layer-container">
        {/* Layer 1: 日常信用支付层 */}
        <div className="card account-layer-card">
          <div className="layer-header flex-row items-center justify-between">
            <div className="flex-row items-center gap-xs">
              <span className="badge badge-purple">第一层</span>
              <h3 className="layer-title">日常信用支付层 (CREDIT)</h3>
            </div>
            <span className="text-xs text-muted">花呗 / 信用卡 负债与免息期管控</span>
          </div>

          <div className="account-cards-grid mt-sm">
            {creditAccounts.map((acc) => {
              const bookNum = Number(acc.book_balance);
              const isNegative = bookNum < 0;
              return (
                <div key={acc.id} className="account-item-box">
                  <div className="flex-row items-center justify-between">
                    <span className="account-name font-medium">{acc.name}</span>
                    <span className="text-xs text-muted">额度: ¥1500.00</span>
                  </div>
                  <div className="account-balance-row mt-xs flex-row items-baseline justify-between">
                    <span className="text-xs text-muted">当前未还本金:</span>
                    <span
                      className={`font-bold text-base ${
                        isNegative ? 'text-danger' : 'text-light'
                      }`}
                    >
                      ¥{acc.book_balance}
                    </span>
                  </div>
                  <div className="text-xs text-muted mt-xs">
                    可用额度: ¥{acc.available_balance}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Layer 2: 核心资金结算层 */}
        <div className="card account-layer-card">
          <div className="layer-header flex-row items-center justify-between">
            <div className="flex-row items-center gap-xs">
              <span className="badge badge-primary">第二层</span>
              <h3 className="layer-title">核心资金结算层 (DEBIT & PREPAID)</h3>
            </div>
            <span className="text-xs text-muted">主力借记卡 & 校园预充值饭卡</span>
          </div>

          <div className="account-cards-grid mt-sm">
            {mainDebitAccounts.map((acc) => (
              <div key={acc.id} className="account-item-box">
                <div className="flex-row items-center justify-between">
                  <span className="account-name font-medium">{acc.name}</span>
                  <span className="badge badge-outline text-xs">
                    {acc.account_role === 'PREPAID' ? '饭卡' : '主结算卡'}
                  </span>
                </div>
                <div className="account-balance-row mt-xs flex-row items-baseline justify-between">
                  <span className="text-xs text-muted">当前可用余额:</span>
                  <span className="font-bold text-base text-accent">
                    ¥{acc.available_balance}
                  </span>
                </div>
                <div className="text-xs text-muted mt-xs">
                  账面余额: ¥{acc.book_balance}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Layer 3: 外币预授权专层 */}
        <div className="card account-layer-card">
          <div className="layer-header flex-row items-center justify-between">
            <div className="flex-row items-center gap-xs">
              <span className="badge badge-cyan">第三层</span>
              <h3 className="layer-title">外币预授权专层 (DEBIT_FX)</h3>
            </div>
            <span className="text-xs text-muted">
              万事网联借记卡（102%预授权冻结 + 1%返现入账）
            </span>
          </div>

          <div className="account-cards-grid mt-sm">
            {fxAccounts.map((acc) => {
              const frozenNum = Number(acc.frozen_amount);
              return (
                <div key={acc.id} className="account-item-box border-cyan">
                  <div className="flex-row items-center justify-between">
                    <span className="account-name font-medium text-cyan">{acc.name}</span>
                    <span className="badge badge-cyan">1% 返现</span>
                  </div>
                  <div className="account-balance-row mt-xs flex-row items-baseline justify-between">
                    <span className="text-xs text-muted">可用余额 (扣除冻结):</span>
                    <span className="font-bold text-base text-light">
                      ¥{acc.available_balance}
                    </span>
                  </div>
                  <div className="flex-row items-center justify-between text-xs text-muted mt-xs">
                    <span>账面总额: ¥{acc.book_balance}</span>
                    <span className={frozenNum > 0 ? 'text-warning font-semibold' : ''}>
                      已冻结: ¥{acc.frozen_amount}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Layer 4: 投资与睡眠归档层 */}
        <div className="card account-layer-card">
          <div className="layer-header flex-row items-center justify-between">
            <div className="flex-row items-center gap-xs">
              <span className="badge badge-muted">第四层</span>
              <h3 className="layer-title">投资与睡眠归档层</h3>
            </div>
            <div className="flex-row items-center gap-sm">
              <button
                type="button"
                className="btn btn-xs btn-outline-muted"
                onClick={() => setShowDormant(!showDormant)}
              >
                {showDormant ? '折叠隐藏睡眠卡' : '显示折叠睡眠卡 (1张)'}
              </button>
            </div>
          </div>

          <div className="account-cards-grid mt-sm">
            {/* 指数基金投资卡片 */}
            {investmentAccounts.map((acc) => {
              const pnlNum = Number(acc.unrealized_pnl);
              const isProfit = pnlNum >= 0;
              return (
                <div key={acc.id} className="account-item-box">
                  <div className="flex-row items-center justify-between">
                    <span className="account-name font-medium">{acc.name}</span>
                    <span className="badge badge-purple">定投指数基金</span>
                  </div>
                  <div className="account-balance-row mt-xs flex-row items-baseline justify-between">
                    <span className="text-xs text-muted">最新总市值:</span>
                    <span className="font-bold text-base text-light">
                      ¥{acc.market_value || acc.book_balance}
                    </span>
                  </div>
                  <div className="flex-row items-center justify-between text-xs mt-xs">
                    <span className="text-muted">投资本金: ¥{acc.book_balance}</span>
                    <span
                      className={`font-semibold ${
                        isProfit ? 'text-success' : 'text-danger'
                      }`}
                    >
                      浮动盈亏: {isProfit ? '+' : ''}¥{acc.unrealized_pnl}
                    </span>
                  </div>

                  <div className="mt-xs">
                    {!showEtfEditor ? (
                      <button
                        type="button"
                        className="btn btn-xs btn-outline-primary"
                        onClick={() => {
                          setEtfInput(acc.market_value || acc.book_balance);
                          setShowEtfEditor(true);
                        }}
                      >
                        ✏️ 更新最新市值
                      </button>
                    ) : (
                      <div className="flex-row items-center gap-xs mt-xs">
                        <input
                          type="number"
                          step="0.01"
                          className="input-xs"
                          placeholder="输入最新市值"
                          value={etfInput}
                          onChange={(e) => setEtfInput(e.target.value)}
                        />
                        <button
                          type="button"
                          className="btn btn-xs btn-primary"
                          onClick={() => handleUpdateEtf(acc.id)}
                        >
                          保存
                        </button>
                        <button
                          type="button"
                          className="btn btn-xs btn-muted"
                          onClick={() => setShowEtfEditor(false)}
                        >
                          取消
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* 睡眠卡折叠展示 */}
            {showDormant &&
              dormantAccounts.map((acc) => (
                <div key={acc.id} className="account-item-box opacity-75 border-dashed">
                  <div className="flex-row items-center justify-between">
                    <span className="account-name text-muted">{acc.name}</span>
                    <span className="badge badge-muted">低频睡眠</span>
                  </div>
                  <div className="account-balance-row mt-xs flex-row items-baseline justify-between">
                    <span className="text-xs text-muted">账面余额:</span>
                    <span className="text-muted font-mono">¥{acc.book_balance}</span>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* 虚拟卡包面板 (Voucher Wallet) */}
      <div className="card voucher-wallet-card mt-md">
        <div className="card-header flex-row items-center justify-between">
          <div className="flex-row items-center gap-sm">
            <span className="badge badge-success">模块 1.2</span>
            <h3 className="card-title">虚拟卡包与立减金中心 (Voucher Wallet)</h3>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-outline-success"
            onClick={() => setShowBuyVoucherModal(true)}
          >
            + 有偿购券入库 (如 5.99 买 10 元)
          </button>
        </div>

        <div className="voucher-cards-grid mt-sm">
          {engine.state.vouchers.map((v) => {
            const isAvail = v.status === 'AVAILABLE';
            return (
              <div
                key={v.id}
                className={`voucher-card-item ${
                  isAvail ? 'voucher-available' : 'voucher-used'
                }`}
              >
                <div className="flex-row items-center justify-between">
                  <span className="voucher-title font-medium">{v.title}</span>
                  <span
                    className={`badge ${
                      isAvail ? 'badge-success' : 'badge-muted'
                    }`}
                  >
                    {isAvail ? '待核销' : '已核销'}
                  </span>
                </div>
                <div className="voucher-amount-row mt-xs flex-row items-baseline justify-between">
                  <div>
                    <span className="voucher-face font-bold text-lg text-success">
                      ¥{v.face_value}
                    </span>
                    <span className="text-xs text-muted ml-xs">面值</span>
                  </div>
                  <div className="text-xs text-muted">
                    购券成本: <strong className="text-light">¥{v.acquire_cost}</strong>
                  </div>
                </div>
                <div className="text-xs text-muted mt-xs flex-row items-center justify-between">
                  <span>最低使用门槛: ¥{v.min_spend}</span>
                  <span>净省: ¥{(Number(v.face_value) - Number(v.acquire_cost)).toFixed(2)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 有偿购券入库模态弹窗 */}
      {showBuyVoucherModal && (
        <div className="modal-backdrop">
          <div className="modal-box">
            <div className="modal-header flex-row items-center justify-between">
              <h3 className="modal-title">🎟️ 有偿购券入库登记</h3>
              <button
                type="button"
                className="btn-close"
                onClick={() => setShowBuyVoucherModal(false)}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleBuyVoucher} className="modal-form mt-md">
              <div className="form-group">
                <label className="label">卡券名称 / 标题</label>
                <input
                  type="text"
                  className="input"
                  value={voucherTitle}
                  onChange={(e) => setVoucherTitle(e.target.value)}
                  required
                />
              </div>

              <div className="form-row flex-row gap-sm">
                <div className="form-group flex-1">
                  <label className="label">卡券类型</label>
                  <select
                    className="select"
                    value={voucherType}
                    onChange={(e) => setVoucherType(e.target.value as VoucherType)}
                  >
                    <option value="PREPAID_COUPON">有偿购入立减金</option>
                    <option value="FREE_COUPON">免费领取立减金</option>
                    <option value="REPAY_COUPON">信用卡/花呗还款券</option>
                  </select>
                </div>
                <div className="form-group flex-1">
                  <label className="label">支付扣款账户</label>
                  <select
                    className="select"
                    value={voucherAccount}
                    onChange={(e) => setVoucherAccount(e.target.value)}
                  >
                    {mainDebitAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-row flex-row gap-sm">
                <div className="form-group flex-1">
                  <label className="label">面值金额 (元)</label>
                  <input
                    type="number"
                    step="0.01"
                    className="input"
                    value={faceValue}
                    onChange={(e) => setFaceValue(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group flex-1">
                  <label className="label">实付购券成本 (元)</label>
                  <input
                    type="number"
                    step="0.01"
                    className="input"
                    value={acquireCost}
                    onChange={(e) => setAcquireCost(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group flex-1">
                  <label className="label">最低使用门槛 (元)</label>
                  <input
                    type="number"
                    step="0.01"
                    className="input"
                    value={minSpend}
                    onChange={(e) => setMinSpend(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="modal-actions flex-row justify-end gap-sm mt-lg">
                <button
                  type="button"
                  className="btn btn-muted"
                  onClick={() => setShowBuyVoucherModal(false)}
                >
                  取消
                </button>
                <button type="submit" className="btn btn-success">
                  确认购券入库
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
