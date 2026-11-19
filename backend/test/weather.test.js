'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { effectiveWeather, codes } = require('../src/utils/weather');

const photos = [
  { takenTime: '08:05', sky: 'S', included: true },
  { takenTime: '12:40', sky: 'L', included: true },
  { takenTime: '15:10', sky: 'C', included: true },
];

test('jam kerja terisi otomatis dari foto terdekat', () => {
  const w = codes(effectiveWeather({ photos, start: '08:00', finish: '17:00' }));
  assert.deepEqual(w, { 8: 'S', 9: 'S', 10: 'L', 11: 'L', 12: 'L', 13: 'L', 14: 'C', 15: 'C', 16: 'C' });
});

test('isian manual menang atas otomatis', () => {
  const e = effectiveWeather({ manual: { 9: 'H', 10: '' }, photos, start: '08:00', finish: '17:00' });
  assert.equal(e[9].code, 'H');
  assert.equal(e[9].source, 'manual');
  // kosong = kembali otomatis; 10.30 lebih dekat ke foto 12:40 (130 mnt) daripada 08:05 (145 mnt)
  assert.equal(e[10].code, 'L');
  assert.equal(e[10].source, 'photo');
  assert.equal(e[10].photoTime, '12:40');
});

test('foto tidak masuk laporan / tanpa cuaca / tanpa jam diabaikan', () => {
  const w = codes(effectiveWeather({
    photos: [{ takenTime: '09:00', sky: 'H', included: false }, { takenTime: null, sky: 'L' }, { takenTime: '10:00', sky: '' }],
    start: '08:00', finish: '11:00',
  }));
  assert.deepEqual(w, {});
});

test('jam manual di luar jam kerja tetap ditampilkan', () => {
  const w = codes(effectiveWeather({ manual: { 18: 'L' }, photos: [], start: '08:00', finish: '17:00' }));
  assert.deepEqual(w, { 18: 'L' });
});
