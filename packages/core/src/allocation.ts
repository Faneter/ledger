import { toDecimal, MoneyInput } from './money.js';
import {
  AllocationMode,
  SplitItemInput,
  SplitItemResult,
  VoucherType,
} from './types.js';
import { invokeRustCore } from './wasm-bridge.js';

/**
 * 优惠券/立减金核销输入信息
 */
export interface VoucherRedemptionInfo {
  face_value: MoneyInput;
  acquire_cost: MoneyInput;
  voucher_type: VoucherType | 'PREPAID_COUPON' | 'FREE_COUPON';
}

/**
 * 订单满减分摊与优惠券核销综合计算结果
 */
export interface AllocationComputationResult {
  total_gross: string;
  total_discount: string;
  total_net: string;
  cash_paid: string;
  voucher_net_savings: string;
  voucher_cost_carryover: string;
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
 * 处理 PRD 1.2「优惠券与立减金卡包」核销逻辑
 */
export function applyVoucherToOrder(
  orderGross: MoneyInput,
  cashActuallyPaidAfterVoucher: MoneyInput,
  voucher: VoucherRedemptionInfo
): {
  order_gross: string;
  cash_paid: string;
  voucher_acquire_cost: string;
  effective_budget_net: string;
  net_savings: string;
} {
  return invokeRustCore({
    op: 'apply_voucher_to_order',
    orderGross: toDecimal(orderGross).toString(),
    cashActuallyPaidAfterVoucher: toDecimal(
      cashActuallyPaidAfterVoucher
    ).toString(),
    voucher: {
      face_value: toDecimal(voucher.face_value).toString(),
      acquire_cost: toDecimal(voucher.acquire_cost).toString(),
      voucher_type: voucher.voucher_type,
    },
  });
}

/**
 * 综合订单分摊与立减金核销计算器
 */
export function computeOrderAllocation(
  items: SplitItemInput[],
  cashActuallyPaid: MoneyInput,
  mode: AllocationMode = 'PROPORTIONAL',
  voucher?: VoucherRedemptionInfo | null,
  manualNets?: MoneyInput[]
): AllocationComputationResult {
  return invokeRustCore<AllocationComputationResult>({
    op: 'compute_order_allocation',
    items,
    cashActuallyPaid: toDecimal(cashActuallyPaid).toString(),
    mode,
    voucher: voucher
      ? {
          face_value: toDecimal(voucher.face_value).toString(),
          acquire_cost: toDecimal(voucher.acquire_cost).toString(),
          voucher_type: voucher.voucher_type,
        }
      : null,
    manualNets: manualNets?.map((m) => toDecimal(m).toString()),
  });
}
