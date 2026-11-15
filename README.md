# Aplikasi Absensi Proyek (Geotagging) — Web & Mobile

Aplikasi login dan absensi berbasis lokasi GPS untuk proyek konstruksi.
Satu kode aplikasi (Flutter) berjalan di **web, Android, dan iOS**. Data disimpan di **Oracle Database**.

```
┌──────────────┐  HTTPS   ┌─────────┐      ┌──────────────┐      ┌──────────────────┐
│ Flutter app  │ ───────► │  Nginx  │ ───► │ API Node.js  │ ───► │ Oracle Database  │
│ web/Android/ │          │ (443)   │      │ (127.0.0.1:  │      │ 23ai Free        │
│ iOS          │          └─────────┘      │  3000)       │      │ (tidak terbuka   │
└──────────────┘                           └──────────────┘      │  ke internet)    │
                                                                 └──────────────────┘
```

| Folder      | Isi |
|-------------|-----|
| `database/` | Skema tabel Oracle + data role awal |
| `backend/`  | REST API (Node.js, Express, node-oracledb mode *thin* — tanpa Instant Client) |
| `mobile/`   | Aplikasi Flutter (web + Android + iOS) |
| `deploy/`   | Docker Compose (Oracle + API), konfigurasi Nginx, skrip backup |
| `docs/`     | Panduan deploy ke VPS Hostinger |

## Role & hak akses

| Fitur | Super Admin | Admin | Project Mgr | Site Mgr | HSE Mgr | Logistik |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Login, check-in/out, riwayat sendiri | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Laporan & rekap absensi | semua | semua | semua | **site-nya saja** | semua | – |
| Kelola lokasi (site) | ✓ | ✓ | – | – | – | – |
| Kelola pengguna | semua role | selain Super Admin/Admin | – | – | – | – |

Hak akses diperiksa **di server** (`backend/src/roles.js`). Menu di aplikasi hanya tampilan.

## Cara kerja absensi geotagging

1. Admin mendaftarkan **lokasi kerja**: koordinat + radius (mis. 150 m). User bisa ditugaskan ke satu lokasi.
2. Saat absen, aplikasi mengambil GPS akurasi tinggi lalu mengirim koordinat ke server.
3. **Server** (bukan aplikasi) menghitung jarak (rumus Haversine) dan menolak jika:
   - di luar radius lokasi kerja,
   - akurasi GPS lebih buruk dari `MAX_GPS_ACCURACY_M` (default 100 m),
   - Android melaporkan *mock location* (aplikasi fake GPS).
4. Satu catatan per orang per hari (check-in lalu check-out), tanggal mengikuti `APP_TIMEZONE` (default WIB).

> Tidak ada sistem GPS yang 100% anti-pemalsuan (HP yang di-root bisa mengakali deteksi mock).
> Untuk pengamanan tambahan, langkah berikutnya bisa ditambahkan foto selfie saat absen.

## Keamanan yang sudah diterapkan

- Password di-hash **bcrypt** (cost 12), kebijakan minimal 8 karakter dengan huruf dan angka.
- Akun **terkunci 15 menit** setelah 5 kali salah password, ditambah *rate limit* pada endpoint login.
- Token JWT (HS256) **dicabut otomatis** saat ganti/reset password, perubahan role, atau akun dinonaktifkan.
- Semua query memakai *bind variable* Oracle, sehingga aman dari SQL injection.
- Validasi input dengan Zod. Pesan error database tidak dibocorkan ke klien.
- Header keamanan (Helmet), CORS dibatasi, dan ukuran body dibatasi.
- **Audit log** untuk login, gagal login, absen, dan perubahan user/lokasi.
- Ekspor CSV dilindungi dari *formula injection* Excel.
- Port Oracle & API tidak dibuka ke internet; hanya Nginx (HTTPS) yang publik.

## Menjalankan di komputer lokal (pengembangan)

Butuh: Docker, Node.js 20+, Flutter 3.24+.

```bash
# 1. Oracle Database
docker run -d --name oradb -p 127.0.0.1:1521:1521 \
  -e ORACLE_PASSWORD=SysPass123 -e APP_USER=absensi -e APP_USER_PASSWORD=AppPass123 \
  gvenzl/oracle-free:23-slim

# 2. Backend
cd backend
cp .env.example .env        # isi DB_PASSWORD=AppPass123, DB_CONNECT_STRING=localhost:1521/FREEPDB1, JWT_SECRET
npm install
npm run migrate
SUPERADMIN_PASSWORD='PasswordKuat123' npm run create-superadmin
npm run dev

# 3. Aplikasi (web)
cd ../mobile
flutter create . --platforms=web,android,ios --project-name absensi_app   # sekali saja, membuat folder platform
flutter pub get
flutter run -d chrome --dart-define=API_URL=http://localhost:3000
```

Uji otomatis alur API (gunakan database uji): `API_URL=http://localhost:3000 SUPERADMIN_PASSWORD='...' node backend/scripts/smoke-test.js`

### Izin lokasi di HP (setelah `flutter create`)

**Android** — `mobile/android/app/src/main/AndroidManifest.xml`, di dalam `<manifest>`:
```xml
<uses-permission android:name="android.permission.INTERNET"/>
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/>
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION"/>
```
**iOS** — `mobile/ios/Runner/Info.plist`:
```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>Lokasi dibutuhkan untuk memverifikasi absensi di lokasi kerja.</string>
```

## Endpoint API

| Method | Path | Akses |
|---|---|---|
| POST | `/api/auth/login` | publik |
| GET | `/api/auth/me` | login |
| POST | `/api/auth/change-password` | login |
| GET | `/api/attendance/today` · `/api/attendance/me` | login |
| POST | `/api/attendance/check-in` · `/api/attendance/check-out` | login |
| GET | `/api/attendance` · `/summary` · `/export.csv` | laporan |
| GET/POST/PUT | `/api/sites` | GET: login, ubah: admin |
| GET/POST/PUT | `/api/users`, `/api/users/roles`, `POST /api/users/:id/reset-password` | admin |

Deploy ke VPS: lihat **[docs/DEPLOY_HOSTINGER.md](docs/DEPLOY_HOSTINGER.md)**.
