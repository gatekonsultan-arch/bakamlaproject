'use strict';
/**
 * Saran hasil ATP: APPROVE bila ukuran aktual (as-built) masih dalam toleransi terhadap DED, selain itu REJECT.
 * Toleransi yang dipahami:  "10", "±10", "+/-10", "+10/-5", "+10 -5", "5%", "±5%".
 * Hanya SARAN: bila salah satu nilai tidak berupa angka (mis. pemeriksaan visual) hasilnya null
 * dan pemeriksa memilih sendiri. Pemeriksa juga selalu boleh mengubah saran.
 */
const num = (s) => {
  if (s == null) return null;
  const m = String(s).replace(',', '.').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};

function parseTolerance(tol, planned) {
  if (tol == null || String(tol).trim() === '') return null;
  const t = String(tol).replace(/\s+/g, ' ').replace(/,/g, '.').trim();
  const pct = /%/.test(t);
  const scale = (v) => (pct ? Math.abs(planned) * (v / 100) : v);
  const asym = t.match(/\+\s*(\d+(?:\.\d+)?)\s*%?\s*\/?\s*-\s*(\d+(?:\.\d+)?)/);
  if (asym) return { plus: scale(Number(asym[1])), minus: scale(Number(asym[2])) };
  const v = num(t.replace(/^(±|\+\/-|\+-)/, ''));
  if (v == null) return null;
  return { plus: scale(Math.abs(v)), minus: scale(Math.abs(v)) };
}

function suggestResult(planned, actual, tolerance) {
  const p = num(planned);
  const a = num(actual);
  if (p == null || a == null) return null;
  const tol = parseTolerance(tolerance, p);
  if (!tol) return null;
  const diff = Math.round((a - p) * 1000) / 1000;
  return diff <= tol.plus + 1e-9 && -diff <= tol.minus + 1e-9 ? 'APPROVE' : 'REJECT';
}

module.exports = { suggestResult, parseTolerance };
