-- Jam & tanggal foto laporan K3 dibaca dari data kamera (EXIF); asal jam dicatat agar
-- jam "perkiraan" (foto tanpa data kamera, mis. kiriman WhatsApp) bisa ditandai untuk diperiksa.
ALTER TABLE hse_report_photos ADD (taken_date VARCHAR2(10));
ALTER TABLE hse_report_photos ADD (time_source VARCHAR2(6));
