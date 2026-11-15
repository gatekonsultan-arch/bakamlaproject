# Deploy ke VPS Hostinger

## Spesifikasi yang disarankan

| | Minimal | Disarankan |
|---|---|---|
| Paket | KVM 2 (2 vCPU, 8 GB RAM) | KVM 4 |
| OS | Ubuntu 24.04 LTS | Ubuntu 24.04 LTS |
| Disk | 50 GB | 100 GB+ (foto laporan nanti butuh ruang) |

Oracle Database 23ai **Free** dibatasi 2 CPU, 2 GB RAM untuk database, dan **12 GB data user**.
Untuk absensi saja batas ini sangat cukup. Jika nanti melebihi, perlu lisensi Oracle Standard/Enterprise Edition.

> **Penting untuk instansi pemerintah:** pastikan kebijakan instansi (PP 71/2019, SPBE, ketentuan BSSN)
> mengizinkan data disimpan di VPS komersial. Pilih lokasi data center terdekat/di Indonesia jika tersedia.

## 1. Amankan server (lakukan pertama kali)

```bash
# login sebagai root, buat user biasa
adduser deploy && usermod -aG sudo deploy
# salin SSH key Anda ke user deploy, lalu dari komputer Anda: ssh-copy-id deploy@IP_VPS
```

Edit `/etc/ssh/sshd_config`: `PermitRootLogin no` dan `PasswordAuthentication no`, lalu `sudo systemctl restart ssh`.
Pastikan login dengan key berhasil **sebelum** menutup sesi lama.

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y ufw fail2ban unattended-upgrades nginx certbot python3-certbot-nginx
sudo ufw default deny incoming
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo dpkg-reconfigure -plow unattended-upgrades
```

Aktifkan juga **firewall di panel Hostinger** (hanya port 22, 80, 443).

## 2. Install Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker deploy   # logout & login lagi
```

> Docker membuka port yang di-*publish* melewati UFW. Karena itu, di `docker-compose.yml` semua port
> di-bind ke `127.0.0.1` dan Oracle tidak di-publish sama sekali. Jangan ubah ini.

## 3. Jalankan database & API

```bash
sudo mkdir -p /opt/absensi && sudo chown deploy: /opt/absensi
git clone <URL_REPO> /opt/absensi && cd /opt/absensi/deploy
cp .env.example .env
openssl rand -hex 48          # tempel ke JWT_SECRET
nano .env                     # isi semua password (berbeda-beda, minimal 16 karakter)
chmod 600 .env

docker compose up -d --build
docker compose logs -f oracle   # tunggu "DATABASE IS READY TO USE!" (pertama kali ±2-5 menit)

docker compose exec api npm run migrate
docker compose exec -e SUPERADMIN_PASSWORD='PasswordSuperKuat123' api npm run create-superadmin
curl http://127.0.0.1:3000/api/health
```

### Memperbarui aplikasi (versi baru dari git)

```bash
cd /opt/absensi && git pull
cd deploy && docker compose up -d --build
docker compose exec api npm run migrate      # menambah tabel baru; tabel & data lama tidak diubah
```

## 4. Build aplikasi web & pasang Nginx + HTTPS

Di komputer Anda (atau di VPS jika Flutter terpasang):
```bash
cd mobile
flutter build web --release --no-web-resources-cdn
rsync -a build/web/ deploy@IP_VPS:/tmp/web/
```
Di VPS:
```bash
sudo mkdir -p /var/www/absensi && sudo rsync -a --delete /tmp/web/ /var/www/absensi/
sudo cp /opt/absensi/deploy/nginx.conf /etc/nginx/sites-available/absensi
sudo nano /etc/nginx/sites-available/absensi     # ganti absensi.domainanda.com
sudo ln -s /etc/nginx/sites-available/absensi /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d absensi.domainanda.com   # HTTPS gratis + perpanjang otomatis
```

**HTTPS wajib**, karena browser tidak mengizinkan akses GPS di situs tanpa HTTPS.

## 5. Build aplikasi Android / iOS

```bash
flutter build apk --release --dart-define=API_URL=https://absensi.domainanda.com
flutter build appbundle --release --dart-define=API_URL=https://absensi.domainanda.com   # Play Store
flutter build ipa --release --dart-define=API_URL=https://absensi.domainanda.com         # iOS (butuh Mac)
```

## 6. Backup

```bash
crontab -e
# 0 2 * * * /opt/absensi/deploy/backup-oracle.sh >> /var/log/absensi-backup.log 2>&1
```
Salin folder `/opt/absensi/backups` ke luar VPS (rclone ke Google Drive/S3), dan aktifkan juga snapshot VPS di panel Hostinger.
**Uji restore** minimal sebulan sekali.

## Checklist keamanan

- [ ] Login SSH hanya dengan key, root login mati, fail2ban aktif
- [ ] UFW + firewall panel Hostinger: hanya 22, 80, 443
- [ ] Port 1521 (Oracle) dan 3000 (API) **tidak** bisa diakses dari luar (`nmap IP_VPS` dari komputer lain)
- [ ] HTTPS aktif (certbot), HTTP dialihkan ke HTTPS
- [ ] Semua password di `.env` kuat dan unik, `JWT_SECRET` acak 96 karakter, `.env` permission 600
- [ ] Password superadmin diganti setelah login pertama
- [ ] Backup harian (database **dan** folder foto `uploads`) berjalan & tersalin ke luar VPS, restore sudah diuji
- [ ] Update rutin: `sudo apt upgrade`, `docker compose pull && docker compose up -d`
