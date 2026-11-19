'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { suggestResult } = require('../src/utils/tolerance');

test('toleransi simetris', () => {
  assert.equal(suggestResult('1200', '1205', '±10'), 'APPROVE');
  assert.equal(suggestResult('1200', '1210', '+/-10'), 'APPROVE');
  assert.equal(suggestResult('1200', '1211', '10'), 'REJECT');
  assert.equal(suggestResult('1200', '1189', '± 10 mm'), 'REJECT');
});

test('toleransi tidak simetris', () => {
  assert.equal(suggestResult('150', '158', '+10/-5'), 'APPROVE');
  assert.equal(suggestResult('150', '144', '+10/-5'), 'REJECT');
  assert.equal(suggestResult('150', '146', '+10 -5'), 'APPROVE');
});

test('toleransi persen', () => {
  assert.equal(suggestResult('200', '209', '±5%'), 'APPROVE');
  assert.equal(suggestResult('200', '211', '5%'), 'REJECT');
});

test('desimal dengan koma & satuan', () => {
  assert.equal(suggestResult('12,5 mm', '12,8 mm', '±0,5'), 'APPROVE');
});

test('tidak bisa dihitung -> null (pemeriksa memilih sendiri)', () => {
  assert.equal(suggestResult('', '1200', '±10'), null);
  assert.equal(suggestResult('1200', 'OK', '±10'), null);
  assert.equal(suggestResult('1200', '1205', ''), null);
  assert.equal(suggestResult('Rapi', 'Rapi', 'visual'), null);
});
