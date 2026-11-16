import 'dart:io';

import 'package:jnigen/jnigen.dart';

Future<void> main() async {
  final packageRoot = Platform.script.resolve('..');
  final javaSourceDir = Directory.fromUri(
    packageRoot.resolve('android/app/src/main/java'),
  ).path;
  final outputFile = packageRoot.resolve('lib/src/android_native.g.dart');

  final androidHome = Platform.environment['ANDROID_HOME'] ??
      Platform.environment['ANDROID_SDK_ROOT'] ??
      (Platform.isWindows && Platform.environment['LOCALAPPDATA'] != null
          ? '${Platform.environment['LOCALAPPDATA']}\\Android\\Sdk'
          : null);

  final androidSdk = (androidHome != null && Directory(androidHome).existsSync())
      ? AndroidSdk(
          versions: const [36, 35, 34],
          sdkRoot: Uri.directory(androidHome),
        )
      : AndroidSdk(
          addGradleDeps: true,
          androidExample: packageRoot,
        );

  final generator = JniGenerator(
    input: Input(
      sourcePath: [Uri.file(javaSourceDir)],
      classes: ['com.example.geek_ledger_mobile.NativePlatformHelper'],
      androidSdk: androidSdk,
      summarizerCommand:
          'java -Duser.language=en -Duser.country=US -Dsun.stdout.encoding=UTF-8 -Dsun.stderr.encoding=UTF-8 -jar .dart_tool/jnigen/ApiSummarizer.jar',
    ),
    output: Output(
      dart: DartOutput(
        path: outputFile,
        structure: OutputStructure.singleFile,
      ),
      preamble: '// ignore_for_file: type=lint\n',
    ),
  );

  await generator.generate();
}
