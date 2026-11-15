import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';

import '../config.dart';

class ApiException implements Exception {
  final int status;
  final String message;
  final Map<String, dynamic> data;
  ApiException(this.status, this.message, [this.data = const {}]);
  @override
  String toString() => message;
}

/// Klien HTTP sederhana. Token JWT disisipkan otomatis.
class Api {
  Api._();
  static final Api instance = Api._();

  String? token;

  /// Dipanggil saat server membalas 401 (sesi habis / dicabut).
  void Function()? onUnauthorized;

  Uri _uri(String path, [Map<String, String>? query]) {
    final base = apiBaseUrl.isEmpty ? Uri.base.origin : apiBaseUrl;
    return Uri.parse('$base/api$path').replace(
      queryParameters: (query == null || query.isEmpty) ? null : query,
    );
  }

  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        if (token != null) 'Authorization': 'Bearer $token',
      };

  Future<Map<String, dynamic>> get(String path, {Map<String, String>? query}) =>
      _send(() => http.get(_uri(path, query), headers: _headers));

  Future<Map<String, dynamic>> post(String path, [Object? body]) =>
      _send(() => http.post(_uri(path), headers: _headers, body: jsonEncode(body ?? {})));

  Future<Map<String, dynamic>> put(String path, [Object? body]) =>
      _send(() => http.put(_uri(path), headers: _headers, body: jsonEncode(body ?? {})));

  Future<Map<String, dynamic>> _send(Future<http.Response> Function() req,
      {bool longTimeout = false}) async {
    http.Response res;
    try {
      res = await req().timeout(Duration(seconds: longTimeout ? 180 : 25));
    } on TimeoutException {
      throw ApiException(0, 'Koneksi ke server terlalu lama. Periksa internet Anda.');
    } catch (_) {
      throw ApiException(0, 'Tidak dapat terhubung ke server. Periksa internet Anda.');
    }

    Map<String, dynamic> data = {};
    if (res.body.isNotEmpty) {
      try {
        final decoded = jsonDecode(utf8.decode(res.bodyBytes));
        if (decoded is Map<String, dynamic>) data = decoded;
      } catch (_) {}
    }
    if (res.statusCode >= 200 && res.statusCode < 300) return data;

    if (res.statusCode == 401 && token != null) onUnauthorized?.call();
    var msg = (data['message'] as String?) ?? 'Terjadi kesalahan (${res.statusCode})';
    final errors = data['errors'];
    if (errors is List && errors.isNotEmpty) {
      msg = '$msg: ${errors.map((e) => e['message']).join(', ')}';
    }
    throw ApiException(res.statusCode, msg, data);
  }

  Future<Map<String, dynamic>> delete(String path) =>
      _send(() => http.delete(_uri(path), headers: _headers));

  /// Upload file (multipart). [files] berisi (nama field, nama file, bytes).
  Future<Map<String, dynamic>> upload(
    String path,
    List<({String field, String filename, List<int> bytes})> files, {
    Map<String, String> fields = const {},
  }) {
    return _send(() async {
      final req = http.MultipartRequest('POST', _uri(path));
      if (token != null) req.headers['Authorization'] = 'Bearer $token';
      req.fields.addAll(fields);
      for (final f in files) {
        req.files.add(http.MultipartFile.fromBytes(f.field, f.bytes,
            filename: f.filename, contentType: _imageType(f.filename)));
      }
      return http.Response.fromStream(await req.send());
    }, longTimeout: true);
  }

  /// Jenis file dari ekstensi (server tetap memvalidasi isi file).
  static MediaType _imageType(String name) {
    final ext = name.toLowerCase().split('.').last;
    return switch (ext) {
      'png' => MediaType('image', 'png'),
      'webp' => MediaType('image', 'webp'),
      'heic' || 'heif' => MediaType('image', 'heic'),
      _ => MediaType('image', 'jpeg'),
    };
  }

  /// URL absolut dari path relatif server (mis. URL foto bertanda tangan).
  String abs(String? path) {
    if (path == null || path.isEmpty) return '';
    if (path.startsWith('http')) return path;
    final base = apiBaseUrl.isEmpty ? Uri.base.origin : apiBaseUrl;
    return '$base$path';
  }
}
