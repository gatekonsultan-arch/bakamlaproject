'use strict';
/**
 * Perhitungan upah mingguan tenaga kerja harian.
 *  - Periode: Senin s/d Sabtu.
 *  - Masuk penuh = 1 x upah harian, setengah hari = 0,5 x, tidak masuk = 0.
 *  - Lembur = jam lembur x tarif lembur per jam.
 *  - Kasbon dipotong pada pekan tanggal kasbon. Upah bersih bisa minus (ditandai).
 * Upah & tarif yang dipakai adalah salinan saat absensi dicatat (day_rate / ot_rate).
 */

const FACTOR = { FULL: 1, HALF: 0.5, ABSENT: 0 };
const CATEGORY_ORDER = { MANDOR: 0, TUKANG: 1, BURUH: 2 };
const CATEGORY_LABEL = { MANDOR: 'Mandor', TUKANG: 'Tukang', BURUH: 'Buruh' };

const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Tanggal (YYYY-MM-DD) -> nomor hari ISO (1 = Senin ... 7 = Minggu). */
function isoWeekday(date) {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Senin dari pekan yang memuat tanggal tsb. */
function weekStart(date) {
  return addDays(date, 1 - isoWeekday(date));
}

/** Daftar tanggal Senin..Sabtu. */
function weekDays(start) {
  return Array.from({ length: 6 }, (_, i) => addDays(start, i));
}

/**
 * @param workers    [{id, name, category, trade, dailyRate, overtimeRate}]
 * @param attendance [{workerId, workDate, status, overtimeHours, dayRate, otRate}]
 * @param advances   [{workerId, amount}]
 */
function computeWeek(start, workers, attendance, advances) {
  const days = weekDays(start);
  const byWorker = new Map();
  const ensure = (w) => {
    if (!byWorker.has(w.id)) {
      byWorker.set(w.id, {
        workerId: w.id, name: w.name, category: w.category, trade: w.trade || null,
        dailyRate: money(w.dailyRate), overtimeRate: money(w.overtimeRate),
        days: Object.fromEntries(days.map((d) => [d, null])),
        ratesUsed: [],
        full: 0, half: 0, absent: 0, unrecorded: 0, workDays: 0, overtimeHours: 0,
        wage: 0, overtimePay: 0, advance: 0, net: 0,
      });
    }
    return byWorker.get(w.id);
  };
  const workerById = new Map(workers.map((w) => [w.id, w]));
  workers.forEach(ensure);

  for (const a of attendance) {
    if (!days.includes(a.workDate)) continue;
    const w = workerById.get(a.workerId) || { id: a.workerId, name: `#${a.workerId}`, category: 'BURUH', dailyRate: a.dayRate, overtimeRate: a.otRate };
    const r = ensure(w);
    r.days[a.workDate] = { status: a.status, overtimeHours: Number(a.overtimeHours) || 0 };
    const f = FACTOR[a.status] ?? 0;
    if (a.status === 'FULL') r.full++;
    else if (a.status === 'HALF') r.half++;
    else r.absent++;
    r.workDays += f;
    if (f > 0 && !r.ratesUsed.includes(money(a.dayRate))) r.ratesUsed.push(money(a.dayRate));
    r.wage = money(r.wage + f * Number(a.dayRate));
    // Lembur hanya dihitung bila pekerja masuk.
    if (f > 0) {
      r.overtimeHours = Math.round((r.overtimeHours + (Number(a.overtimeHours) || 0)) * 10) / 10;
      r.overtimePay = money(r.overtimePay + (Number(a.overtimeHours) || 0) * Number(a.otRate));
    }
  }
  for (const adv of advances) {
    const w = workerById.get(adv.workerId);
    if (!w && !byWorker.has(adv.workerId)) continue;
    const r = ensure(w || { id: adv.workerId });
    r.advance = money(r.advance + Number(adv.amount));
  }

  const rows = [...byWorker.values()]
    .map((r) => {
      r.unrecorded = days.filter((d) => !r.days[d]).length;
      r.ratesUsed.sort((a, b) => a - b);
      if (!r.ratesUsed.length) r.ratesUsed = [r.dailyRate];
      r.gross = money(r.wage + r.overtimePay);
      r.net = money(r.gross - r.advance);
      return r;
    })
    // pekerja nonaktif tanpa absensi & kasbon pada pekan ini tidak ditampilkan
    .filter((r) => workerById.get(r.workerId)?.isActive !== false || r.full + r.half + r.absent > 0 || r.advance > 0)
    .sort((a, b) => (CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category]) || a.name.localeCompare(b.name));

  const sum = (k, list = rows) => money(list.reduce((t, r) => t + r[k], 0));
  const byCategory = Object.keys(CATEGORY_ORDER).map((c) => {
    const list = rows.filter((r) => r.category === c);
    return { category: c, label: CATEGORY_LABEL[c], people: list.length, workDays: sum('workDays', list),
      wage: sum('wage', list), overtimePay: sum('overtimePay', list), advance: sum('advance', list), net: sum('net', list) };
  }).filter((c) => c.people > 0);

  return {
    weekStart: start,
    weekEnd: days[5],
    days,
    rows,
    byCategory,
    totals: {
      people: rows.length, workDays: sum('workDays'), overtimeHours: sum('overtimeHours'),
      wage: sum('wage'), overtimePay: sum('overtimePay'), gross: sum('gross'), advance: sum('advance'), net: sum('net'),
      unrecordedCells: rows.reduce((t, r) => t + r.unrecorded, 0),
      negativeNet: rows.filter((r) => r.net < 0).map((r) => r.name),
    },
  };
}

module.exports = { FACTOR, CATEGORY_LABEL, isoWeekday, addDays, weekStart, weekDays, computeWeek, money };
