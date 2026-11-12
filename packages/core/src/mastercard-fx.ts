import {
  Decimal,
  toDecimal,
  roundCny,
  formatCny,
  formatRate,
  MoneyInput,
} from './money.js';
import {
  MastercardFxHoldResult,
  MastercardFxSettledResult,
  MastercardFxResult,
} from './types.js';

export interface ProcessMastercardFxParams {
  foreignAmount: MoneyInput;
  holdAmountCny: MoneyInput;
  settledAmountCny?: MoneyInput | null;
  holdRatio?: MoneyInput;
  cashbackRate?: MoneyInput;
  monthlyRemainingCapCny?: MoneyInput | null;
}

/**
 * 万事网联外币借记卡生命周期状态机计算引擎
 * 严格对应 PRD 模块 4 与第四章 process_mastercard_fx_lifecycle
 *
 * 核心逻辑：
 * - 交易当下按 102% 预授权冻结挂起 (PENDING_HOLD)
 * - T+1/T+2 银行正式清算入账锁定 (SETTLED)，解冻差额并享受 1% 消费返现（支持月度返现封顶）
 */
export function processMastercardFxLifecycle(
  params: ProcessMastercardFxParams
): MastercardFxResult {
  const foreignAmountDec = toDecimal(params.foreignAmount);
  const holdAmountDec = roundCny(params.holdAmountCny);
  const holdRatioDec = toDecimal(params.holdRatio ?? '1.02');
  const cashbackRateDec = toDecimal(params.cashbackRate ?? '0.01');

  if (params.settledAmountCny == null) {
    // 阶段 1：交易发生时（PENDING_HOLD 预授权挂起态）
    const estimatedBase = roundCny(holdAmountDec.dividedBy(holdRatioDec));
    const rawCashback = roundCny(estimatedBase.times(cashbackRateDec));

    let estimatedCashback = rawCashback;
    if (params.monthlyRemainingCapCny != null) {
      const cap = Decimal.max(toDecimal(params.monthlyRemainingCapCny), new Decimal(0));
      estimatedCashback = roundCny(Decimal.min(rawCashback, cap));
    }

    const totalNet = roundCny(estimatedBase.minus(estimatedCashback));
    const exchangeRate = formatRate(estimatedBase.dividedBy(foreignAmountDec));

    const result: MastercardFxHoldResult = {
      status: 'PENDING_HOLD',
      hold_amount_cny: formatCny(holdAmountDec),
      total_gross: formatCny(estimatedBase),
      payment_discount: formatCny(estimatedCashback),
      total_net: formatCny(totalNet),
      exchange_rate: exchangeRate,
    };
    return result;
  } else {
    // 阶段 2：银行清算通知到达（SETTLED 已清算锁定态）
    const settledBase = roundCny(params.settledAmountCny);
    const rawCashback = roundCny(settledBase.times(cashbackRateDec));

    let actualCashback = rawCashback;
    if (params.monthlyRemainingCapCny != null) {
      const cap = Decimal.max(toDecimal(params.monthlyRemainingCapCny), new Decimal(0));
      actualCashback = roundCny(Decimal.min(rawCashback, cap));
    }

    const releasedHold = roundCny(holdAmountDec.minus(settledBase));
    const totalNet = roundCny(settledBase.minus(actualCashback));
    const exchangeRate = formatRate(settledBase.dividedBy(foreignAmountDec));

    const result: MastercardFxSettledResult = {
      status: 'SETTLED',
      hold_amount_cny: '0.00',
      released_to_available: formatCny(releasedHold),
      total_gross: formatCny(settledBase),
      payment_discount: formatCny(actualCashback),
      total_net: formatCny(totalNet),
      exchange_rate: exchangeRate,
    };
    return result;
  }
}
