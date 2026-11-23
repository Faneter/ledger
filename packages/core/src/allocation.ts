import { toDecimal, MoneyInput } from './money.js';
import {
  AllocationMode,
  SplitItemInput,
  SplitItemResult,
} from './types.js';
import { invokeRustCore } from './wasm-bridge.js';

/**
 * 订单满减分摊综合计算结果
 */
export interface AllocationComputationResult {
  total_gross: string;
  total_discount: string;
  total_net: string;
  cash_paid: string;
  items: SplitItemResult[];
}

/**
 * 跨品类凑单满减自动分摊引擎（含 0.01 元尾差兜底）
 * 严格遵循 PRD 3.1 ~ 3.3 与核心财务守恒定律
 */
export function allocateSplitDiscounts(
  items: SplitItemInput[],
  totalNetPaid: MoneyInput,
  mode: AllocationMode = 'PROPORTIONAL',
  manualNets?: MoneyInput[]
): SplitItemResult[] {
  return invokeRustCore<SplitItemResult[]>({
    op: 'allocate_split_discounts',
    items,
    totalNetPaid: toDecimal(totalNetPaid).toString(),
    mode,
    manualNets: manualNets?.map((m) => toDecimal(m).toString()),
  });
}

/**
 * 综合订单分摊计算器
 */
export function computeOrderAllocation(
  items: SplitItemInput[],
  cashActuallyPaid: MoneyInput,
  mode: AllocationMode = 'PROPORTIONAL',
  manualNets?: MoneyInput[]
): AllocationComputationResult {
  const res = invokeRustCore<AllocationComputationResult>({
    op: 'compute_order_allocation',
    items,
    cashActuallyPaid: toDecimal(cashActuallyPaid).toString(),
    mode,
    voucher: null,
    manualNets: manualNets?.map((m) => toDecimal(m).toString()),
  });
  return {
    total_gross: res.total_gross,
    total_discount: res.total_discount,
    total_net: res.total_net,
    cash_paid: res.cash_paid,
    items: res.items,
  };
}
