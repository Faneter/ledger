import { toDecimal, MoneyInput } from './money.js';
import { MastercardFxResult } from './types.js';
import { invokeRustCore } from './wasm-bridge.js';

export interface ProcessMastercardFxParams {
  foreignAmount: MoneyInput;
  holdAmountCny: MoneyInput;
  settledAmountCny?: MoneyInput | null;
  holdRatio?: MoneyInput;
  cashbackRate?: MoneyInput;
  monthlyRemainingCapCny?: MoneyInput | null;
}

/**
 * 内置外币参考汇率表（对 CNY）
 */
export const DEFAULT_FX_RATES: Record<string, string> = {
  CNY: '1.000000',
  USD: '7.200000',
  EUR: '7.800000',
  JPY: '0.048000',
  GBP: '9.100000',
  HKD: '0.920000',
};

/**
 * 万事网联外币借记卡生命周期状态机计算引擎
 * 严格对应 PRD 模块 4 与第四章 process_mastercard_fx_lifecycle
 */
export function processMastercardFxLifecycle(
  params: ProcessMastercardFxParams
): MastercardFxResult {
  return invokeRustCore<MastercardFxResult>({
    op: 'process_mastercard_fx_lifecycle',
    foreignAmount: toDecimal(params.foreignAmount).toString(),
    holdAmountCny: toDecimal(params.holdAmountCny).toString(),
    settledAmountCny:
      params.settledAmountCny == null
        ? null
        : toDecimal(params.settledAmountCny).toString(),
    holdRatio:
      params.holdRatio == null ? '1.02' : toDecimal(params.holdRatio).toString(),
    cashbackRate:
      params.cashbackRate == null
        ? '0.01'
        : toDecimal(params.cashbackRate).toString(),
    monthlyRemainingCapCny:
      params.monthlyRemainingCapCny == null
        ? null
        : toDecimal(params.monthlyRemainingCapCny).toString(),
  });
}
