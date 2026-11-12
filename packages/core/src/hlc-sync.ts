import {
  SyncConflict,
  SyncOpLogEntry,
  ConflictType,
} from './types.js';

export interface MergeOpLogResult {
  mergedOps: SyncOpLogEntry[];
  winningEntities: Map<string, SyncOpLogEntry>;
  detectedConflicts: SyncConflict[];
}

/**
 * 混合逻辑时钟 (Hybrid Logical Clock, HLC)
 * 格式规范：`${timestampMs.toString().padStart(15, '0')}-${counter.toString(16).padStart(4, '0')}-${nodeId}`
 * 保证字典序（Lexicographical Order）与因果全序严格等价！
 */
export class HybridLogicalClock {
  public readonly nodeId: string;
  private lastPhysicalTimeMs: number;
  private counter: number;

  constructor(nodeId: string, initialHlc?: string) {
    this.nodeId = nodeId;
    if (initialHlc) {
      const parsed = HybridLogicalClock.parse(initialHlc);
      this.lastPhysicalTimeMs = parsed.timestampMs;
      this.counter = parsed.counter;
    } else {
      this.lastPhysicalTimeMs = 0;
      this.counter = 0;
    }
  }

  /**
   * 生成本地新混合逻辑时钟 HLC
   */
  public now(physicalTimeMs?: number): string {
    const pt = physicalTimeMs ?? Date.now();
    if (pt > this.lastPhysicalTimeMs) {
      this.lastPhysicalTimeMs = pt;
      this.counter = 0;
    } else {
      this.counter += 1;
    }
    return this.format();
  }

  /**
   * 接收远端混合逻辑时钟 HLC，并单调向前推进本地时钟
   */
  public receive(remoteHlc: string, physicalTimeMs?: number): string {
    const remote = HybridLogicalClock.parse(remoteHlc);
    const pt = physicalTimeMs ?? Date.now();
    const maxTime = Math.max(this.lastPhysicalTimeMs, remote.timestampMs, pt);

    if (maxTime === this.lastPhysicalTimeMs && maxTime === remote.timestampMs) {
      this.counter = Math.max(this.counter, remote.counter) + 1;
    } else if (maxTime === this.lastPhysicalTimeMs) {
      this.counter += 1;
    } else if (maxTime === remote.timestampMs) {
      this.counter = remote.counter + 1;
    } else {
      this.counter = 0;
    }

    this.lastPhysicalTimeMs = maxTime;
    return this.format();
  }

  /**
   * 解析 HLC 字符串为结构化三元组
   */
  public static parse(hlc: string): {
    timestampMs: number;
    counter: number;
    nodeId: string;
  } {
    const firstDash = hlc.indexOf('-');
    const secondDash = hlc.indexOf('-', firstDash + 1);

    if (firstDash === -1 || secondDash === -1) {
      throw new Error(`Invalid HLC format: "${hlc}"`);
    }

    const tsStr = hlc.slice(0, firstDash);
    const counterStr = hlc.slice(firstDash + 1, secondDash);
    const nodeId = hlc.slice(secondDash + 1);

    const timestampMs = parseInt(tsStr, 10);
    const counter = parseInt(counterStr, 16);

    if (Number.isNaN(timestampMs) || Number.isNaN(counter)) {
      throw new Error(`Invalid HLC numbers in: "${hlc}"`);
    }

    return { timestampMs, counter, nodeId };
  }

  /**
   * 严格全序比较两个 HLC 字符串
   * @returns -1 (a < b) | 0 (a === b) | 1 (a > b)
   */
  public static compare(a: string, b: string): number {
    if (a === b) return 0;
    const parsedA = HybridLogicalClock.parse(a);
    const parsedB = HybridLogicalClock.parse(b);

    if (parsedA.timestampMs !== parsedB.timestampMs) {
      return parsedA.timestampMs < parsedB.timestampMs ? -1 : 1;
    }
    if (parsedA.counter !== parsedB.counter) {
      return parsedA.counter < parsedB.counter ? -1 : 1;
    }
    if (parsedA.nodeId !== parsedB.nodeId) {
      return parsedA.nodeId < parsedB.nodeId ? -1 : 1;
    }
    return 0;
  }

  private format(): string {
    const tsStr = this.lastPhysicalTimeMs.toString().padStart(15, '0');
    const countStr = (this.counter & 0xffff).toString(16).padStart(4, '0');
    return `${tsStr}-${countStr}-${this.nodeId}`;
  }
}

/**
 * 提取交易负载中的关联优惠券 ID
 */
function extractAppliedVoucherId(payload: any): string | number | null {
  if (!payload || typeof payload !== 'object') return null;
  return (
    payload.appliedVoucherId ??
    payload.applied_voucher_id ??
    payload.header?.appliedVoucherId ??
    payload.header?.applied_voucher_id ??
    null
  );
}

/**
 * 提取交易 ID
 */
function extractTransactionId(op: SyncOpLogEntry, payload: any): string {
  return payload?.header?.id ?? payload?.id ?? op.entity_id;
}

/**
 * 分布式操作变更日志合并与语义冲突检测器
 *
 * 核心机制：
 * 1. 按 HLC 去重（相同 HLC 幂等忽略）并按严格全序升序排列日志；
 * 2. 以 `${entity_type}:${entity_id}` 为键应用 LWW (Last-Write-Wins) 计算胜出聚合根状态；
 * 3. 语义冲突检测 1：并发修改同一笔交易或外币清算冲突 (CONCURRENT_TX_EDIT / CONCURRENT_FX_SETTLE)；
 * 4. 语义冲突检测 2：多端离线重复核销同一张优惠券冲突 (VOUCHER_DOUBLE_SPEND)。
 */
export function mergeOpLogEntries(
  existingOps: SyncOpLogEntry[],
  incomingOps: SyncOpLogEntry[]
): MergeOpLogResult {
  // 1. 去重并全序排序
  const uniqueOpsMap = new Map<string, SyncOpLogEntry>();

  for (const op of existingOps) {
    uniqueOpsMap.set(op.hlc, op);
  }
  for (const op of incomingOps) {
    uniqueOpsMap.set(op.hlc, op);
  }

  const mergedOps = Array.from(uniqueOpsMap.values()).sort((a, b) =>
    HybridLogicalClock.compare(a.hlc, b.hlc)
  );

  // 2. 计算各实体的最新胜出状态 (LWW)
  const winningEntities = new Map<string, SyncOpLogEntry>();
  for (const op of mergedOps) {
    const entityKey = `${op.entity_type}:${op.entity_id}`;
    winningEntities.set(entityKey, op);
  }

  const detectedConflicts: SyncConflict[] = [];

  // 3. 语义冲突检测 1：检查同一交易在现有与传入集合中是否存在不同 node_id 的并发修改
  const existingTxMap = new Map<string, SyncOpLogEntry>();
  for (const op of existingOps) {
    if (op.entity_type === 'TRANSACTION') {
      const cur = existingTxMap.get(op.entity_id);
      if (!cur || HybridLogicalClock.compare(op.hlc, cur.hlc) > 0) {
        existingTxMap.set(op.entity_id, op);
      }
    }
  }

  const incomingTxMap = new Map<string, SyncOpLogEntry>();
  for (const op of incomingOps) {
    if (op.entity_type === 'TRANSACTION') {
      const cur = incomingTxMap.get(op.entity_id);
      if (!cur || HybridLogicalClock.compare(op.hlc, cur.hlc) > 0) {
        incomingTxMap.set(op.entity_id, op);
      }
    }
  }

  for (const [entityId, existOp] of existingTxMap.entries()) {
    const incomingOp = incomingTxMap.get(entityId);
    if (incomingOp) {
      if (
        existOp.node_id !== incomingOp.node_id &&
        existOp.hlc !== incomingOp.hlc
      ) {
        const cmp = HybridLogicalClock.compare(existOp.hlc, incomingOp.hlc);
        const winnerOp = cmp >= 0 ? existOp : incomingOp;
        const loserOp = cmp >= 0 ? incomingOp : existOp;

        let winnerPayload: any = {};
        let loserPayload: any = {};
        try {
          winnerPayload = JSON.parse(winnerOp.payload_json);
        } catch {}
        try {
          loserPayload = JSON.parse(loserOp.payload_json);
        } catch {}

        const winnerStatus =
          winnerPayload.settlement_status ??
          winnerPayload.header?.settlement_status;
        const loserStatus =
          loserPayload.settlement_status ??
          loserPayload.header?.settlement_status;

        const isFxSettle =
          winnerStatus !== undefined &&
          loserStatus !== undefined &&
          winnerStatus !== loserStatus;

        const conflictType: ConflictType = isFxSettle
          ? 'CONCURRENT_FX_SETTLE'
          : 'CONCURRENT_TX_EDIT';

        detectedConflicts.push({
          id: `conflict_${conflictType}_${entityId}_${loserOp.hlc}`,
          conflict_type: conflictType,
          entity_id: entityId,
          winner_hlc: winnerOp.hlc,
          loser_hlc: loserOp.hlc,
          winner_summary: `Winner (Node ${winnerOp.node_id}) updated transaction ${entityId} at HLC ${winnerOp.hlc}`,
          loser_summary: `Loser (Node ${loserOp.node_id}) updated transaction ${entityId} at HLC ${loserOp.hlc}`,
          loser_payload_json: loserOp.payload_json,
          status: 'PENDING',
          created_at: new Date().toISOString(),
        });
      }
    }
  }

  // 4. 语义冲突检测 2：多端离线重复核销同一张优惠券 (VOUCHER_DOUBLE_SPEND)
  const voucherSpends = new Map<string, { op: SyncOpLogEntry; txId: string }[]>();

  for (const op of winningEntities.values()) {
    if (op.entity_type === 'TRANSACTION' && op.op_type === 'UPSERT') {
      let payload: any = {};
      try {
        payload = JSON.parse(op.payload_json);
      } catch {}
      const voucherId = extractAppliedVoucherId(payload);
      if (voucherId != null && voucherId !== '') {
        const vKey = String(voucherId);
        const txId = extractTransactionId(op, payload);
        if (!voucherSpends.has(vKey)) {
          voucherSpends.set(vKey, []);
        }
        voucherSpends.get(vKey)!.push({ op, txId });
      }
    }
  }

  for (const [vKey, spends] of voucherSpends.entries()) {
    // 过滤出不同交易 ID 的记录
    const uniqueSpends: { op: SyncOpLogEntry; txId: string }[] = [];
    const seenTx = new Set<string>();
    for (const s of spends) {
      if (!seenTx.has(s.txId)) {
        seenTx.add(s.txId);
        uniqueSpends.push(s);
      }
    }

    if (uniqueSpends.length > 1) {
      // 较早 HLC 判定为首销获胜方，较晚者产生双重核销冲突
      uniqueSpends.sort((a, b) =>
        HybridLogicalClock.compare(a.op.hlc, b.op.hlc)
      );
      const winner = uniqueSpends[0];
      for (let i = 1; i < uniqueSpends.length; i++) {
        const loser = uniqueSpends[i];
        detectedConflicts.push({
          id: `conflict_voucher_${vKey}_${loser.txId}`,
          conflict_type: 'VOUCHER_DOUBLE_SPEND',
          entity_id: vKey,
          winner_hlc: winner.op.hlc,
          loser_hlc: loser.op.hlc,
          winner_summary: `Voucher ${vKey} successfully redeemed by transaction ${winner.txId} at HLC ${winner.op.hlc}`,
          loser_summary: `Voucher ${vKey} duplicate spend attempt by transaction ${loser.txId} at HLC ${loser.op.hlc}`,
          loser_payload_json: loser.op.payload_json,
          status: 'PENDING',
          created_at: new Date().toISOString(),
        });
      }
    }
  }

  detectedConflicts.sort((a, b) => a.id.localeCompare(b.id));

  return {
    mergedOps,
    winningEntities,
    detectedConflicts,
  };
}
