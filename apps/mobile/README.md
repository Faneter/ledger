# Geek Student Ledger — Flutter Mobile (`apps/mobile`)

This Flutter application executes **bit-identical** ledger business logic to the Web (`@ledger/client`) and Server (`@ledger/server` + `@ledger/db`) by calling the shared Rust Core Engine (`packages/core-rs`) over `dart:ffi` with **zero third-party pub.dev dependencies**.

## Architecture

- `packages/core-rs/` — Single source of truth for 28-digit `ROUND_HALF_UP` fixed-point money arithmetic, DSL parser, discount split allocator, voucher carryover math, Mastercard FX lifecycle, and Hybrid Logical Clock (HLC) LWW merge.
- `apps/mobile/lib/src/rust_bridge.dart` — Zero-dependency `dart:ffi` bridge binding `ledger_alloc`, `ledger_invoke`, and `ledger_dealloc` from `ledger_core_rs.dll` (`.so` / `.dylib` on mobile/macOS).
- `apps/mobile/lib/src/ledger_engine.dart` — Stateful mobile repository & sync engine (`FlutterLedgerEngine`), unified with `LocalLedgerEngine` (Web) and `LedgerRepository` (Server).
- `apps/mobile/lib/main.dart` — Material 3 mobile UI connected to `FlutterLedgerEngine`.

## Build Native Library & Run Golden Tests

From the repository root:

```powershell
# Build native DLL + WASM bundle
pnpm build:core-rs

# Run standalone Dart FFI golden tests against docs/golden_test_cases.json
dart apps/mobile/test/golden_test.dart
```

To run the Flutter app on a connected device or Windows desktop outside restricted sandboxes:

```powershell
cd apps/mobile
flutter create --platforms=windows,android .
flutter run
```
