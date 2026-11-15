import {
  Decimal,
  toDecimal,
  roundCny,
  formatCny,
  sumCny,
  MoneyInput,
} from './money.js';
import {
  AllocationMode,
  SplitItemInput,
  SplitItemResult,
  VoucherType,
} from './types.js';

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
 *
 * @param items 子明细输入数组
 * @param totalNetPaid 最终实付人民币净额
 * @param mode 分摊模式：'PROPORTIONAL' (默认) | 'PRIMARY_ITEM' | 'MANUAL' | 'SINGLE'
 * @param manualNets 仅在 'MANUAL' 模式下必填，各子项指定净额
 */
export function allocateSplitDiscounts(
  items: SplitItemInput[],
  totalNetPaid: MoneyInput,
  mode: AllocationMode = 'PROPORTIONAL',
  manualNets?: MoneyInput[]
): SplitItemResult[] {
  if (items.length === 0) {
    return [];
  }

  const netPaidDec = roundCny(totalNetPaid);
  const totalGrossDec = items.reduce(
    (acc, it) => acc.plus(toDecimal(it.gross)),
    new Decimal(0)
  );
  const totalDiscountDec = roundCny(totalGrossDec.minus(netPaidDec));

  // 1. MANUAL 模式：严格校验各子项手动净额守恒
  if (mode === 'MANUAL') {
    if (!manualNets || manualNets.length !== items.length) {
      throw new Error(
        `MANUAL allocation requires manualNets matching items length (expected ${items.length}, got ${manualNets?.length ?? 0})`
      );
    }
    const manualSum = sumCny(manualNets);
    if (!manualSum.equals(netPaidDec)) {
      throw new Error(
        `MANUAL allocation sum (${formatCny(manualSum)}) does not equal totalNetPaid (${formatCny(netPaidDec)}), violating conservation law`
      );
    }
    return items.map((item, idx) => {
      const gross = roundCny(item.gross);
      const net = roundCny(manualNets[idx]);
      const discount = gross.minus(net);
      return {
        ...item,
        gross: formatCny(gross),
        allocated_discount: formatCny(discount),
        net: formatCny(net),
      };
    });
  }

  // 2. 单项无拆分模式 (SINGLE) 或仅有 1 个商品
  if (items.length === 1 || mode === 'SINGLE') {
    return items.map((item, idx) => {
      const gross = roundCny(item.gross);
      if (idx === 0) {
        const net = roundCny(gross.minus(totalDiscountDec));
        return {
          ...item,
          gross: formatCny(gross),
          allocated_discount: formatCny(totalDiscountDec),
          net: formatCny(net),
        };
      }
      return {
        ...item,
        gross: formatCny(gross),
        allocated_discount: formatCny(0),
        net: formatCny(gross),
      };
    });
  }

  // 3. 优惠额 <= 0 (无优惠或溢价)
  if (totalDiscountDec.lessThanOrEqualTo(0)) {
    if (totalDiscountDec.isZero()) {
      return items.map((item) => {
        const gross = roundCny(item.gross);
        return {
          ...item,
          gross: formatCny(gross),
          allocated_discount: formatCny(0),
          net: formatCny(gross),
        };
      });
    }
    // 溢价或负折扣：最后一项吸收差额保证 sum(net) === totalNetPaid
    return items.map((item, idx) => {
      const gross = roundCny(item.gross);
      if (idx === items.length - 1) {
        const net = roundCny(gross.minus(totalDiscountDec));
        return {
          ...item,
          gross: formatCny(gross),
          allocated_discount: formatCny(totalDiscountDec),
          net: formatCny(net),
        };
      }
      return {
        ...item,
        gross: formatCny(gross),
        allocated_discount: formatCny(0),
        net: formatCny(gross),
      };
    });
  }

  // 4. PRIMARY_ITEM 模式：主商品独享全部优惠
  if (mode === 'PRIMARY_ITEM') {
    const primaryIdx = items.findIndex((it) => it.is_primary === true);
    const targetIdx = primaryIdx !== -1 ? primaryIdx : 0;

    return items.map((item, idx) => {
      const gross = roundCny(item.gross);
      if (idx === targetIdx) {
        const net = roundCny(gross.minus(totalDiscountDec));
        return {
          ...item,
          gross: formatCny(gross),
          allocated_discount: formatCny(totalDiscountDec),
          net: formatCny(net),
        };
      }
      return {
        ...item,
        gross: formatCny(gross),
        allocated_discount: formatCny(0),
        net: formatCny(gross),
      };
    });
  }

  // 5. PROPORTIONAL 模式（默认）：按原价权重等比分摊 + 最后一项自动吸收 0.01 元尾差
  let accumulatedDiscount = new Decimal(0);
  const result: SplitItemResult[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const gross = roundCny(item.gross);
    let disc: Decimal;

    if (i < items.length - 1) {
      if (totalGrossDec.isZero()) {
        disc = new Decimal(0);
      } else {
        const ratio = gross.dividedBy(totalGrossDec);
        disc = roundCny(totalDiscountDec.times(ratio));
      }
      accumulatedDiscount = accumulatedDiscount.plus(disc);
    } else {
      // 最后一项吸收四舍五入尾差
      disc = roundCny(totalDiscountDec.minus(accumulatedDiscount));
    }

    const net = roundCny(gross.minus(disc));

    result.push({
      ...item,
      gross: formatCny(gross),
      allocated_discount: formatCny(disc),
      net: formatCny(net),
    });
  }

  return result;
}

/**
 * 处理 PRD 1.2「优惠券与立减金卡包」核销逻辑
 *
 * 如消费原价 15.00 元，使用面值 10.00 元、购入成本 5.99 元的有偿立减金（PREPAID_COUPON），
 * 现场微信再付 5.00 元：
 * - 计入预算的实际总支出成本 (effective_budget_net) = cashActuallyPaidAfterVoucher + acquire_cost = 5.00 + 5.99 = 10.99 元
 * - 薅羊毛净省金额 (net_savings) = face_value - acquire_cost = 10.00 - 5.99 = 4.01 元
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
  const grossDec = roundCny(orderGross);
  const cashPaidDec = roundCny(cashActuallyPaidAfterVoucher);
  const acquireCostDec = roundCny(voucher.acquire_cost);
  const faceValueDec = roundCny(voucher.face_value);

  const effectiveBudgetNet = roundCny(cashPaidDec.plus(acquireCostDec));
  const netSavings = roundCny(faceValueDec.minus(acquireCostDec));

  return {
    order_gross: formatCny(grossDec),
    cash_paid: formatCny(cashPaidDec),
    voucher_acquire_cost: formatCny(acquireCostDec),
    effective_budget_net: formatCny(effectiveBudgetNet),
    net_savings: formatCny(netSavings),
  };
}

/**
 * 综合订单分摊与立减金核销计算器
 * 当传入有偿立减金 (PREPAID_COUPON) 时，自动将购券成本 (acquire_cost) 结转计入订单与子明细的 total_net，
 * 使 total_gross - total_discount = total_net 与 PRD v_monthly_budget_status 视图完全守恒对齐。
 */
export function computeOrderAllocation(
  items: SplitItemInput[],
  cashActuallyPaid: MoneyInput,
  mode: AllocationMode = 'PROPORTIONAL',
  voucher?: VoucherRedemptionInfo | null,
  manualNets?: MoneyInput[]
): AllocationComputationResult {
  const totalGrossDec = roundCny(
    items.reduce((acc, it) => acc.plus(toDecimal(it.gross)), new Decimal(0))
  );
  const cashPaidDec = roundCny(cashActuallyPaid);

  let voucherSavings = new Decimal(0);
  let voucherCost = new Decimal(0);

  if (voucher) {
    voucherCost = roundCny(voucher.acquire_cost);
    voucherSavings = roundCny(toDecimal(voucher.face_value).minus(voucherCost));
  }

  // 结转购券成本后的实际预算消耗净额 (如 5.00 实付 + 5.99 购券成本 = 10.99)
  const effectiveBudgetNetDec = roundCny(cashPaidDec.plus(voucherCost));
  const totalDiscountDec = roundCny(totalGrossDec.minus(effectiveBudgetNetDec));
  const splitItems = allocateSplitDiscounts(
    items,
    effectiveBudgetNetDec,
    mode,
    manualNets
  );

  return {
    total_gross: formatCny(totalGrossDec),
    total_discount: formatCny(totalDiscountDec),
    total_net: formatCny(effectiveBudgetNetDec),
    cash_paid: formatCny(cashPaidDec),
    voucher_net_savings: formatCny(voucherSavings),
    voucher_cost_carryover: formatCny(voucherCost),
    items: splitItems,
  };
}
