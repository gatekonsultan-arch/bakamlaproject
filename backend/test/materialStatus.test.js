'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { evaluate, projectRequest } = require('../src/utils/materialStatus');

const base = { plannedQty: 100, minStock: 10, warnPct: 80, unit: 'sak',
  received: 0, used: 0, adjusted: 0, onOrder: 0, pending: 0 };

test('hijau bila jauh dari ambang batas', () => {
  const s = evaluate({ ...base, received: 50, used: 10 });
  assert.equal(s.level, 'GREEN');
  assert.equal(s.stock, 40);
  assert.deepEqual(s.flags, []);
});

test('belum ada barang diterima: stok minimum tidak memicu penanda', () => {
  assert.equal(evaluate(base).level, 'GREEN');
});

test('kuning bila pengadaan mencapai 80% kebutuhan', () => {
  const s = evaluate({ ...base, received: 60, onOrder: 20 });
  assert.equal(s.level, 'YELLOW');
  assert.equal(s.flags[0].type, 'PLAN_PROCURED');
});

test('merah bila pengadaan melebihi kebutuhan', () => {
  const s = evaluate({ ...base, received: 90, onOrder: 15 });
  assert.equal(s.level, 'RED');
  assert.match(s.flags[0].message, /melebihi/);
});

test('tepat 100% kebutuhan = kuning, belum merah', () => {
  assert.equal(evaluate({ ...base, received: 100, used: 0 }).level, 'YELLOW');
});

test('merah bila pemakaian melebihi kebutuhan', () => {
  const s = evaluate({ ...base, received: 100, used: 101, adjusted: 5 });
  assert.ok(s.flags.some((f) => f.type === 'PLAN_USED' && f.level === 'RED'));
});

test('stok mendekati minimum = kuning, di bawah minimum = merah', () => {
  // min 10, warn 80% -> kuning bila stok <= 12.5
  assert.equal(evaluate({ ...base, received: 40, used: 28 }).flags.find((f) => f.type === 'STOCK').level, 'YELLOW');
  assert.equal(evaluate({ ...base, received: 40, used: 30 }).flags.find((f) => f.type === 'STOCK').level, 'RED');
  assert.equal(evaluate({ ...base, received: 40, used: 20 }).flags.find((f) => f.type === 'STOCK'), undefined);
});

test('level keseluruhan = penanda terburuk', () => {
  const s = evaluate({ ...base, received: 85, used: 80 }); // pengadaan 85% kuning, stok 5 merah
  assert.equal(s.level, 'RED');
});

test('proyeksi permintaan pembelian', () => {
  const sm = { ...base, received: 50, onOrder: 20 };
  assert.equal(projectRequest(sm, 5).level, 'GREEN');
  assert.equal(projectRequest(sm, 15).level, 'YELLOW');
  const over = projectRequest(sm, 40);
  assert.equal(over.level, 'RED');
  assert.match(over.message, /melebihi kebutuhan 100 sebesar 10/);
});
