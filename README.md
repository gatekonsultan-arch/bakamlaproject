# Aplikasi Proyek: Absensi, Laporan Harian K3 & Kontrol Material — Web & Mobile

Aplikasi proyek konstruksi dengan tiga modul:
1. **Absensi geotagging**: check-in/out hanya sah di dalam radius lokasi kerja.
2. **Laporan Harian K3**: disusun HSE Officer, diketahui PIC Site, disetujui HSE Manager, lalu dicetak ke PDF A4. Contoh hasil: [docs/contoh-laporan-harian-k3.pdf](docs/contoh-laporan-harian-k3.pdf)
3. **Kontrol material logistik**: kebutuhan → permintaan pembelian → approval → pemesanan → penerimaan → pemakaian, dengan **penanda kuning/merah** otomatis.

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
| `database/` | Skema Oracle: absensi (01), role (02), material (03), laporan K3 (04) |
| `backend/`  | REST API (Node.js, Express, node-oracledb mode *thin* — tanpa Instant Client) |
| `mobile/`   | Aplikasi Flutter (web + Android + iOS) |
| `deploy/`   | Docker Compose (Oracle + API), konfigurasi Nginx, skrip backup |
| `docs/`     | Panduan deploy ke VPS Hostinger |

## Role & hak akses

| Fitur | Super Admin | Admin | Project Mgr | Site Mgr | HSE Mgr | HSE Officer | Logistik |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Login, check-in/out, riwayat sendiri | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Rekap absensi | semua | semua | semua | site-nya | semua | – | – |
| Kelola lokasi | ✓ | ✓ | – | – | – | – | – |
| Kelola pengguna | semua | selain SA/Admin | – | – | – | – | – |
| **Material:** input kebutuhan & ambang batas | ✓ | ✓ | ✓ | site-nya | – | – | – |
| **Material:** ajukan pembelian, catat pesanan/terima/pakai | ✓ | – | – | – | – | – | ✓ |
| **Material:** setujui / tolak pembelian | ✓ | – | ✓ | – | – | – | – |
| **Material:** lihat stok & penanda | ✓ | ✓ | ✓ | ✓ | – | – | ✓ |
| **Laporan K3:** susun & kirim | ✓ | – | – | – | ✓ | ✓ | – |
| **Laporan K3:** mengetahui (PIC Site) | ✓ | – | – | ✓ | – | – | – |
| **Laporan K3:** menyetujui | ✓ | – | – | – | ✓ | – | – |
| **Laporan K3:** lihat & cetak | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – |

Hak akses diperiksa **di server** (`backend/src/roles.js`); menu di aplikasi hanya tampilan.
Site Manager, HSE Officer, dan Logistik yang ditugaskan ke satu lokasi hanya bisa mengakses data lokasinya.
Orang yang mengajukan pembelian **tidak bisa** menyetujui pengajuannya sendiri.

## Penanda ambang batas material

Setiap material per lokasi punya **kebutuhan** (rencana/RAB), **stok minimum**, dan **% peringatan** (default 80%).
Logikanya ada di `backend/src/utils/materialStatus.js` dan diuji di `backend/test/`.

| Jenis | 🟡 Kuning (mendekati) | 🔴 Merah (melewati) |
|---|---|---|
| Pengadaan (diterima + sedang dipesan) | ≥ 80% kebutuhan | > 100% kebutuhan |
| Pemakaian | ≥ 80% kebutuhan | > 100% kebutuhan |
| Stok di lokasi | stok ≤ minimum ÷ 80% (mis. min 50 → ≤ 62,5) | stok ≤ minimum |

Saat Logistik mengajukan pembelian, Project Manager melihat **proyeksi** sebelum menyetujui, misalnya
"Jika disetujui, pengadaan menjadi 116,7%, melebihi kebutuhan sebesar 10".

## Laporan Harian K3

- Format mengikuti laporan proyek: kop, uraian kegiatan, lampiran foto, site plan, tabel cuaca per jam sebulan, bagian **A–J**, dan lembar persetujuan bertanda tangan.
- **Anggota tim & man-hours terisi otomatis** dari absensi di lokasi itu pada hari tersebut, ditambah personel tanpa akun dari pengaturan.
- Foto diunggah dari HP/komputer. Jam foto diambil dari EXIF, lalu foto diperkecil dan **metadata GPS dihapus**. Aktivitas dipilih per foto dari pustaka aktivitas.
- Alur: **Draf → Dikirim → Diketahui PIC Site → Disetujui HSE Manager**. Laporan dapat dikembalikan untuk revisi dengan catatan. Setelah dikirim, laporan terkunci.
- Tanda tangan digambar sekali di menu Profil, lalu dipakai otomatis di lembar persetujuan.
- Cetak: tombol 🖨 → PDF bahasa Inggris (resmi) atau bahasa Indonesia. Laporan yang belum disetujui diberi watermark **DRAFT**.
- Pengaturan per lokasi (kop, proyek, kontraktor, inspektur, APD, logo, site plan dasar): ikon ⚙ di halaman Laporan K3.

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

Pengujian (gunakan database uji, **bukan** produksi):
```bash
cd backend
npm test                                                            # unit test logika ambang batas
API_URL=http://localhost:3000 SUPERADMIN_PASSWORD='...' node scripts/smoke-test.js           # login & absensi
API_URL=http://localhost:3000 SUPERADMIN_PASSWORD='...' node scripts/smoke-test-modules.js   # material & laporan K3
```

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
| GET/POST/PUT | `/api/materials/catalog`, `/api/materials/plans`, `POST /api/materials/movements`, `GET /api/materials/alerts` | material |
| GET/POST | `/api/purchase-requests`, `/:id/approve`, `/:id/reject`, `/:id/cancel`, `/:id/order`, `/:id/receive` | material |
| GET/POST/PUT/DELETE | `/api/hse-reports`, `/:id/photos`, `/:id/submit`, `/:id/acknowledge`, `/:id/approve`, `/:id/return`, `/:id/print-link`, `/settings/:siteId` | laporan K3 |

Deploy ke VPS: lihat **[docs/DEPLOY_HOSTINGER.md](docs/DEPLOY_HOSTINGER.md)**.
