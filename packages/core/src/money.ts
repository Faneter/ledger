import Decimal from 'decimal.js';
import { invokeRustCore } from './wasm-bridge.js';

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export type MoneyInput = string | number | Decimal;

/**
 * 将输入转换为 Decimal 实例
 */
export function toDecimal(val: MoneyInput): Decimal {
  if (val instanceof Decimal) {
    return val;
  }
  return new Decimal(val);
}

/**
 * 保留 2 位小数，采用 ROUND_HALF_UP（四舍五入）
 */
export function roundCny(val: MoneyInput): Decimal {
  return new Decimal(
    invokeRustCore<string>({
      op: 'round_cny',
      value: toDecimal(val).toString(),
    })
  );
}

/**
 * 格式化为两位小数的人民币字符串（如 "31.01"）
 */
export function formatCny(val: MoneyInput): string {
  return invokeRustCore<string>({
    op: 'format_cny',
    value: toDecimal(val).toString(),
  });
}

/**
 * 保留 6 位小数的汇率数值，采用 ROUND_HALF_UP
 */
export function roundRate(val: MoneyInput): Decimal {
  return new Decimal(
    invokeRustCore<string>({
      op: 'round_rate',
      value: toDecimal(val).toString(),
    })
  );
}

/**
 * 格式化为 6 位小数的汇率字符串（如 "7.200000"）
 */
export function formatRate(val: MoneyInput): string {
  return invokeRustCore<string>({
    op: 'format_rate',
    value: toDecimal(val).toString(),
  });
}

/**
 * 对金额数组进行累加求和，并按两位小数四舍五入
 */
export function sumCny(values: MoneyInput[]): Decimal {
  return new Decimal(
    invokeRustCore<string>({
      op: 'sum_cny',
      values: values.map((v) => toDecimal(v).toString()),
    })
  );
}

/**
 * 判断两个金额在两位小数四舍五入后是否相等
 */
export function equalsCny(a: MoneyInput, b: MoneyInput): boolean {
  return invokeRustCore<boolean>({
    op: 'equals_cny',
    a: toDecimal(a).toString(),
    b: toDecimal(b).toString(),
  });
}

export { Decimal };
