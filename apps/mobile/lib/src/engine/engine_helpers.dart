part of '../ledger_engine.dart';

void _writeAtomicFileSync(String path, String encoded, String tmpPath) {
  final file = File(path);
  final dir = file.parent;
  if (!dir.existsSync()) {
    dir.createSync(recursive: true);
  }
  final tmpFile = File(tmpPath);
  tmpFile.writeAsStringSync(encoded, flush: true);
  if (file.existsSync()) {
    try {
      tmpFile.renameSync(file.path);
      return;
    } catch (_) {
      // Fallback on filesystems disallowing overwrite on rename
    }
  }
  file.writeAsStringSync(encoded, flush: true);
  if (tmpFile.existsSync()) {
    try {
      tmpFile.deleteSync();
    } catch (_) {}
  }
}

Future<Map<String, dynamic>> _defaultJsonHttpPost(
  Uri uri,
  Map<String, dynamic> body,
) async {
  final client = HttpClient()
    ..connectionTimeout = const Duration(seconds: 5);
  try {
    final req = await client.postUrl(uri);
    req.headers.contentType = ContentType.json;
    req.headers.set(HttpHeaders.acceptHeader, 'application/json');
    req.write(jsonEncode(body));
    final resp = await req.close().timeout(const Duration(seconds: 8));
    final respBody = await resp.transform(utf8.decoder).join();
    if (resp.statusCode >= 400) {
      var msg = 'HTTP ${resp.statusCode}';
      if (respBody.isNotEmpty) {
        try {
          final parsed = jsonDecode(respBody);
          if (parsed is Map && parsed['error'] != null) {
            msg = '${parsed['error']} (HTTP ${resp.statusCode})';
          }
        } catch (_) {}
      }
      throw HttpException(msg, uri: uri);
    }
    if (respBody.trim().isEmpty) {
      return <String, dynamic>{};
    }
    final decoded = jsonDecode(respBody);
    if (decoded is Map) {
      return Map<String, dynamic>.from(decoded);
    }
    throw const FormatException('同步服务端返回的响应格式无效');
  } finally {
    client.close(force: true);
  }
}

/// Deep-copies a JSON-compatible dynamic structure.
dynamic _deepClone(dynamic value) => jsonDecode(jsonEncode(value));

Map<String, dynamic> _cloneMap(Map<String, dynamic> map) =>
    Map<String, dynamic>.from(_deepClone(map) as Map<dynamic, dynamic>);

List<Map<String, dynamic>> _cloneListOfMaps(
  List<Map<String, dynamic>> list,
) =>
    list.map(_cloneMap).toList();

bool _asBool(dynamic v, {bool fallback = false}) {
  if (v is bool) return v;
  if (v is num) return v != 0;
  if (v is String) return v == '1' || v.toLowerCase() == 'true';
  return fallback;
}

int _asInt(dynamic v, [int fallback = 0]) {
  if (v is int) return v;
  if (v is num) return v.toInt();
  if (v is String) {
    final trimmed = v.trim();
    final i = int.tryParse(trimmed);
    if (i != null) return i;
    final d = double.tryParse(trimmed);
    if (d != null) return d.toInt();
  }
  return fallback;
}

int? _asNullableInt(dynamic v) {
  if (v == null) return null;
  if (v is String && v.trim().isEmpty) return null;
  return _asInt(v, 0);
}

String _asStr(dynamic v, [String fallback = '']) {
  if (v == null) return fallback;
  return v.toString();
}

String? _asNullableStr(dynamic v) {
  if (v == null) return null;
  final s = v.toString();
  return s.isEmpty ? null : s;
}

/// Exact integer-cents fixed-point helpers (zero binary floating point).
class _FixedMath {
  static BigInt toCents(RustCoreBridge bridge, Object value) {
    final formatted = bridge.formatCny(value);
    return BigInt.parse(formatted.replaceAll('.', ''));
  }

  static String fromCents(BigInt cents) {
    final neg = cents.isNegative;
    final absVal = cents.abs();
    final major = absVal ~/ BigInt.from(100);
    final minor = (absVal % BigInt.from(100)).toString().padLeft(2, '0');
    return '${neg ? '-' : ''}$major.$minor';
  }

  static BigInt divRoundHalfUp(BigInt numerator, BigInt denominator) {
    if (denominator == BigInt.zero) {
      throw ArgumentError('Division by zero');
    }
    final isNeg = (numerator < BigInt.zero) != (denominator < BigInt.zero);
    final a = numerator.abs();
    final b = denominator.abs();
    final q = a ~/ b;
    final r = a % b;
    final roundedAbs = (r * BigInt.two >= b) ? q + BigInt.one : q;
    return isNeg ? -roundedAbs : roundedAbs;
  }

  static BigInt mulDivCentsRoundHalfUp(
    BigInt value,
    BigInt numerator,
    BigInt denominator,
  ) =>
      divRoundHalfUp(value * numerator, denominator);

  /// Parses an arbitrary non-exponential decimal string into `(scaledInt, scale)`.
  static ({BigInt coeff, int scale}) _parseDecimalParts(String raw) {
    final trimmed = raw.trim();
    if (trimmed.isEmpty) {
      return (coeff: BigInt.zero, scale: 0);
    }
    final neg = trimmed.startsWith('-');
    final body =
        (neg || trimmed.startsWith('+')) ? trimmed.substring(1) : trimmed;
    final dotIdx = body.indexOf('.');
    if (dotIdx == -1) {
      final v = BigInt.parse(body.isEmpty ? '0' : body);
      return (coeff: neg ? -v : v, scale: 0);
    }
    final intPart = body.substring(0, dotIdx);
    final fracPart = body.substring(dotIdx + 1);
    final combined = '${intPart.isEmpty ? '0' : intPart}$fracPart';
    final v = BigInt.parse(combined);
    return (coeff: neg ? -v : v, scale: fracPart.length);
  }

  /// Multiplies two arbitrary decimal strings and rounds HALF_UP to 2 decimals.
  static String mulToCny(RustCoreBridge bridge, String a, String b) {
    final pa = _parseDecimalParts(a);
    final pb = _parseDecimalParts(b);
    final prod = pa.coeff * pb.coeff;
    final totalScale = pa.scale + pb.scale;
    if (totalScale <= 2) {
      final factor = BigInt.from(10).pow(2 - totalScale);
      return bridge.formatCny(fromCents(prod * factor));
    }
    final divisor = BigInt.from(10).pow(totalScale - 2);
    final cents = divRoundHalfUp(prod, divisor);
    return bridge.formatCny(fromCents(cents));
  }
}
