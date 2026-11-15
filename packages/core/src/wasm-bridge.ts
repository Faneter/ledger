import { LEDGER_CORE_WASM_BASE64 } from './wasm/wasm-binary.js';

interface RustWasmExports {
  memory: WebAssembly.Memory;
  ledger_alloc: (len: number) => number;
  ledger_dealloc: (ptr: number, len: number) => void;
  ledger_invoke: (reqPtr: number, reqLen: number, outLenPtr: number) => number;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8');

let cachedExports: RustWasmExports | null = null;

function decodeBase64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binStr = globalThis.atob(b64);
  const bytes = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) {
    bytes[i] = binStr.charCodeAt(i);
  }
  return bytes;
}

function getWasmExports(): RustWasmExports {
  if (cachedExports) {
    return cachedExports;
  }
  const wasmBytes = decodeBase64ToBytes(LEDGER_CORE_WASM_BASE64);
  const module = new WebAssembly.Module(wasmBytes);
  const instance = new WebAssembly.Instance(module, {});
  const exports = instance.exports as unknown as RustWasmExports;
  if (
    !exports.memory ||
    typeof exports.ledger_alloc !== 'function' ||
    typeof exports.ledger_dealloc !== 'function' ||
    typeof exports.ledger_invoke !== 'function'
  ) {
    throw new Error('Invalid ledger_core_rs.wasm exports');
  }
  cachedExports = exports;
  return cachedExports;
}

export function invokeRustCore<T = unknown>(
  payload: Record<string, unknown>
): T {
  const { memory, ledger_alloc, ledger_dealloc, ledger_invoke } =
    getWasmExports();
  const reqBytes = textEncoder.encode(JSON.stringify(payload));
  const reqLen = reqBytes.length;

  const reqPtr = ledger_alloc(reqLen) >>> 0;
  const outLenPtr = ledger_alloc(4) >>> 0;
  let respPtr = 0;
  let outLen = 0;

  try {
    new Uint8Array(memory.buffer, reqPtr, reqLen).set(reqBytes);
    respPtr = ledger_invoke(reqPtr, reqLen, outLenPtr) >>> 0;
    if (!respPtr) {
      throw new Error('Rust WASM core failed to allocate response buffer');
    }
    outLen = new DataView(memory.buffer).getUint32(outLenPtr, true);
    const respBytes = new Uint8Array(memory.buffer, respPtr, outLen);
    const respText = textDecoder.decode(respBytes);
    const parsed = JSON.parse(respText) as
      | { ok: true; data: T }
      | { ok: false; error: string };
    if (!parsed.ok) {
      throw new Error(parsed.error || 'Rust WASM core execution failed');
    }
    return parsed.data;
  } finally {
    if (respPtr) {
      ledger_dealloc(respPtr, outLen);
    }
    ledger_dealloc(outLenPtr, 4);
    ledger_dealloc(reqPtr, reqLen);
  }
}
