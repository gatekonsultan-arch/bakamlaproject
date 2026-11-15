'use strict';
const db = require('../db');

/** Catat aktivitas penting. Kegagalan audit tidak menggagalkan request. */
async function audit(userId, action, detail, ip) {
  try {
    await db.query(
      `INSERT INTO audit_log (user_id, action, detail, ip_address)
       VALUES (:userId, :action, :detail, :ip)`,
      {
        userId: userId || null,
        action,
        detail: detail ? String(detail).slice(0, 1000) : null,
        ip: ip ? String(ip).slice(0, 45) : null,
      },
    );
  } catch (err) {
    console.error('Gagal menulis audit log:', err.message);
  }
}

module.exports = { audit };
