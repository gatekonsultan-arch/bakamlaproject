-- Selfie wajah pada absensi staf + persetujuan pengolahan data wajah (UU No. 27/2022 PDP).
-- Foto disimpan maksimal FACE_PHOTO_RETENTION_DAYS (default 90) lalu dihapus otomatis;
-- catatan kehadiran tetap disimpan.
ALTER TABLE users ADD (face_consent_at TIMESTAMP WITH TIME ZONE);
ALTER TABLE attendance ADD (check_in_photo VARCHAR2(100));
ALTER TABLE attendance ADD (check_out_photo VARCHAR2(100));
ALTER TABLE attendance ADD (check_in_face_score NUMBER(4,3));
ALTER TABLE attendance ADD (check_out_face_score NUMBER(4,3));
ALTER TABLE attendance ADD (photos_purged_at TIMESTAMP WITH TIME ZONE);
-- Sidik (SHA-256) foto agar foto yang sama tidak bisa dipakai ulang untuk absen
CREATE TABLE attendance_photo_hashes (
  photo_hash  VARCHAR2(64) PRIMARY KEY,
  user_id     NUMBER NOT NULL,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT fk_aph_user FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX ix_att_photo_purge ON attendance(att_date, photos_purged_at);
