import 'dart:io';

import 'package:ffigen/ffigen.dart';

Future<void> main() async {
  final packageRoot = Platform.script.resolve('..');
  final headerUri = packageRoot.resolve('../../packages/core-rs/include/ledger_core_rs.h');
  final outputUri = packageRoot.resolve('lib/src/rust_bindings.g.dart');

  const allowedFunctions = <String>{
    'ledger_alloc',
    'ledger_dealloc',
    'ledger_invoke',
  };

  final generator = FfiGenerator(
    output: Output(
      dart: DartOutput(path: outputUri),
      style: const DynamicLibraryBindings(
        wrapperName: 'LedgerCoreRsBindings',
        wrapperDocComment: 'Generated FFI bindings for packages/core-rs C ABI.',
      ),
      preamble: '// ignore_for_file: type=lint\n',
    ),
    input: Input(
      entryPoints: [headerUri],
    ),
    visitors: [
      Visitor(
        func: (node) {
          if (allowedFunctions.contains(node.originalName)) {
            node.isIncluded = true;
          }
        },
      ),
    ],
  );

  await generator.generate();
}
