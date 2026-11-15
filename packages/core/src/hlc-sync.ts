import {
  SyncConflict,
  SyncOpLogEntry,
} from './types.js';
import { invokeRustCore } from './wasm-bridge.js';

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
    const res = invokeRustCore<{
      hlc: string;
      lastPhysicalTimeMs: number;
      counter: number;
    }>({
      op: 'hlc_now',
      nodeId: this.nodeId,
      lastPhysicalTimeMs: this.lastPhysicalTimeMs,
      counter: this.counter,
      physicalTimeMs: physicalTimeMs ?? Date.now(),
    });
    this.lastPhysicalTimeMs = res.lastPhysicalTimeMs;
    this.counter = res.counter;
    return res.hlc;
  }

  /**
   * 接收远端混合逻辑时钟 HLC，并单调向前推进本地时钟
   */
  public receive(remoteHlc: string, physicalTimeMs?: number): string {
    const res = invokeRustCore<{
      hlc: string;
      lastPhysicalTimeMs: number;
      counter: number;
    }>({
      op: 'hlc_receive',
      nodeId: this.nodeId,
      lastPhysicalTimeMs: this.lastPhysicalTimeMs,
      counter: this.counter,
      remoteHlc,
      physicalTimeMs: physicalTimeMs ?? Date.now(),
    });
    this.lastPhysicalTimeMs = res.lastPhysicalTimeMs;
    this.counter = res.counter;
    return res.hlc;
  }

  /**
   * 解析 HLC 字符串为结构化三元组
   */
  public static parse(hlc: string): {
    timestampMs: number;
    counter: number;
    nodeId: string;
  } {
    return invokeRustCore({ op: 'hlc_parse', hlc });
  }

  /**
   * 严格全序比较两个 HLC 字符串
   * @returns -1 (a < b) | 0 (a === b) | 1 (a > b)
   */
  public static compare(a: string, b: string): number {
    return invokeRustCore<number>({ op: 'hlc_compare', a, b });
  }
}

/**
 * 分布式操作变更日志合并与语义冲突检测器
 */
export function mergeOpLogEntries(
  existingOps: SyncOpLogEntry[],
  incomingOps: SyncOpLogEntry[]
): MergeOpLogResult {
  const res = invokeRustCore<{
    mergedOps: SyncOpLogEntry[];
    winningEntities: Record<string, SyncOpLogEntry>;
    detectedConflicts: SyncConflict[];
  }>({
    op: 'merge_oplog_entries',
    existingOps,
    incomingOps,
    nowIso: new Date().toISOString(),
  });

  return {
    mergedOps: res.mergedOps,
    winningEntities: new Map<string, SyncOpLogEntry>(
      Object.entries(res.winningEntities)
    ),
    detectedConflicts: res.detectedConflicts,
  };
}
