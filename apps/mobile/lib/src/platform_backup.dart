import 'dart:io';

import 'package:flutter/services.dart';
import 'package:jni/jni.dart';

import 'android_native.g.dart';

class PickedBackupFile {
  const PickedBackupFile({
    required this.name,
    required this.content,
  });

  final String name;
  final String content;
}

typedef JsonFilePicker = Future<PickedBackupFile?> Function();
typedef JsonFileSaver = Future<String?> Function(
  String suggestedFileName,
  String jsonContent,
);

/// Native Android bridge using synchronous `jnigen` bindings for startup path & Monet seed,
/// and `MethodChannel` Storage Access Framework (`ACTION_OPEN_DOCUMENT` / `ACTION_CREATE_DOCUMENT`)
/// for Activity-result file pickers.
class MobilePlatformBridge {
  MobilePlatformBridge._();

  static const MethodChannel _channel = MethodChannel('geek_ledger/platform');

  static String? getStorageFilePathSync() {
    if (!Platform.isAndroid) return null;
    try {
      final path = NativePlatformHelper.storagePath?.toDartString(
        releaseOriginal: true,
      );
      if (path != null && path.trim().isNotEmpty) {
        return path.trim();
      }
    } catch (_) {
      return null;
    }
    return null;
  }

  static int? getMonetSeedColorSync() {
    if (!Platform.isAndroid) return null;
    try {
      final argb = NativePlatformHelper.monetSeedColor;
      return argb == 0 ? null : argb;
    } catch (_) {
      return null;
    }
  }

  static Future<PickedBackupFile?> pickJsonFile() async {
    final res = await _channel.invokeMethod<Map<dynamic, dynamic>>(
      'pickJsonFile',
    );
    if (res == null) return null;
    final content = res['content'];
    if (content is! String) return null;
    return PickedBackupFile(
      name: (res['name'] as String?) ?? 'backup.json',
      content: content,
    );
  }

  static Future<String?> saveJsonFile(
    String suggestedFileName,
    String jsonContent,
  ) async {
    final res = await _channel.invokeMethod<Map<dynamic, dynamic>>(
      'saveJsonFile',
      <String, dynamic>{
        'fileName': suggestedFileName,
        'content': jsonContent,
      },
    );
    if (res == null) return null;
    return (res['name'] as String?) ?? suggestedFileName;
  }
}
