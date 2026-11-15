'use strict';
/**
 * Daftar item standar ATP (Acceptance Test Procedure) pekerjaan struktur.
 * Disalin ke setiap dokumen ATP saat dibuat; Site Manager bisa mengubah, menambah, atau menghapus item.
 * Nilai rencana (DED) & toleransi diisi sesuai gambar kerja/spesifikasi proyek.
 */
const SECTIONS = {
  A: 'FOUNDATION WORKS',
  B: 'REINFORCEMENT WORKS',
  C: 'COLUMN WORKS',
  D: 'BEAM WORKS',
  E: 'SLAB WORKS',
  F: 'OTHER WORKS',
};

const SECTIONS_ID = {
  A: 'Pekerjaan Fondasi', B: 'Pekerjaan Pembesian', C: 'Pekerjaan Kolom',
  D: 'Pekerjaan Balok', E: 'Pekerjaan Plat Lantai', F: 'Pekerjaan Lain',
};

// [deskripsi, satuan]; satuan kosong = pemeriksaan visual (hasil dipilih manual)
const STANDARD_ITEMS = {
  A: [
    ['Foundation width dimension', 'mm'],
    ['Foundation length dimension', 'mm'],
    ['Foundation excavation depth', 'mm'],
    ['Lean concrete (blinding) thickness', 'mm'],
    ['Top of foundation elevation', 'mm'],
    ['Foundation position / axis alignment', 'mm'],
  ],
  B: [
    ['Main rebar diameter', 'mm'],
    ['Number of main rebars', 'pcs'],
    ['Stirrup diameter', 'mm'],
    ['Stirrup spacing', 'mm'],
    ['Concrete cover (decking) thickness', 'mm'],
    ['Lap splice length', 'mm'],
    ['Rebar tying, cleanliness & condition (visual)', ''],
  ],
  C: [
    ['Column width', 'mm'],
    ['Column depth', 'mm'],
    ['Column height', 'mm'],
    ['Column verticality (plumbness)', 'mm'],
    ['Column position / axis alignment', 'mm'],
    ['Formwork alignment & bracing (visual)', ''],
  ],
  D: [
    ['Beam width', 'mm'],
    ['Beam depth', 'mm'],
    ['Beam span length', 'mm'],
    ['Beam bottom elevation', 'mm'],
    ['Beam alignment', 'mm'],
  ],
  E: [
    ['Slab thickness', 'mm'],
    ['Top of slab elevation', 'mm'],
    ['Slab flatness / levelness', 'mm'],
    ['Slab dimension (length x width)', 'mm'],
    ['Concrete surface finish (visual)', ''],
  ],
};

module.exports = { SECTIONS, SECTIONS_ID, STANDARD_ITEMS };
