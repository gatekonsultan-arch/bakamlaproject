'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { weekStart, weekDays, isoWeekday, computeWeek } = require('../src/utils/payroll');

test('pekan Senin-Sabtu', () => {
  assert.equal(weekStart('2026-11-15'), '2026-11-09'); // Minggu -> Senin sebelumnya
  assert.equal(weekStart('2026-11-09'), '2026-11-09');
  assert.equal(weekStart('2026-11-14'), '2026-11-09'); // Sabtu
  assert.deepEqual(weekDays('2026-11-09'), ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14']);
  assert.equal(isoWeekday('2026-11-15'), 7);
});

const workers = [
  { id: 1, name: 'Pak Mandor', category: 'MANDOR', dailyRate: 200000, overtimeRate: 30000 },
  { id: 2, name: 'Tukang Batu', category: 'TUKANG', dailyRate: 150000, overtimeRate: 20000 },
  { id: 3, name: 'Buruh A', category: 'BURUH', dailyRate: 120000, overtimeRate: 15000 },
];
const att = (workerId, workDate, status, overtimeHours = 0, dayRate, otRate) => {
  const w = workers.find((x) => x.id === workerId);
  return { workerId, workDate, status, overtimeHours, dayRate: dayRate ?? w.dailyRate, otRate: otRate ?? w.overtimeRate };
};

test('penuh, setengah hari, tidak masuk, lembur, kasbon', () => {
  const r = computeWeek('2026-11-09', workers, [
    att(2, '2026-11-09', 'FULL', 2),
    att(2, '2026-11-10', 'HALF'),
    att(2, '2026-11-11', 'ABSENT', 3), // lembur saat tidak masuk diabaikan
    att(2, '2026-11-12', 'FULL'),
  ], [{ workerId: 2, amount: 100000 }]);
  const t = r.rows.find((x) => x.workerId === 2);
  assert.equal(t.full, 2); assert.equal(t.half, 1); assert.equal(t.absent, 1); assert.equal(t.unrecorded, 2);
  assert.equal(t.workDays, 2.5);
  assert.equal(t.wage, 375000);          // 2,5 x 150.000
  assert.equal(t.overtimeHours, 2);
  assert.equal(t.overtimePay, 40000);    // 2 jam x 20.000
  assert.equal(t.advance, 100000);
  assert.equal(t.net, 315000);
});

test('upah pakai tarif saat dicatat (kenaikan upah tengah pekan)', () => {
  const r = computeWeek('2026-11-09', workers, [
    att(3, '2026-11-09', 'FULL', 0, 120000),
    att(3, '2026-11-10', 'FULL', 0, 130000),
  ], []);
  const row = r.rows.find((x) => x.workerId === 3);
  assert.equal(row.wage, 250000);
  assert.deepEqual(row.ratesUsed, [120000, 130000]);
});

test('absensi hari Minggu / di luar pekan diabaikan', () => {
  const r = computeWeek('2026-11-09', workers, [att(1, '2026-11-15', 'FULL'), att(1, '2026-11-16', 'FULL')], []);
  assert.equal(r.rows.find((x) => x.workerId === 1).wage, 0);
});

test('total per kategori & total keseluruhan, upah minus ditandai', () => {
  const r = computeWeek('2026-11-09', workers, [
    att(1, '2026-11-09', 'FULL', 1), att(2, '2026-11-09', 'FULL'), att(3, '2026-11-09', 'HALF'),
  ], [{ workerId: 3, amount: 100000 }]);
  assert.equal(r.totals.wage, 200000 + 150000 + 60000);
  assert.equal(r.totals.overtimePay, 30000);
  assert.equal(r.totals.net, 440000 - 100000);
  assert.deepEqual(r.totals.negativeNet, ['Buruh A']); // 60.000 - 100.000
  assert.deepEqual(r.byCategory.map((c) => c.category), ['MANDOR', 'TUKANG', 'BURUH']);
  assert.equal(r.rows[0].category, 'MANDOR');
});
