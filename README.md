# Aplikasi Proyek: Absensi, Laporan Harian K3 & Kontrol Material — Web & Mobile

Aplikasi proyek konstruksi dengan tiga modul:
1. **Absensi geotagging + selfie wajah**: check-in/out di dalam radius lokasi kerja langsung diakui. Di luar area, absen tetap bisa dengan keterangan, tetapi baru diakui hadir setelah disetujui Project Manager / Site Manager (menu **Approval**). Selfie wajib berisi tepat satu wajah.
2. **Laporan Harian K3**: disusun HSE Officer, diketahui PIC Site, disetujui HSE Manager, lalu dicetak ke PDF A4. Contoh hasil: [docs/contoh-laporan-harian-k3.pdf](docs/contoh-laporan-harian-k3.pdf)
3. **Tenaga kerja harian & rekap upah mingguan**: tukang, mandor, buruh diabsen Site Manager di lokasi (hadir / ½ hari / tidak masuk + lembur), kasbon dipotong, rekap Senin–Sabtu disetujui PM. Contoh: [docs/contoh-rekap-upah-mingguan.pdf](docs/contoh-rekap-upah-mingguan.pdf)
4. **ATP Checklist (mutu pekerjaan struktur)**: Site Manager memeriksa ukuran DED vs aktual per item (fondasi, pembesian, kolom, balok, plat), PM menyetujui, lalu dicetak untuk ditandatangani Inspektur/pengawas.
5. **Kontrol material logistik**: kebutuhan → permintaan pembelian → approval → pemesanan → penerimaan → pemakaian, dengan **penanda kuning/merah** otomatis.

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
| `database/` | Skema Oracle: absensi (01), role (02), material (03), laporan K3 (04), tanda tangan (05), tenaga kerja & upah (06), selfie (07), material submission & ATP (08), jam foto (09), absen luar area (10) |
| `backend/`  | REST API (Node.js, Express, node-oracledb mode *thin* — tanpa Instant Client) |
| `mobile/`   | Aplikasi Flutter (web + Android + iOS) |
| `deploy/`   | Docker Compose (Oracle + API), konfigurasi Nginx, skrip backup |
| `docs/`     | Panduan deploy ke VPS Hostinger, screenshot tampilan (`docs/screenshots/`), contoh PDF |

## Role & hak akses

| Fitur | Super Admin | Admin | Project Mgr | Site Mgr | HSE Mgr | HSE Officer | Logistik |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Login, check-in/out, riwayat sendiri | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Rekap absensi | semua | semua | semua | site-nya | semua | – | – |
| **Approval** absen di luar area | semua | – | semua | site-nya (bukan PM) | – | – | – |
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
| **Tenaga kerja:** data pekerja & upah | ✓ | ✓ | ✓ | site-nya | – | – | – |
| **Tenaga kerja:** absen harian, ajukan rekap | ✓ | – | – | site-nya | – | – | – |
| **Tenaga kerja:** kasbon | ✓ | ✓ | – | site-nya | – | – | – |
| **Tenaga kerja:** setujui rekap upah | ✓ | – | ✓ | – | – | – | – |
| **Tenaga kerja:** tandai sudah dibayar | ✓ | ✓ | ✓ | – | – | – | – |
| **ATP:** lihat & cetak | ✓ | ✓ | ✓ | site-nya | – | – | – |
| **ATP:** menyusun & mengirim | ✓ | – | – | site-nya | – | – | – |
| **ATP:** menyetujui | ✓ | – | ✓ | – | – | – | – |

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

## Persetujuan merek/spesifikasi material (Material Purchase Submission & Approval)

Formulir *Material Purchase Submission & Approval* menyatu dengan alur **Pembelian**:
- Logistik mengajukan pembelian beserta **merek**, **tipe/spesifikasi**, dan **foto label material** per item, plus paket/kategori.
- PM memutuskan **per item**: Setujui, atau Tolak dengan **alasan wajib**. Permintaan berstatus *Disetujui* bila ada item yang disetujui, dan hanya item itu yang boleh dipesan dan diterima. Item yang ditolak tidak dihitung dalam pengadaan atau penanda ambang batas. Bila semua item ditolak, statusnya *Ditolak*.
- PM wajib punya tanda tangan digital untuk memutuskan. Tombol 🖨 mencetak formulir sesuai format proyek (kop PRIMA/SRT, ☑ Approve/☑ Reject per item, tanda tangan *Submitted by* dan *Approved by*).

## ATP Checklist (Acceptance Test Procedure)

- **Site Manager** membuat ATP per area pekerjaan dan memilih jenis pekerjaannya. Daftar item standar A–E
  (`backend/src/reports/atpLibrary.js`) tersalin otomatis dan bisa diubah, ditambah, atau dihapus.
- Per item diisi ukuran **DED (rencana)**, **aktual (as-built)**, **toleransi**, keterangan, dan foto.
  **Saran hasil otomatis**: APPROVE bila selisih masih dalam toleransi, selain itu REJECT. Format yang dipahami: ±10, +10/-5, 5%
  (`backend/src/utils/tolerance.js`). Pemeriksa tetap memilih sendiri, dan pemeriksaan visual dinilai manual.
- Item REJECT wajib diberi keterangan perbaikan (*rework*). Dokumen dikirim ke PM, lalu PM **menyetujui** atau **mengembalikan untuk revisi**.
  Kedua tahap mewajibkan tanda tangan digital.
- Hasil cetak: tanda tangan PM di kolom **CONTRACTOR**. Kolom **APPROVED BY** dibiarkan kosong untuk **tanda tangan basah Inspektur/pengawas**.

## Tenaga kerja harian & rekap upah

- **Data pekerja** per lokasi: nama, kategori (Mandor / Tukang / Buruh), keahlian, **upah harian**, **tarif lembur per jam**.
- **Absen harian oleh Site Manager** (pekerja tidak perlu akun/HP): Hadir, ½ hari, atau Tidak masuk, plus jam lembur. Saat disimpan, **posisi GPS Site Manager dicek harus di dalam area proyek**. Foto apel pagi bisa dilampirkan sebagai bukti. Hari Minggu tidak dihitung, dan pengisian maksimal 6 hari ke belakang.
- **Perhitungan** (`backend/src/utils/payroll.js`, diuji di `backend/test/payroll.test.js`):
  `upah = Σ (1 × upah harian untuk Hadir, 0,5 × untuk ½ hari)` + `lembur = jam × tarif lembur` − `kasbon pekan itu`.
  Upah sebuah hari mengikuti **tarif saat hari itu pertama kali dicatat**, sehingga kenaikan upah tidak mengubah hari yang sudah lewat.
- **Rekap mingguan Senin–Sabtu**: Site Manager mengajukan → PM menyetujui (atau mengembalikan dengan catatan) → Admin/PM menandai sudah dibayar. Setelah diajukan, absensi dan kasbon pekan itu **terkunci**. Saat disetujui, angka rekap **dibekukan**. Kedua tahap mewajibkan tanda tangan digital.
- Rekap bisa **dicetak/PDF** (dengan kolom paraf dan tanda tangan) atau **diunduh ke Excel (CSV)**.

## Laporan Harian K3

- Format mengikuti laporan proyek: kop, uraian kegiatan, lampiran foto, site plan, tabel cuaca per jam sebulan, bagian **A–J**, dan lembar persetujuan bertanda tangan.
- **Anggota tim & man-hours terisi otomatis** dari absensi di lokasi itu pada hari tersebut, ditambah personel tanpa akun dari pengaturan.
- Foto diunggah **utuh** dari HP/komputer, sehingga **jam dan tanggal pemotretan dibaca otomatis dari data kamera (EXIF)**, bukan jam upload. Setelah itu server memperkecil foto dan **menghapus metadata GPS**.
  - Setiap foto diberi tanda asal jam: *dari kamera*, *perkiraan, periksa* (foto tanpa data kamera, mis. kiriman WhatsApp, memakai jam file), atau *diubah manual*.
  - Foto yang diambil di tanggal lain dari tanggal laporan diberi peringatan.
  - Jam diubah lewat **pemilih jam**. Aktivitas yang berasal dari foto ikut menyesuaikan jamnya.
  - Aktivitas dipilih per foto dari pustaka aktivitas.
- **Cuaca per jam terisi otomatis** dari "Cuaca di foto" pada foto yang jamnya paling dekat (`backend/src/utils/weather.js`). Setiap jam tetap bisa diubah manual atau dikembalikan ke "Otomatis". Hasilnya masuk ke ringkasan cuaca dan tabel cuaca bulanan di PDF. Tidak memakai layanan cuaca luar.
- Alur: **Draf → Dikirim → Diketahui PIC Site → Disetujui HSE Manager**. Laporan dapat dikembalikan untuk revisi dengan catatan. Setelah dikirim, laporan terkunci.
- **Tanda tangan digital wajib**: tiap penanda tangan (HSE Officer, PIC Site, HSE Manager) harus mengunggah tanda tangan, dengan digambar di aplikasi atau unggah foto/scan. Tanpa tanda tangan, server menolak Kirim, Mengetahui, dan Setujui. Latar putih otomatis dibuat transparan. Tanda tangan **dibekukan** pada laporan saat ditandatangani, sehingga laporan yang sudah disetujui tidak berubah meskipun tanda tangan diganti kemudian.
- **Logo kop bawaan: PRIMA (kiri) & SRT (kanan)** (`backend/assets/logos/`). Logo ini otomatis dipakai semua lokasi; untuk mengganti logo khusus satu lokasi, unggah di ⚙ Pengaturan Laporan. Kontraktor bawaan: PT Prima Integra Utama.
- Cetak: tombol 🖨 → PDF bahasa Inggris (resmi) atau bahasa Indonesia. Laporan yang belum disetujui diberi watermark **DRAFT**.
- Pengaturan per lokasi (kop, proyek, kontraktor, inspektur, APD, logo, site plan dasar): ikon ⚙ di halaman Laporan K3.

## Cara kerja absensi geotagging

1. Admin mendaftarkan **lokasi kerja**: koordinat + radius (mis. 150 m). User bisa ditugaskan ke satu lokasi.
2. Saat absen, aplikasi mengambil GPS akurasi tinggi lalu mengirim koordinat ke server.
3. **Server** (bukan aplikasi) menghitung jarak (rumus Haversine) dan menolak jika:
   - akurasi GPS lebih buruk dari `MAX_GPS_ACCURACY_M` (default 100 m),
   - Android melaporkan *mock location* (aplikasi fake GPS).
4. **Di luar radius lokasi kerja**: aplikasi meminta **keterangan** (minimal 10 karakter, mis. "Rapat di kantor Bakamla"). Absen tercatat dengan status **Menunggu persetujuan** dan **belum dihitung hadir** di rekap.
   - Persetujuan ada di menu **Approval** milik Project Manager & Site Manager. Kartu menampilkan selfie, jarak, keterangan, dan tombol "Lihat di peta".
   - **Setujui** → diakui hadir. **Tolak** → wajib alasan, tidak dihitung hadir, dan karyawan melihat alasannya.
   - Site Manager hanya memutus lokasinya sendiri dan tidak untuk absensi Project Manager. Tidak ada yang bisa menyetujui absensinya sendiri. PM memutus semua lokasi.
   - Check-out di luar area membuat absensi hari itu perlu disetujui lagi.
   - Rekap & CSV memuat status, keterangan, dan siapa yang memutus.
5. Satu catatan per orang per hari (check-in lalu check-out), tanggal mengikuti `APP_TIMEZONE` (default WIB).

### Selfie wajah saat absen
- Check-in dan check-out **wajib selfie** (kamera depan). **Server** (bukan HP) memeriksa foto dengan model deteksi wajah
  (`@vladmandic/face-api`, SSD MobileNet v1, backend WebAssembly, tanpa komponen native). Foto **ditolak** bila:
  tidak ada wajah, ada lebih dari satu wajah, wajah terlalu kecil/jauh, atau foto yang sama persis pernah dipakai.
- Ini **deteksi**, bukan pengenalan identitas: sistem tidak mencocokkan wajah dengan data wajah terdaftar.
  Foto disimpan sebagai **bukti**, dan atasan memeriksanya di Rekap Absen (kolom Selfie, ketuk untuk memperbesar).
- **UU No. 27/2022 (PDP):** sebelum absen pertama, karyawan diminta menyetujui pengambilan foto wajah, dan persetujuan itu dicatat.
  Foto hanya bisa dibuka lewat tautan bertanda tangan yang berlaku sebentar, dan **dihapus otomatis setelah 90 hari**
  (`FACE_PHOTO_RETENTION_DAYS`). Catatan kehadirannya tetap disimpan. Penghapusan berjalan tiap 6 jam di server,
  atau manual dengan `npm run purge-face-photos`.
- Pengaturan di `.env`: `REQUIRE_SELFIE`, `FACE_PHOTO_RETENTION_DAYS`, `FACE_MIN_SCORE`, `FACE_MIN_RATIO`.
- **iPhone (Safari/Chrome):** kamera web hanya boleh dibuka tepat saat pengguna mengetuk tombol. Karena itu urutannya:
  **ketuk Check-in → kamera terbuka → selfie → GPS → kirim**. Bila GPS tidak merespons, pencarian lokasi
  dihentikan dalam 30 detik dengan pesan yang jelas. Halaman cetak dibuka di tab yang sama, karena tab baru diblokir sebagai pop-up.
  Di iPhone, izinkan lokasi dan aktifkan **Lokasi Akurat** untuk Safari/Chrome
  (Pengaturan → Privasi & Keamanan → Layanan Lokasi → Safari Websites). Aplikasi web wajib dibuka lewat **HTTPS**.
- Batasan: deteksi ini tidak bisa membedakan wajah asli dari foto wajah yang dipotret ulang dari layar.
  Untuk itu diperlukan pencocokan wajah + cek keaslian (liveness), yang bisa ditambahkan kemudian.

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
# TEST_SELFIE = foto wajah SATU orang (mis. selfie Anda sendiri) untuk menguji absensi. Jangan di-commit ke repo.
export TEST_SELFIE=/path/selfie.jpg
API_URL=http://localhost:3000 SUPERADMIN_PASSWORD='...' node scripts/smoke-test.js           # login & absensi + selfie
API_URL=http://localhost:3000 SUPERADMIN_PASSWORD='...' node scripts/smoke-test-modules.js   # material & laporan K3
API_URL=http://localhost:3000 SUPERADMIN_PASSWORD='...' node scripts/smoke-test-workers.js   # tenaga kerja & rekap upah
API_URL=http://localhost:3000 SUPERADMIN_PASSWORD='...' node scripts/smoke-test-atp.js       # ATP checklist
API_URL=http://localhost:3000 SUPERADMIN_PASSWORD='...' node scripts/smoke-test-outside.js   # absen luar area & approval
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
| GET/POST/PUT | `/api/workers`, `/api/workers/attendance`, `/api/workers/attendance/photo`, `/api/workers/advances` | tenaga kerja |
| GET/POST/PUT | `/api/atp`, `/api/atp/meta`, `/:id/items/:itemId/photo`, `/:id/submit`, `/:id/approve`, `/:id/return`, `/:id/print-link` | ATP |
| POST | `/api/purchase-requests/:id/decide`, `/:id/items/:itemId/photo`, `/:id/print-link` | material submission |
| GET/POST | `/api/workers/payroll`, `/payroll/weeks`, `/payroll/submit`, `/payroll/approve`, `/payroll/return`, `/payroll/paid`, `/payroll/link` | rekap upah |
| GET/POST/PUT/DELETE | `/api/hse-reports`, `/:id/photos`, `/:id/submit`, `/:id/acknowledge`, `/:id/approve`, `/:id/return`, `/:id/print-link`, `/settings/:siteId` | laporan K3 |

Deploy ke VPS: lihat **[docs/DEPLOY_HOSTINGER.md](docs/DEPLOY_HOSTINGER.md)**.
