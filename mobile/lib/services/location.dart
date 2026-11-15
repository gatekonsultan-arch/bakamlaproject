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
  static Future<Position> current() async {
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
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.best,
          timeLimit: Duration(seconds: 30),
        ),
      );
    } catch (_) {
      throw LocationException('Gagal mendapatkan lokasi. Pindah ke area terbuka lalu coba lagi.');
    }
  }

  static Map<String, dynamic> toPayload(Position p, {String? note}) => {
        'latitude': p.latitude,
        'longitude': p.longitude,
        'accuracy': p.accuracy,
        'isMocked': p.isMocked,
        if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
        'deviceInfo': kIsWeb ? 'web' : defaultTargetPlatform.name,
      };
}
