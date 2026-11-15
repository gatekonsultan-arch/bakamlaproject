'use strict';
/**
 * Penanda ambang batas material.
 *
 * Dua jenis ambang batas (keduanya dicek):
 *  1. RENCANA  — dibandingkan dengan kebutuhan (planned_qty) yang diinput PM/SM:
 *       pengadaan = diterima + sedang dipesan (approved/ordered, belum diterima)
 *       pemakaian = total keluar
 *       KUNING  jika pengadaan atau pemakaian >= warn_pct % dari kebutuhan
 *       MERAH   jika pengadaan atau pemakaian >  100 % dari kebutuhan
 *  2. STOK     — dibandingkan dengan stok minimum (min_stock) di lokasi:
 *       KUNING  jika stok <= min_stock / (warn_pct/100)   (mis. min 100, warn 80% -> stok <= 125)
 *       MERAH   jika stok <= min_stock
 *     Dicek hanya bila min_stock > 0, barang pernah diterima, dan kebutuhan belum habis dipakai.
 */

const LEVEL = Object.freeze({ GREEN: 'GREEN', YELLOW: 'YELLOW', RED: 'RED' });
const RANK = { GREEN: 0, YELLOW: 1, RED: 2 };

const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
const fmt = (n) => r3(n).toLocaleString('id-ID');

function evaluate(sm) {
  const planned = r3(sm.plannedQty);
  const minStock = r3(sm.minStock);
  const warnPct = Number(sm.warnPct) || 80;
  const received = r3(sm.received);
  const used = r3(sm.used);
  const adjusted = r3(sm.adjusted);
  const onOrder = r3(sm.onOrder);
  const pending = r3(sm.pending);

  const stock = r3(received - used + adjusted);
  const procured = r3(received + onOrder);
  const procuredPct = pct(procured, planned);
  const usedPct = pct(used, planned);
  const flags = [];

  // 1. Ambang batas rencana
  if (procured > planned) {
    flags.push({ type: 'PLAN_PROCURED', level: LEVEL.RED,
      message: `Pengadaan ${fmt(procured)} ${sm.unit || ''} melebihi kebutuhan ${fmt(planned)} (${procuredPct}%)` });
  } else if (procuredPct >= warnPct) {
    flags.push({ type: 'PLAN_PROCURED', level: LEVEL.YELLOW,
      message: `Pengadaan sudah ${procuredPct}% dari kebutuhan` });
  }
  if (used > planned) {
    flags.push({ type: 'PLAN_USED', level: LEVEL.RED,
      message: `Pemakaian ${fmt(used)} ${sm.unit || ''} melebihi kebutuhan ${fmt(planned)} (${usedPct}%)` });
  } else if (usedPct >= warnPct) {
    flags.push({ type: 'PLAN_USED', level: LEVEL.YELLOW,
      message: `Pemakaian sudah ${usedPct}% dari kebutuhan` });
  }

  // 2. Ambang batas stok minimum
  if (minStock > 0 && received > 0 && used < planned) {
    const nearLimit = r3(minStock / (warnPct / 100));
    if (stock <= minStock) {
      flags.push({ type: 'STOCK', level: LEVEL.RED,
        message: `Stok ${fmt(stock)} sudah di bawah/sama dengan minimum ${fmt(minStock)}` });
    } else if (stock <= nearLimit) {
      flags.push({ type: 'STOCK', level: LEVEL.YELLOW,
        message: `Stok ${fmt(stock)} mendekati minimum ${fmt(minStock)}` });
    }
  }

  const level = flags.reduce((acc, f) => (RANK[f.level] > RANK[acc] ? f.level : acc), LEVEL.GREEN);
  return {
    stock, procured, procuredPct, usedPct, received, used, adjusted, onOrder, pending,
    remainingToProcure: r3(Math.max(0, planned - procured)),
    level, flags,
  };
}

/**
 * Proyeksi bila permintaan pembelian (qty) disetujui — untuk membantu PM memutuskan.
 * excludePendingQty: qty dari PR ini sendiri yang sudah termasuk di "pending".
 */
function projectRequest(sm, qty) {
  const planned = r3(sm.plannedQty);
  const warnPct = Number(sm.warnPct) || 80;
  const after = r3(r3(sm.received) + r3(sm.onOrder) + r3(qty));
  const afterPct = pct(after, planned);
  let level = LEVEL.GREEN;
  let message = null;
  if (after > planned) {
    level = LEVEL.RED;
    message = `Jika disetujui, pengadaan menjadi ${fmt(after)} (${afterPct}%), melebihi kebutuhan ${fmt(planned)} sebesar ${fmt(after - planned)}`;
  } else if (afterPct >= warnPct) {
    level = LEVEL.YELLOW;
    message = `Jika disetujui, pengadaan menjadi ${afterPct}% dari kebutuhan`;
  }
  return { after, afterPct, level, message };
}

module.exports = { LEVEL, evaluate, projectRequest, r3 };
