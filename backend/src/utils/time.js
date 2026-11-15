'use strict';
const config = require('../config');

/** Tanggal lokal (zona APP_TIMEZONE) dalam format YYYY-MM-DD. */
function localDate(date = new Date(), timeZone = config.timezone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function isValidDateStr(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

/** Selisih hari antara dua string YYYY-MM-DD. */
function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

module.exports = { localDate, isValidDateStr, daysBetween };
