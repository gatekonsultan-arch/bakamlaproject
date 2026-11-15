'use strict';
/**
 * Hapus otomatis foto selfie absensi yang lebih tua dari FACE_PHOTO_RETENTION_DAYS (default 90 hari).
 * Catatan kehadiran (jam, lokasi, jarak) tetap disimpan; hanya foto & sidik fotonya yang dihapus.
 */
const db = require('../db');
const config = require('../config');
const files = require('./files');

async function purgeFacePhotos(days = config.facePhotoRetentionDays) {
  const rows = await db.rows(
    `SELECT id, check_in_photo, check_out_photo FROM attendance
      WHERE att_date < TRUNC(SYSDATE) - :days AND photos_purged_at IS NULL
        AND (check_in_photo IS NOT NULL OR check_out_photo IS NOT NULL)
      FETCH FIRST 5000 ROWS ONLY`,
    { days },
  );
  for (const r of rows) {
    await files.removeFile('faces', r.checkInPhoto);
    await files.removeFile('faces', r.checkOutPhoto);
    await db.query(
      `UPDATE attendance SET check_in_photo = NULL, check_out_photo = NULL, photos_purged_at = SYSTIMESTAMP WHERE id = :id`,
      { id: r.id },
    );
  }
  const h = await db.query('DELETE FROM attendance_photo_hashes WHERE created_at < SYSTIMESTAMP - NUMTODSINTERVAL(:days, \'DAY\')', { days });
  return { photosPurged: rows.length, hashesPurged: h.rowsAffected };
}

module.exports = { purgeFacePhotos };
