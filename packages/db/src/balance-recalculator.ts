import type { DatabaseSync } from 'node:sqlite';
import { Decimal, toDecimal, formatCny } from '@ledger/core';

interface AccountBalanceState {
  id: string;
  book: Decimal;
  frozen: Decimal;
}

/**
 * 核心余额确定性重算器 (Deterministic Balance Recalculator)
 *
 * 核心财务不变量：
 * 账户的 book_balance 与 frozen_amount 永远由 accounts.initial_balance 加上所有未软删除（is_deleted = 0）
 * 的 transaction_headers 确定性重算得出，杜绝任何中间状态污染与累加舍入漂移！
 *
 * @param db DatabaseSync 实例
 */
export function recalculateAllAccounts(db: DatabaseSync): void {
  // 1. 初始化每个账户的基准状态：book = initial_balance, frozen = 0
  const accountRows = db
    .prepare('SELECT id, initial_balance FROM accounts')
    .all() as Array<{
    id: string;
    initial_balance: number | string | null;
  }>;

  const stateMap = new Map<string, AccountBalanceState>();
  for (const acc of accountRows) {
    stateMap.set(acc.id, {
      id: acc.id,
      book: toDecimal(acc.initial_balance ?? 0),
      frozen: new Decimal(0),
    });
  }

  // 2. 缓存所有卡券的 acquire_cost
  const voucherRows = db
    .prepare('SELECT id, acquire_cost FROM vouchers')
    .all() as Array<{
    id: number;
    acquire_cost: number | string | null;
  }>;
  const voucherCostMap = new Map<number, Decimal>();
  for (const v of voucherRows) {
    voucherCostMap.set(v.id, toDecimal(v.acquire_cost ?? 0));
  }

  // 3. 顺序遍历所有未软删除的交易流水
  const txRows = db
    .prepare(
      `
    SELECT 
      id,
      tx_type,
      account_id,
      target_account_id,
      total_gross,
      total_net,
      settlement_status,
      hold_amount_cny,
      applied_voucher_id
    FROM transaction_headers
    WHERE is_deleted = 0
    ORDER BY tx_date ASC, tx_timestamp ASC, id ASC
  `
    )
    .all() as Array<{
    id: string;
    tx_type: string;
    account_id: string;
    target_account_id: string | null;
    total_gross: number | string;
    total_net: number | string;
    settlement_status: string;
    hold_amount_cny: number | string | null;
    applied_voucher_id: number | null;
  }>;

  for (const tx of txRows) {
    const acc = stateMap.get(tx.account_id);
    if (!acc) continue;

    if (tx.tx_type === 'EXPENSE') {
      if (tx.settlement_status === 'PENDING_HOLD') {
        // 预授权挂起态：不扣账面余额，仅冻结 102% 额度
        acc.frozen = acc.frozen.plus(toDecimal(tx.hold_amount_cny ?? 0));
      } else if (tx.settlement_status === 'SETTLED') {
        // 已清算锁定态：扣除实际从账户划出的现金
        let cashDeducted = toDecimal(tx.total_net);
        if (tx.applied_voucher_id != null) {
          const cost = voucherCostMap.get(tx.applied_voucher_id) ?? new Decimal(0);
          // 若关联了有偿立减金，购券成本已在 VOUCHER_BUY 时扣过，本次实际出资为 total_net - acquire_cost
          cashDeducted = cashDeducted.minus(cost);
        }
        acc.book = acc.book.minus(cashDeducted);
      }
      // REFUNDED 状态不扣除 book 也不占用 frozen
    } else if (tx.tx_type === 'INCOME' || tx.tx_type === 'CASHBACK_OFFSET') {
      acc.book = acc.book.plus(toDecimal(tx.total_net));
    } else if (tx.tx_type === 'VOUCHER_BUY') {
      acc.book = acc.book.minus(toDecimal(tx.total_net));
    } else if (tx.tx_type === 'TRANSFER') {
      // 来源账户扣实付 net
      acc.book = acc.book.minus(toDecimal(tx.total_net));
      // 目标账户增 gross
      if (tx.target_account_id) {
        const targetAcc = stateMap.get(tx.target_account_id);
        if (targetAcc) {
          targetAcc.book = targetAcc.book.plus(toDecimal(tx.total_gross));
        }
      }
    }
  }

  // 4. 写回 accounts 表
  const updateStmt = db.prepare(`
    UPDATE accounts 
    SET book_balance = ?, frozen_amount = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  for (const state of stateMap.values()) {
    updateStmt.run(
      formatCny(state.book),
      formatCny(state.frozen),
      state.id
    );
  }
}
