import Decimal from 'decimal.js';

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
  return toDecimal(val).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/**
 * 格式化为两位小数的人民币字符串（如 "31.01"）
 */
export function formatCny(val: MoneyInput): string {
  return toDecimal(val).toFixed(2, Decimal.ROUND_HALF_UP);
}

/**
 * 保留 6 位小数的汇率数值，采用 ROUND_HALF_UP
 */
export function roundRate(val: MoneyInput): Decimal {
  return toDecimal(val).toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
}

/**
 * 格式化为 6 位小数的汇率字符串（如 "7.200000"）
 */
export function formatRate(val: MoneyInput): string {
  return toDecimal(val).toFixed(6, Decimal.ROUND_HALF_UP);
}

/**
 * 对金额数组进行累加求和，并按两位小数四舍五入
 */
export function sumCny(values: MoneyInput[]): Decimal {
  const total = values.reduce<Decimal>(
    (acc, cur) => acc.plus(toDecimal(cur)),
    new Decimal(0)
  );
  return roundCny(total);
}

/**
 * 判断两个金额在两位小数四舍五入后是否相等
 */
export function equalsCny(a: MoneyInput, b: MoneyInput): boolean {
  return roundCny(a).equals(roundCny(b));
}

export { Decimal };
