-- Tanda tangan "dibekukan" pada laporan saat ditandatangani, sehingga laporan
-- yang sudah disetujui tidak berubah walaupun penanda tangan mengganti tanda tangannya.
ALTER TABLE hse_reports ADD (submitted_sig VARCHAR2(100));
ALTER TABLE hse_reports ADD (acknowledged_sig VARCHAR2(100));
ALTER TABLE hse_reports ADD (approved_sig VARCHAR2(100));
