import { describe, it, expect } from 'vitest';
import {
  toDecimal,
  roundCny,
  formatCny,
  roundRate,
  formatRate,
  sumCny,
  equalsCny,
  Decimal,
} from '../src/money.js';
import { getLocalTodayDateStr, getLocalYearMonthStr } from '../src/types.js';

describe('money utilities (decimal precision and rounding)', () => {
  describe('toDecimal', () => {
    it('should convert string, number, and Decimal to Decimal instance', () => {
      const d1 = toDecimal('12.34');
      const d2 = toDecimal(12.34);
      const original = new Decimal('12.34');
      const d3 = toDecimal(original);

      expect(d1 instanceof Decimal).toBe(true);
      expect(d2 instanceof Decimal).toBe(true);
      expect(d3 instanceof Decimal).toBe(true);
      expect(d1.toString()).toBe('12.34');
      expect(d3).toBe(original);
    });
  });

  describe('roundCny & formatCny (ROUND_HALF_UP)', () => {
    it('should perform ROUND_HALF_UP to 2 decimal places', () => {
      // 1.005 -> 1.01
      expect(roundCny('1.005').toString()).toBe('1.01');
      expect(formatCny('1.005')).toBe('1.01');

      // 1.004 -> 1.00
      expect(roundCny('1.004').toString()).toBe('1');
      expect(formatCny('1.004')).toBe('1.00');

      // 1.0051 -> 1.01
      expect(roundCny('1.0051').toString()).toBe('1.01');
      expect(formatCny('1.0051')).toBe('1.01');

      // Number input
      expect(roundCny(1.005).toString()).toBe('1.01');
    });

    it('should accurately handle PRD Mastercard FX hold calculation: 31.95 / 1.02 -> 31.32', () => {
      // 31.95 / 1.02 = 31.323529... -> 31.32
      const holdAmount = new Decimal('31.95');
      const holdRatio = new Decimal('1.02');
      const estimatedBase = holdAmount.dividedBy(holdRatio);

      expect(roundCny(estimatedBase).toString()).toBe('31.32');
      expect(formatCny(estimatedBase)).toBe('31.32');

      // 1% cashback: 31.32 * 0.01 = 0.3132 -> 0.31
      const estimatedCashback = roundCny(new Decimal('31.32').times('0.01'));
      expect(estimatedCashback.toString()).toBe('0.31');
      expect(formatCny(estimatedCashback)).toBe('0.31');

      // Net budget deduction: 31.32 - 0.31 = 31.01
      const netAmount = new Decimal('31.32').minus(estimatedCashback);
      expect(formatCny(netAmount)).toBe('31.01');
    });

    it('should pad zeros in formatCny', () => {
      expect(formatCny('0')).toBe('0.00');
      expect(formatCny('5')).toBe('5.00');
      expect(formatCny('12.3')).toBe('12.30');
      expect(formatCny(0)).toBe('0.00');
    });
  });

  describe('roundRate & formatRate (6 decimal places)', () => {
    it('should format exchange rates with 6 decimal places and ROUND_HALF_UP', () => {
      expect(formatRate('7.2')).toBe('7.200000');
      expect(formatRate(7.2)).toBe('7.200000');

      // 31.32 / 4.35 = 7.200000
      const cny = new Decimal('31.32');
      const usd = new Decimal('4.35');
      const rate = cny.dividedBy(usd);
      expect(formatRate(rate)).toBe('7.200000');

      // ROUND_HALF_UP at 6th decimal place
      expect(formatRate('7.1234564')).toBe('7.123456');
      expect(formatRate('7.1234565')).toBe('7.123457');
      expect(roundRate('7.1234565').toString()).toBe('7.123457');
    });
  });

  describe('sumCny', () => {
    it('should sum array of MoneyInputs and round to 2 decimals', () => {
      const inputs = ['10.05', 20.005, new Decimal('0.005')];
      // 10.05 + 20.005 + 0.005 = 30.060 -> 30.06
      const total = sumCny(inputs);
      expect(total.toString()).toBe('30.06');
      expect(formatCny(total)).toBe('30.06');

      // Empty array should sum to 0
      expect(formatCny(sumCny([]))).toBe('0.00');

      // Split order total verification: 25.45 + 10.91 + 13.64 = 50.00
      expect(formatCny(sumCny(['25.45', '10.91', '13.64']))).toBe('50.00');
    });
  });

  describe('equalsCny', () => {
    it('should correctly compare financial amounts', () => {
      expect(equalsCny('31.01', 31.01)).toBe(true);
      expect(equalsCny('31.0100', '31.01')).toBe(true);
      expect(equalsCny('1.005', '1.01')).toBe(true);
      expect(equalsCny('1.004', '1.00')).toBe(true);
      expect(equalsCny('1.004', '1.01')).toBe(false);
      expect(equalsCny(0, '0.00')).toBe(true);
    });
  });

  describe('getLocalTodayDateStr & getLocalYearMonthStr', () => {
    it('should format local YYYY-MM-DD and YYYY-MM without UTC day shift', () => {
      const midnightLocal = new Date(2026, 10, 15, 0, 15, 0); // 2026-11-15 00:15 local
      expect(getLocalTodayDateStr(midnightLocal)).toBe('2026-11-15');
      expect(getLocalYearMonthStr(midnightLocal)).toBe('2026-11');
    });
  });
});
