'use strict';
/**
 * Data referensi Laporan Harian K3, diambil dari format laporan proyek (artifact "Laporan Harian K3").
 * key: { id: label Indonesia, t: judul, c: caption foto, w: uraian pekerjaan, o: observasi K3,
 *        heavy: melibatkan alat berat, hse: aktivitas pengawasan K3 (tidak masuk uraian pekerjaan) }
 */
const ACTIVITIES = {
  tbm: { id: 'Toolbox Meeting / Safety Briefing', t: 'Toolbox Meeting (TBM) / Safety Briefing', c: 'TOOLBOX MEETING / SAFETY BRIEFING', w: 'Safety briefing / Toolbox Meeting (TBM) before starting work', o: 'Toolbox Meeting (TBM) / Safety Briefing' },
  mob: { id: 'Mobilisasi alat berat', t: 'Heavy Equipment Mobilization', c: 'HEAVY EQUIPMENT MOBILIZATION', w: 'Mobilization of heavy equipment to the work site', o: 'Heavy Equipment Mobilization & Morning Work Monitoring', heavy: true },
  clear: { id: 'Pembersihan lahan dengan excavator', t: 'Land Clearing with Excavator', c: 'LAND CLEARING WITH EXCAVATOR', w: 'Land clearing of bushes and vegetation using the excavator', o: 'Supervision of Land Clearing with Excavator', heavy: true },
  survey: { id: 'Pengukuran total station', t: 'Total Station Survey', c: 'TOTAL STATION SURVEY', w: 'Site measurement and survey using a total station', o: 'Supervision of Total Station Survey' },
  stake: { id: 'Uitzet / pematokan', t: 'Setting Out / Stake Out', c: 'SETTING OUT / STAKE OUT', w: 'Setting out of building axis and boundary markers', o: 'Supervision of Setting Out Works' },
  excav: { id: 'Galian tanah', t: 'Excavation Works', c: 'EXCAVATION WORKS', w: 'Excavation of soil for foundation works', o: 'Supervision of Excavation Works', heavy: true },
  fill: { id: 'Urugan & pemadatan', t: 'Backfilling & Compaction', c: 'BACKFILLING & COMPACTION', w: 'Backfilling and compaction of soil', o: 'Supervision of Backfilling & Compaction', heavy: true },
  rebar: { id: 'Pekerjaan pembesian', t: 'Rebar Works', c: 'REBAR FABRICATION & INSTALLATION', w: 'Fabrication and installation of reinforcement steel', o: 'Supervision of Rebar Works' },
  form: { id: 'Pemasangan bekisting', t: 'Formwork Installation', c: 'FORMWORK INSTALLATION', w: 'Installation of formwork', o: 'Supervision of Formwork Installation' },
  conc: { id: 'Pengecoran beton', t: 'Concrete Casting', c: 'CONCRETE CASTING', w: 'Concrete casting works', o: 'Supervision of Concrete Casting' },
  found: { id: 'Pekerjaan pondasi', t: 'Foundation Works', c: 'FOUNDATION WORKS', w: 'Foundation construction works', o: 'Supervision of Foundation Works' },
  steel: { id: 'Pemasangan struktur baja', t: 'Steel Structure Erection', c: 'STEEL STRUCTURE ERECTION', w: 'Erection of steel structure', o: 'Supervision of Steel Structure Erection', heavy: true },
  tower: { id: 'Pemasangan tower', t: 'Tower Installation', c: 'TOWER INSTALLATION', w: 'Installation of tower structure', o: 'Supervision of Tower Installation', heavy: true },
  elec: { id: 'Pekerjaan listrik & kabel', t: 'Electrical & Cabling Works', c: 'ELECTRICAL & CABLING WORKS', w: 'Electrical installation and cable laying works', o: 'Supervision of Electrical & Cabling Works' },
  mat: { id: 'Pengiriman & bongkar material', t: 'Material Delivery & Unloading', c: 'MATERIAL DELIVERY & UNLOADING', w: 'Delivery and unloading of materials at the site', o: 'Supervision of Material Delivery & Unloading' },
  clean: { id: 'Pembersihan area kerja', t: 'Site Cleaning & Housekeeping', c: 'SITE CLEANING & HOUSEKEEPING', w: 'Site cleaning and housekeeping after work', o: 'Housekeeping Monitoring' },
  hseq: { id: 'Pengawasan K3 alat berat', t: 'HSE Supervision of Heavy Equipment Work', c: 'HSE SUPERVISION OF HEAVY EQUIPMENT WORK', w: '', o: 'HSE Supervision of Heavy Equipment Work', hse: true },
  hsea: { id: 'Pengawasan K3 area kerja', t: 'HSE Supervision of Work Area', c: 'HSE SUPERVISION OF EXCAVATOR WORK AREA', w: '', o: 'HSE Supervision of Work Area', hse: true },
  mon: { id: 'Pemantauan pekerjaan', t: 'Work Monitoring', c: 'WORK MONITORING', w: '', o: 'Work Monitoring', hse: true },
  custom: { id: 'Aktivitas lain', t: 'Other Activity', c: 'OTHER ACTIVITY', w: 'Other work activity', o: 'Work Monitoring' },
};

const CHECKLIST = [
  'All workers present at the briefing',
  'Workers in good health',
  'Complete PPE (helmet, safety shoes, vest)',
  'Work area safe (fencing, lighting, waste bins)',
  'Evacuation route clear and safe',
  'Fire extinguisher available and in good condition',
  'Work equipment in good condition',
];
const CHECKLIST_ID = [
  'Semua pekerja hadir saat briefing',
  'Pekerja dalam kondisi sehat',
  'APD lengkap (helm, sepatu safety, rompi)',
  'Area kerja aman (pagar, penerangan, tempat sampah)',
  'Jalur evakuasi bebas dan aman',
  'APAR tersedia dan berfungsi baik',
  'Peralatan kerja dalam kondisi baik',
];

const WEATHER = { S: 'Sunny', C: 'Cloudy', L: 'Light Rain', H: 'Heavy Rain' };
const WEATHER_ID = { S: 'Cerah', C: 'Berawan', L: 'Hujan ringan', H: 'Hujan lebat' };

const DEFAULT_SETTINGS = {
  head: 'NATIONAL MARITIME SECURITY SYSTEM (NMSS) BAKAMLA RI',
  title: 'COASTAL STATION INSTALLATION PROJECT – MAKASSAR',
  proj: 'NMSS COASTAL STATION MAKASSAR CONSTRUCTION',
  loc: '',
  client: 'BAKAMLA',
  con: 'PT Prima Integra Utama',
  start: null,
  noFmt: '{no}/HSE.LH/{rom}/{yyyy}',
  insp: [],
  members: [],
  pic: '',
  hse: '',
  pm: '',
  hseM: '',
  ppe: [
    ['Safety Helmet', 'Head Protection', true],
    ['Safety Shoes', 'Foot Protection', true],
    ['Safety Glasses', 'Eye Protection', false],
    ['Safety Vest', 'Enhances Worker Visibility', true],
    ['Work Gloves', 'Hand Protection', false],
  ],
  tbm: true,
  brk: 1,
  useAttendance: true,
  img: { logoL: null, logoR: null, site: null },
};

const DEFAULT_CONTENT = {
  notes: 'All work photo documentation and field measurement results are attached.',
  conclusion: "All of today's activities were carried out smoothly and safely, with no incidents or near misses.",
  checklist: CHECKLIST.map(() => true),
  briefing: "Safety Briefing Topics Delivered: Reminder to always wear complete PPE in the project area; obligation to keep the area around the worksite and workers' mess clean; mandatory site clean-up after work is completed; closed with a group prayer and morning motivational cheer.",
  monitoring: 'Work Area Monitoring: Continuous site monitoring to ensure the work area and personnel remain safe.',
  incident: { occurred: false, type: '', timeLoc: '', desc: '', loss: '', action: '' },
  activities: [],
  weather: {},
  weatherPhotos: { mid: null, aft: null },
  siteTitle: 'SITE PLAN',
  siteNote: '',
  sitePhotoId: null,
  extraMembers: [],
};

/**
 * Logo bawaan kop laporan (backend/assets/logos). Dipakai bila lokasi belum mengunggah logonya sendiri.
 * Kiri: PT Prima Integra Utama (kontraktor), kanan: SRT.
 */
const DEFAULT_LOGOS = { logoL: 'logo-prima.png', logoR: 'logo-srt.png' };

const ROM = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

/** Nomor laporan berurutan per hari sejak tanggal laporan pertama (sama dengan format proyek). */
function reportNumber(settings, date) {
  let n = 1;
  if (settings.start) {
    n = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${settings.start}T00:00:00Z`)) / 864e5) + 1;
    if (n < 1) n = 1;
  }
  const [y, m] = date.split('-').map(Number);
  return String(settings.noFmt || '{no}')
    .replace('{no}', String(n).padStart(3, '0'))
    .replace('{rom}', ROM[m - 1])
    .replace('{yyyy}', String(y));
}

function guessCategory(keys) {
  const k = new Set(keys);
  if (['clear', 'survey', 'mob', 'stake'].some((x) => k.has(x))) return 'Preliminary Works & Land Preparation';
  if (['excav', 'found', 'rebar', 'form', 'conc'].some((x) => k.has(x))) return 'Structural Works';
  if (k.has('tower') || k.has('steel')) return 'Tower & Steel Structure Works';
  if (k.has('elec')) return 'Electrical Works';
  return 'General Works';
}

module.exports = {
  ACTIVITIES, CHECKLIST, CHECKLIST_ID, WEATHER, WEATHER_ID, DEFAULT_SETTINGS, DEFAULT_CONTENT,
  reportNumber, guessCategory, DEFAULT_LOGOS,
};
