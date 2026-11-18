import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';

class LocationException implements Exception {
  final String message;
  LocationException(this.message);
  @override
  String toString() => message;
}

/// Mengambil posisi GPS akurasi tinggi + info apakah lokasi dipalsukan.
class LocationService {
  static const _timeout = Duration(seconds: 30);

  static bool get _isIOS => defaultTargetPlatform == TargetPlatform.iOS;

  static String get _deniedHelp => kIsWeb && _isIOS
      ? 'Izin lokasi ditolak. Di iPhone buka Pengaturan > Privasi & Keamanan > Layanan Lokasi > '
          '"Safari Websites" (atau Chrome) > pilih "Saat Menggunakan App" dan aktifkan "Lokasi Akurat", '
          'lalu muat ulang halaman.'
      : 'Izin lokasi ditolak. Izinkan akses lokasi untuk situs/aplikasi ini, lalu coba lagi.';

  static Future<Position> current() async {
    if (kIsWeb) return _currentWeb();

    if (!await Geolocator.isLocationServiceEnabled()) {
      throw LocationException('GPS/Lokasi di perangkat belum aktif. Aktifkan terlebih dahulu.');
    }
    var perm = await Geolocator.checkPermission();
    if (perm == LocationPermission.denied) {
      perm = await Geolocator.requestPermission();
    }
    if (perm == LocationPermission.denied) {
      throw LocationException('Izin lokasi ditolak. Absensi membutuhkan izin lokasi.');
    }
    if (perm == LocationPermission.deniedForever) {
      throw LocationException(
          'Izin lokasi ditolak permanen. Buka Pengaturan aplikasi dan izinkan akses lokasi.');
    }
    try {
      return await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.best, timeLimit: _timeout),
      );
    } catch (_) {
      throw LocationException('Gagal mendapatkan lokasi. Pindah ke area terbuka lalu coba lagi.');
    }
  }

  /// Versi web (termasuk Safari/Chrome di iPhone):
  /// - langsung meminta posisi (browser sendiri yang menampilkan izin), tanpa cek izin terpisah
  ///   yang tidak konsisten antar-browser;
  /// - batas waktu dipasang di sisi aplikasi, karena plugin web mengirim batas waktu yang keliru
  ///   ke browser sehingga pencarian bisa menggantung sangat lama.
  static Future<Position> _currentWeb() async {
    try {
      return await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.best),
      ).timeout(_timeout);
    } on TimeoutException {
      throw LocationException('Lokasi tidak didapat dalam 30 detik. Pindah ke area terbuka, '
          'pastikan Layanan Lokasi menyala, lalu coba lagi.');
    } on PermissionDeniedException {
      throw LocationException(_deniedHelp);
    } on LocationServiceDisabledException {
      throw LocationException('Layanan Lokasi di perangkat mati. Aktifkan terlebih dahulu.');
    } catch (e) {
      final s = e.toString().toLowerCase();
      if (s.contains('denied') || s.contains('permission')) throw LocationException(_deniedHelp);
      if (s.contains('secure') || s.contains('https')) {
        throw LocationException('Lokasi hanya bisa diakses lewat alamat HTTPS. Buka aplikasi dengan https://');
      }
      throw LocationException('Gagal mendapatkan lokasi. Pindah ke area terbuka lalu coba lagi.');
    }
  }

  /// Akurasi sangat kasar (> 1 km) di iPhone biasanya karena "Lokasi Akurat" dimatikan untuk browser.
  static String? accuracyHint(Position p) => p.accuracy > 1000 && kIsWeb && _isIOS
      ? 'Akurasi lokasi sangat rendah (${p.accuracy.round()} m). Di iPhone aktifkan "Lokasi Akurat" untuk '
          'Safari/Chrome: Pengaturan > Privasi & Keamanan > Layanan Lokasi > Safari Websites.'
      : null;

  static Map<String, dynamic> toPayload(Position p, {String? note}) => {
        'latitude': p.latitude,
        'longitude': p.longitude,
        'accuracy': p.accuracy,
        'isMocked': p.isMocked,
        if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
        'deviceInfo': kIsWeb ? 'web-${defaultTargetPlatform.name}' : defaultTargetPlatform.name,
      };
}
