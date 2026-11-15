'use strict';

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const badRequest = (msg, details) => new HttpError(400, msg, details);
const unauthorized = (msg = 'Sesi tidak valid, silakan login kembali') => new HttpError(401, msg);
const forbidden = (msg = 'Anda tidak memiliki akses') => new HttpError(403, msg);
const notFound = (msg = 'Data tidak ditemukan') => new HttpError(404, msg);
const conflict = (msg, details) => new HttpError(409, msg, details);
const unprocessable = (msg, details) => new HttpError(422, msg, details);

/** Cek apakah error Oracle adalah pelanggaran UNIQUE constraint. */
const isUniqueViolation = (err) => err && err.errorNum === 1;

module.exports = {
  HttpError, badRequest, unauthorized, forbidden, notFound, conflict, unprocessable,
  isUniqueViolation,
};
