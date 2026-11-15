import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');
const CORE_RS_DIR = __dirname;
const WASM_OUT_DIR = path.join(ROOT, 'packages/core/src/wasm');
const ANDROID_JNILIBS_DIR = path.join(ROOT, 'apps/mobile/android/app/src/main/jniLibs');

const ANDROID_TARGETS = [
  {
    abi: 'arm64-v8a',
    rustTarget: 'aarch64-linux-android',
    clangTarget: 'aarch64-linux-android24',
  },
  {
    abi: 'armeabi-v7a',
    rustTarget: 'armv7-linux-androideabi',
    clangTarget: 'armv7a-linux-androideabi24',
  },
  {
    abi: 'x86_64',
    rustTarget: 'x86_64-linux-android',
    clangTarget: 'x86_64-linux-android24',
  },
];

function run(cmd, args, opts = {}) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  return execFileSync(cmd, args, {
    cwd: ROOT,
    stdio: 'inherit',
    ...opts,
  });
}

function capture(cmd, args) {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function findCompilerBuiltinsLibRs(libSrc) {
  let cbLibRs = path.join(libSrc, 'compiler-builtins', 'compiler-builtins', 'src', 'lib.rs');
  if (!fs.existsSync(cbLibRs)) {
    const fallback = path.join(libSrc, 'compiler_builtins', 'src', 'lib.rs');
    if (fs.existsSync(fallback)) cbLibRs = fallback;
  }
  if (!fs.existsSync(cbLibRs)) {
    throw new Error(`Could not locate compiler-builtins/src/lib.rs under ${libSrc}`);
  }
  return cbLibRs;
}

function ensureNoStdSysroot(sysrootDir, targetTriple) {
  const coreRlib = path.join(sysrootDir, 'libcore.rlib');
  const cbRlib = path.join(sysrootDir, 'libcompiler_builtins.rlib');
  const allocRlib = path.join(sysrootDir, 'liballoc.rlib');

  if (fs.existsSync(coreRlib) && fs.existsSync(cbRlib) && fs.existsSync(allocRlib)) {
    return { coreRlib, cbRlib, allocRlib };
  }

  fs.mkdirSync(sysrootDir, { recursive: true });
  const rustSysroot = capture('rustc', ['--print', 'sysroot']);
  const libSrc = path.join(rustSysroot, 'lib', 'rustlib', 'src', 'rust', 'library');
  if (!fs.existsSync(libSrc)) {
    throw new Error(`rust-src not found at ${libSrc}. Run: rustup component add rust-src`);
  }

  const bootstrapEnv = { ...process.env, RUSTC_BOOTSTRAP: '1' };
  const commonFlags = [
    '--target', targetTriple,
    '--crate-type', 'rlib',
    '--edition=2024',
    '-C', 'opt-level=s',
    '-C', 'panic=abort',
    '-A', 'warnings',
  ];

  const cbLibRs = findCompilerBuiltinsLibRs(libSrc);

  run(
    'rustc',
    [
      ...commonFlags,
      '--crate-name', 'core',
      '-o', coreRlib,
      path.join(libSrc, 'core', 'src', 'lib.rs'),
    ],
    { env: bootstrapEnv }
  );

  run(
    'rustc',
    [
      ...commonFlags,
      '--crate-name', 'compiler_builtins',
      '--cfg', 'feature="compiler-builtins"',
      '--cfg', 'feature="rustc-dep-of-std"',
      '--cfg', 'feature="no-f16-f128"',
      '--extern', `core=${coreRlib}`,
      '-o', cbRlib,
      cbLibRs,
    ],
    { env: bootstrapEnv }
  );

  run(
    'rustc',
    [
      ...commonFlags,
      '--crate-name', 'alloc',
      '--extern', `core=${coreRlib}`,
      '--extern', `compiler_builtins=${cbRlib}`,
      '-o', allocRlib,
      path.join(libSrc, 'alloc', 'src', 'lib.rs'),
    ],
    { env: bootstrapEnv }
  );

  return { coreRlib, cbRlib, allocRlib };
}

function findNdkClangExecutable() {
  const sdkCandidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk'),
    path.join(os.homedir(), 'Android', 'Sdk'),
    path.join(os.homedir(), 'Library', 'Android', 'sdk'),
  ].filter(Boolean);

  const ndkDirs = [];
  if (process.env.ANDROID_NDK_HOME) ndkDirs.push(process.env.ANDROID_NDK_HOME);
  if (process.env.ANDROID_NDK_ROOT) ndkDirs.push(process.env.ANDROID_NDK_ROOT);
  for (const sdkDir of sdkCandidates) {
    const ndkParent = path.join(sdkDir, 'ndk');
    if (fs.existsSync(ndkParent)) {
      const versions = fs.readdirSync(ndkParent).sort().reverse();
      for (const v of versions) {
        ndkDirs.push(path.join(ndkParent, v));
      }
    }
  }

  const hostTag =
    process.platform === 'win32'
      ? 'windows-x86_64'
      : process.platform === 'darwin'
        ? 'darwin-x86_64'
        : 'linux-x86_64';
  const clangName = process.platform === 'win32' ? 'clang.exe' : 'clang';

  for (const ndkDir of ndkDirs) {
    const clangPath = path.join(
      ndkDir,
      'toolchains',
      'llvm',
      'prebuilt',
      hostTag,
      'bin',
      clangName
    );
    if (fs.existsSync(clangPath)) {
      return clangPath;
    }
  }
  return null;
}

function buildNativeDll() {
  run('cargo', [
    'build',
    '--release',
    '--manifest-path',
    path.join(CORE_RS_DIR, 'Cargo.toml'),
  ]);

  const ext =
    process.platform === 'win32'
      ? { src: 'ledger_core_rs.dll', dir: 'win64', dst: 'ledger_core_rs.dll' }
      : process.platform === 'darwin'
        ? { src: 'libledger_core_rs.dylib', dir: 'macos', dst: 'libledger_core_rs.dylib' }
        : { src: 'libledger_core_rs.so', dir: 'linux', dst: 'libledger_core_rs.so' };

  const libSrc = path.join(CORE_RS_DIR, 'target', 'release', ext.src);
  if (fs.existsSync(libSrc)) {
    const mobileNativeDir = path.join(ROOT, 'apps/mobile/native', ext.dir);
    fs.mkdirSync(mobileNativeDir, { recursive: true });
    fs.copyFileSync(libSrc, path.join(mobileNativeDir, ext.dst));
    console.log(`Copied native library to ${path.join(mobileNativeDir, ext.dst)}`);
  }
}

function buildAndroidLibs() {
  const clangExe = findNdkClangExecutable();
  if (!clangExe) {
    console.warn('Android NDK not found; skipping Android .so build.');
    return;
  }

  for (const target of ANDROID_TARGETS) {
    const sysrootDir = path.join(CORE_RS_DIR, 'target', `${target.rustTarget}-sysroot`);
    const { coreRlib, cbRlib, allocRlib } = ensureNoStdSysroot(
      sysrootDir,
      target.rustTarget
    );
    const outDir = path.join(ANDROID_JNILIBS_DIR, target.abi);
    fs.mkdirSync(outDir, { recursive: true });
    const outSo = path.join(outDir, 'libledger_core_rs.so');

    run('rustc', [
      '--target', target.rustTarget,
      '--crate-type', 'cdylib',
      '--crate-name', 'ledger_core_rs',
      '--edition=2024',
      '--cfg', 'ledger_no_std',
      '--check-cfg', 'cfg(ledger_no_std)',
      '--check-cfg', 'cfg(test)',
      '-C', 'opt-level=s',
      '-C', 'panic=abort',
      '-C', 'lto=thin',
      '-C', 'strip=symbols',
      '-C', `linker=${clangExe}`,
      '-C', `link-arg=--target=${target.clangTarget}`,
      '-C', 'link-arg=-Wl,--gc-sections',
      '-C', 'link-arg=-Wl,-z,max-page-size=16384',
      '-C', 'link-arg=-Wl,-soname,libledger_core_rs.so',
      '-C', 'link-arg=-lc',
      '-C', 'link-arg=-ldl',
      '-L', sysrootDir,
      '--extern', `core=${coreRlib}`,
      '--extern', `compiler_builtins=${cbRlib}`,
      '--extern', `alloc=${allocRlib}`,
      '-o', outSo,
      path.join(CORE_RS_DIR, 'src/lib.rs'),
    ]);

    const size = fs.statSync(outSo).size;
    console.log(`Built Android ${target.abi} (${size} bytes) at ${outSo}`);
  }
}

function buildWasm() {
  const wasmSysrootDir = path.join(CORE_RS_DIR, 'target/wasm-sysroot');
  const { coreRlib, cbRlib, allocRlib } = ensureNoStdSysroot(
    wasmSysrootDir,
    'wasm32-unknown-unknown'
  );
  fs.mkdirSync(WASM_OUT_DIR, { recursive: true });
  const wasmPath = path.join(WASM_OUT_DIR, 'ledger_core_rs.wasm');

  run('rustc', [
    '--target', 'wasm32-unknown-unknown',
    '--crate-type', 'cdylib',
    '--crate-name', 'ledger_core_rs',
    '--edition=2024',
    '-C', 'opt-level=s',
    '-C', 'panic=abort',
    '-C', 'lto=thin',
    '-C', 'link-arg=--no-entry',
    '-C', 'link-arg=--export=ledger_alloc',
    '-C', 'link-arg=--export=ledger_dealloc',
    '-C', 'link-arg=--export=ledger_invoke',
    '-C', 'link-arg=--export-memory',
    '-L', wasmSysrootDir,
    '--extern', `core=${coreRlib}`,
    '--extern', `compiler_builtins=${cbRlib}`,
    '--extern', `alloc=${allocRlib}`,
    '-o', wasmPath,
    path.join(CORE_RS_DIR, 'src/lib.rs'),
  ]);

  const wasmBytes = fs.readFileSync(wasmPath);
  const b64 = wasmBytes.toString('base64');
  const tsContent = `// Auto-generated by packages/core-rs/build-wasm.mjs — do not edit manually.\nexport const LEDGER_CORE_WASM_BASE64 =\n  '${b64}';\n`;
  fs.writeFileSync(path.join(WASM_OUT_DIR, 'wasm-binary.ts'), tsContent, 'utf8');
  console.log(`Built WASM (${wasmBytes.length} bytes) and updated packages/core/src/wasm/wasm-binary.ts`);
}

buildNativeDll();
buildAndroidLibs();
buildWasm();
