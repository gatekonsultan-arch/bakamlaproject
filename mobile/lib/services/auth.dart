import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/models.dart';
import 'api.dart';

/// Menyimpan sesi login. Catatan: untuk keamanan lebih tinggi di HP,
/// ganti shared_preferences dengan flutter_secure_storage.
class AuthService extends ChangeNotifier {
  static const _tokenKey = 'auth_token';
  final Api _api = Api.instance;

  AppUser? user;
  bool loading = true;

  AuthService() {
    _api.onUnauthorized = () => logout();
  }

  Future<void> restore() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString(_tokenKey);
    if (saved != null) {
      _api.token = saved;
      try {
        final r = await _api.get('/auth/me');
        user = AppUser.fromJson(r['user'] as Map<String, dynamic>);
      } catch (_) {
        await _clear();
      }
    }
    loading = false;
    notifyListeners();
  }

  Future<void> login(String username, String password) async {
    final r = await _api.post('/auth/login', {'username': username, 'password': password});
    await _saveToken(r['token'] as String);
    user = AppUser.fromJson(r['user'] as Map<String, dynamic>);
    notifyListeners();
  }

  Future<void> changePassword(String current, String next) async {
    final r = await _api.post('/auth/change-password', {
      'currentPassword': current,
      'newPassword': next,
    });
    await _saveToken(r['token'] as String);
  }

  Future<void> logout() async {
    await _clear();
    user = null;
    notifyListeners();
  }

  Future<void> _saveToken(String t) async {
    _api.token = t;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_tokenKey, t);
  }

  Future<void> _clear() async {
    _api.token = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_tokenKey);
  }
}
