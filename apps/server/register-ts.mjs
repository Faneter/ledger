import { register } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('../../node_modules/typescript/lib/typescript.js');

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (err && err.code === 'ERR_MODULE_NOT_FOUND' && specifier.endsWith('.js')) {
      return nextResolve(specifier.slice(0, -3) + '.ts', context);
    }
    throw err;
  }
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.ts')) {
    const source = await readFile(fileURLToPath(url), 'utf8');
    const transpiled = ts.transpileModule(source, {
      fileName: fileURLToPath(url),
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    });
    return {
      format: 'module',
      shortCircuit: true,
      source: transpiled.outputText,
    };
  }
  return nextLoad(url, context);
}

// Register self when imported via --import
if (!globalThis.__TS_LOADER_REGISTERED__) {
  globalThis.__TS_LOADER_REGISTERED__ = true;
  register(import.meta.url);
}
