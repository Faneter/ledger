import 'package:flutter/services.dart';

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

/// Platform channel bridge to native Android storage path and Storage Access Framework
/// (`ACTION_OPEN_DOCUMENT` / `ACTION_CREATE_DOCUMENT`) with zero third-party plugins.
class MobilePlatformBridge {
  MobilePlatformBridge._();

  static const MethodChannel _channel = MethodChannel('geek_ledger/platform');

  static Future<String?> getStorageFilePath() async {
    try {
      final path = await _channel.invokeMethod<String>('getStoragePath');
      if (path != null && path.trim().isNotEmpty) {
        return path.trim();
      }
    } on MissingPluginException {
      return null;
    } catch (_) {
      return null;
    }
    return null;
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
