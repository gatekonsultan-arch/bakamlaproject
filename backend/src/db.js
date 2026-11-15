'use strict';
const oracledb = require('oracledb');
const config = require('./config');

// Thin mode (default node-oracledb v6): tidak perlu Oracle Instant Client.
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.autoCommit = false;

let pool;

async function init() {
  pool = await oracledb.createPool({
    user: config.db.user,
    password: config.db.password,
    connectString: config.db.connectString,
    poolMin: config.db.poolMin,
    poolMax: config.db.poolMax,
    poolIncrement: 1,
  });
  return pool;
}

async function close() {
  if (pool) await pool.close(10);
}

/** Ubah nama kolom Oracle (UPPER_SNAKE) menjadi camelCase. */
function camel(row) {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    const key = k.toLowerCase().replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
    out[key] = v;
  }
  return out;
}

/**
 * Jalankan fungsi dengan satu koneksi. Commit otomatis jika sukses,
 * rollback jika error. Selalu gunakan bind variable (:nama) — jangan
 * pernah menyambung string input user ke SQL.
 */
async function withConnection(fn) {
  const conn = await pool.getConnection();
  try {
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* abaikan */ }
    throw err;
  } finally {
    await conn.close();
  }
}

async function query(sql, binds = {}, opts = {}) {
  return withConnection(async (conn) => {
    const r = await conn.execute(sql, binds, opts);
    return r;
  });
}

async function rows(sql, binds = {}) {
  const r = await query(sql, binds);
  return (r.rows || []).map(camel);
}

async function one(sql, binds = {}) {
  const r = await rows(sql, binds);
  return r[0] || null;
}

module.exports = { oracledb, init, close, withConnection, query, rows, one, camel };
