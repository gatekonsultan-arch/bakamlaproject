import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

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

  Future<Map<String, dynamic>> _send(Future<http.Response> Function() req) async {
    http.Response res;
    try {
      res = await req().timeout(const Duration(seconds: 25));
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

  /// URL absolut untuk unduhan (mis. CSV). Token dikirim via header oleh pemanggil.
  Uri url(String path, [Map<String, String>? query]) => _uri(path, query);
}
