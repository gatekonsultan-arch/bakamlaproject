import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../services/api.dart';
import '../widgets/common.dart';
import '../widgets/signature_pad.dart';
import 'hse_reports_screen.dart' show hseStatusColors;

const _skyLabels = {'': '—', 'S': 'Cerah', 'C': 'Berawan', 'L': 'Hujan ringan', 'H': 'Hujan lebat'};
const _siteTitles = ['SITE PLAN', 'BUILDING LAYOUT', 'COLUMN PLAN', 'WORK PROGRESS LAYOUT'];

int _toMin(String t) {
  final p = t.split(':');
  return int.parse(p[0]) * 60 + (p.length > 1 ? int.parse(p[1]) : 0);
}

/// Editor Laporan Harian K3 + alur persetujuan + cetak.
class HseReportEditor extends StatefulWidget {
  final int id;
  const HseReportEditor({super.key, required this.id});
  @override
  State<HseReportEditor> createState() => _HseReportEditorState();
}

class _HseReportEditorState extends State<HseReportEditor> {
  final _api = Api.instance;
  Map<String, dynamic>? _report;
  Map<String, dynamic> _content = {};
  List<Map<String, dynamic>> _photos = [];
  List<Map<String, dynamic>> _members = [];
  Map<String, dynamic> _actions = {};
  Map<String, dynamic> _meta = {};
  bool _hasSignature = true;
  Map<String, dynamic> _sigs = {};
  bool _dirty = false;
  bool _busy = false;

  final _start = TextEditingController();
  final _finish = TextEditingController();
  final _category = TextEditingController();
  final _subject = TextEditingController();

  bool get _editable => _actions['edit'] == true;
  Map<String, dynamic> get _lib => (_meta['activities'] as Map?)?.cast<String, dynamic>() ?? {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final res = await Future.wait([_api.get('/hse-reports/${widget.id}'), _api.get('/hse-reports/meta')]);
      final r = res[0];
      setState(() {
        _meta = res[1];
        _report = r['report'] as Map<String, dynamic>;
        _content = jsonDecode(jsonEncode(_report!['content'])) as Map<String, dynamic>;
        _photos = (r['photos'] as List).cast<Map<String, dynamic>>();
        _members = (r['members'] as List).cast<Map<String, dynamic>>();
        _actions = r['actions'] as Map<String, dynamic>;
        _hasSignature = r['hasSignature'] == true;
        _sigs = (r['signatures'] as Map?)?.cast<String, dynamic>() ?? {};
        _start.text = _report!['startTime'] as String;
        _finish.text = _report!['finishTime'] as String;
        _category.text = (_report!['category'] as String?) ?? '';
        _subject.text = (_report!['subject'] as String?) ?? '';
        _dirty = false;
      });
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
    }
  }

  void _touch(VoidCallback f) => setState(() {
        f();
        _dirty = true;
      });

  List<Map<String, dynamic>> get _activities =>
      (_content['activities'] as List).cast<Map<String, dynamic>>();

  Future<bool> _save({bool quiet = false}) async {
    if (!_editable) return true;
    setState(() => _busy = true);
    try {
      _activities.sort((a, b) => _toMin(a['time'] as String).compareTo(_toMin(b['time'] as String)));
      await _api.put('/hse-reports/${widget.id}', {
        'startTime': _start.text.trim(),
        'finishTime': _finish.text.trim(),
        'category': _category.text,
        'subject': _subject.text,
        'content': _content,
      });
      setState(() => _dirty = false);
      if (!quiet && mounted) showSnack(context, 'Laporan disimpan');
      return true;
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
      return false;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _workflow(String action, {String? note}) async {
    if (_dirty && !await _save(quiet: true)) return;
    if (action != 'return' && !_hasSignature) {
      if (!mounted) return;
      final url = await promptSignature(context,
          reason: 'Anda belum memiliki tanda tangan digital. Tanda tangan wajib sebelum mengirim, mengetahui, '
              'atau menyetujui laporan. Gambar langsung atau unggah gambar tanda tangan Anda.');
      if (url == null) return;
      setState(() => _hasSignature = true);
    }
    setState(() => _busy = true);
    try {
      final r = await _api.post('/hse-reports/${widget.id}/$action', note == null ? {} : {'note': note});
      if (mounted) showSnack(context, r['message'] as String? ?? 'Berhasil');
      await _load();
    } catch (e) {
      if (e is ApiException && e.data['code'] == 'SIGNATURE_REQUIRED') setState(() => _hasSignature = false);
      if (mounted) showSnack(context, e.toString(), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _returnForRevision() async {
    final c = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Kembalikan untuk Revisi'),
        content: TextField(controller: c, maxLines: 3, decoration: const InputDecoration(labelText: 'Apa yang perlu diperbaiki?')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Batal')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Kembalikan')),
        ],
      ),
    );
    if (ok == true && c.text.trim().isNotEmpty) await _workflow('return', note: c.text.trim());
  }

  Future<void> _print(String lang) async {
    if (_dirty && !await _save(quiet: true)) return;
    try {
      final r = await _api.post('/hse-reports/${widget.id}/print-link', {'lang': lang});
      await openPrintPage(_api.abs(r['url'] as String));
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
    }
  }

  // ------------------------------------------------------------ foto
  Future<void> _addPhotos() async {
    // Galeri dibuka LANGSUNG saat tombol diketuk (syarat Safari/Chrome di iPhone), baru simpan perubahan.
    // Foto dikirim UTUH (tanpa diperkecil di HP) agar jam & tanggal kamera (EXIF) terbaca server.
    // Server yang memperkecil foto setelah membaca datanya.
    final pickedFuture = ImagePicker().pickMultiImage();
    final picked = await pickedFuture;
    if (picked.isEmpty) return;
    if (_dirty && !await _save(quiet: true)) return;
    setState(() => _busy = true);
    try {
      final files = <({String field, String filename, List<int> bytes})>[];
      final times = <String>[];
      for (final x in picked) {
        files.add((field: 'photos', filename: x.name, bytes: await x.readAsBytes()));
        final lm = await x.lastModified();
        times.add(fmtTime.format(lm));
      }
      final r = await _api.upload('/hse-reports/${widget.id}/photos', files, fields: {'takenTime': times.join(',')});
      setState(() => _photos = (r['photos'] as List).cast<Map<String, dynamic>>());
      if (mounted) showSnack(context, '${picked.length} foto diunggah. Pilih aktivitas untuk tiap foto.');
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _updatePhoto(Map<String, dynamic> p, Map<String, dynamic> change) async {
    try {
      await _api.put('/hse-reports/${widget.id}/photos/${p['id']}', change);
      setState(() => p.addAll(change));
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
    }
  }

  /// Saat foto diberi aktivitas, aktivitas itu otomatis ditambahkan ke uraian pekerjaan (bila belum ada).
  Future<void> _setPhotoActivity(Map<String, dynamic> p, String key) async {
    final l = (_lib[key] as Map).cast<String, dynamic>();
    await _updatePhoto(p, {'activityKey': key, 'caption': l['c']});
    if (!_activities.any((a) => a['caption'] == l['c'])) {
      _touch(() => _activities.add({
            'key': key,
            'time': (p['takenTime'] as String?) ?? _start.text,
            'caption': l['c'],
            'work': l['w'] ?? '',
            'obs': l['o'] ?? '',
            'heavy': l['heavy'] == true,
            'hse': l['hse'] == true,
          }));
    }
  }

  Future<void> _deletePhoto(Map<String, dynamic> p) async {
    try {
      await _api.delete('/hse-reports/${widget.id}/photos/${p['id']}');
      setState(() => _photos.remove(p));
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
    }
  }

  static const _skyCodes = ['S', 'C', 'L', 'H'];

  List<int> _weatherHours(int a, int b) {
    final hours = {for (var h = a; h < b; h++) h};
    final w = (_content['weather'] as Map).cast<String, dynamic>();
    for (final k in w.keys) {
      if (_skyCodes.contains(w[k])) hours.add(int.parse(k));
    }
    return hours.toList()..sort();
  }

  /// Cuaca otomatis per jam dari foto terdekat (aturan sama dengan server: backend/src/utils/weather.js).
  Map<int, ({String code, String photoTime})> _autoWeather() {
    final usable = _photos
        .where((p) => p['included'] == true && _skyCodes.contains(p['sky']) && TimePickerField.parse(p['takenTime'] as String?) != null)
        .toList();
    final out = <int, ({String code, String photoTime})>{};
    if (usable.isEmpty) return out;
    // Dihitung untuk semua jam; tab Cuaca hanya menampilkan jam kerja + jam yang diisi manual.
    for (var h = 0; h < 24; h++) {
      final mid = h * 60 + 30;
      final best = usable.reduce((x, y) =>
          (_toMin(y['takenTime'] as String) - mid).abs() < (_toMin(x['takenTime'] as String) - mid).abs() ? y : x);
      out[h] = (code: best['sky'] as String, photoTime: best['takenTime'] as String);
    }
    return out;
  }

  /// Ubah jam foto manual; aktivitas yang berasal dari foto ini ikut menyesuaikan jamnya.
  Future<void> _setPhotoTime(Map<String, dynamic> p, String time) async {
    final old = p['takenTime'];
    await _updatePhoto(p, {'takenTime': time});
    setState(() {
      p['timeSource'] = 'manual';
      p['timeSourceLabel'] = 'diubah manual';
      for (final a in _activities) {
        if (a['caption'] == p['caption'] && a['time'] == old) {
          a['time'] = time;
          _dirty = true;
        }
      }
      _photos.sort((x, y) => ((x['takenTime'] as String?) ?? '99:99').compareTo((y['takenTime'] as String?) ?? '99:99'));
    });
  }

  // ------------------------------------------------------------ UI
  Widget _field(String label, String key, {int lines = 1}) => TextFormField(
        initialValue: (_content[key] as String?) ?? '',
        enabled: _editable,
        maxLines: lines,
        decoration: InputDecoration(labelText: label, alignLabelWithHint: true, border: const OutlineInputBorder()),
        onChanged: (v) => _touch(() => _content[key] = v),
      );

  Widget _statusCard() {
    final r = _report!;
    final c = hseStatusColors[r['status']] ?? Colors.grey;
    return Card(
      color: Color.alphaBlend(c.withValues(alpha: 0.08), Theme.of(context).colorScheme.surface),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            Icon(Icons.flag, color: c),
            const SizedBox(width: 8),
            Expanded(child: Text('${r['statusLabel']}', style: TextStyle(color: c, fontWeight: FontWeight.bold))),
            PopupMenuButton<String>(
              tooltip: 'Cetak / PDF',
              icon: const Icon(Icons.print),
              onSelected: _print,
              itemBuilder: (_) => const [
                PopupMenuItem(value: 'en', child: Text('Cetak PDF (English, resmi)')),
                PopupMenuItem(value: 'id', child: Text('Cetak PDF (Bahasa Indonesia)')),
              ],
            ),
          ]),
          Text('Disusun: ${r['submittedByName'] ?? r['createdByName']}'
              '${r['acknowledgedByName'] != null ? ' · Diketahui: ${r['acknowledgedByName']}' : ''}'
              '${r['approvedByName'] != null ? ' · Disetujui: ${r['approvedByName']}' : ''}'),
          if (r['revisionNote'] != null && r['status'] == 'REVISION')
            Text('Catatan revisi: ${r['revisionNote']}', style: const TextStyle(color: Color(0xFFD32F2F))),
          if ([_sigs['prepared'], _sigs['acknowledged'], _sigs['approved']].any((u) => u != null)) ...[
            const SizedBox(height: 8),
            Wrap(spacing: 8, runSpacing: 8, children: [
              for (final e in {'Disusun': _sigs['prepared'], 'Diketahui': _sigs['acknowledged'], 'Disetujui': _sigs['approved']}.entries)
                if (e.value != null)
                  Container(
                    width: 110,
                    padding: const EdgeInsets.all(4),
                    color: Colors.white,
                    child: Column(children: [
                      SizedBox(height: 44, child: Image.network(_api.abs(e.value as String), fit: BoxFit.contain)),
                      Text(e.key, style: const TextStyle(fontSize: 11, color: Colors.black87)),
                    ]),
                  ),
            ]),
          ],
          if (!_hasSignature && [_actions['submit'], _actions['acknowledge'], _actions['approve']].contains(true))
            const Padding(
              padding: EdgeInsets.only(top: 8),
              child: Text('⚠ Anda belum mengunggah tanda tangan digital. Anda akan diminta membuatnya saat menandatangani.',
                  style: TextStyle(color: Color(0xFFD32F2F), fontSize: 12)),
            ),
          const SizedBox(height: 8),
          Wrap(spacing: 8, runSpacing: 8, children: [
            if (_actions['submit'] == true)
              FilledButton.icon(
                  onPressed: _busy ? null : () => _workflow('submit'),
                  icon: const Icon(Icons.send),
                  label: const Text('Kirim ke PIC Site')),
            if (_actions['acknowledge'] == true)
              FilledButton.icon(
                  onPressed: _busy ? null : () => _workflow('acknowledge'),
                  icon: const Icon(Icons.visibility),
                  label: const Text('Mengetahui')),
            if (_actions['approve'] == true)
              FilledButton.icon(
                  onPressed: _busy ? null : () => _workflow('approve'),
                  icon: const Icon(Icons.verified),
                  label: const Text('Setujui')),
            if (_actions['returnForRevision'] == true)
              OutlinedButton.icon(
                  onPressed: _busy ? null : _returnForRevision,
                  icon: const Icon(Icons.undo),
                  label: const Text('Kembalikan untuk revisi')),
          ]),
        ]),
      ),
    );
  }

  Widget _infoTab() => ListView(padding: const EdgeInsets.all(16), children: [
        Constrained(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            _statusCard(),
            const SizedBox(height: 12),
            Row(children: [
              Expanded(
                child: TimePickerField(
                  value: _start.text,
                  label: 'Jam mulai',
                  enabled: _editable,
                  onChanged: (v) => _touch(() => _start.text = v),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TimePickerField(
                  value: _finish.text,
                  label: 'Jam selesai',
                  enabled: _editable,
                  onChanged: (v) => _touch(() => _finish.text = v),
                ),
              ),
            ]),
            const SizedBox(height: 12),
            TextField(
                controller: _category,
                enabled: _editable,
                decoration: const InputDecoration(
                    labelText: 'Kategori', helperText: 'Kosongkan untuk ditentukan otomatis dari aktivitas', border: OutlineInputBorder()),
                onChanged: (_) => _touch(() {})),
            const SizedBox(height: 12),
            TextField(
                controller: _subject,
                enabled: _editable,
                decoration: const InputDecoration(labelText: 'Subjek', border: OutlineInputBorder()),
                onChanged: (_) => _touch(() {})),
            const SizedBox(height: 12),
            _field('Catatan (satu baris = satu poin)', 'notes', lines: 4),
            const SizedBox(height: 12),
            _field('Kesimpulan', 'conclusion', lines: 2),
            const SizedBox(height: 16),
            Text('Anggota tim (${_members.length})', style: Theme.of(context).textTheme.titleMedium),
            const Text('Otomatis dari absensi di lokasi + personel di pengaturan. Tambahkan personel tanpa akun di bawah.',
                style: TextStyle(fontSize: 12)),
            for (final m in _members)
              ListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                leading: Icon(m['source'] == 'attendance' ? Icons.fingerprint : Icons.person_outline),
                title: Text('${m['name']}'),
                subtitle: Text('${m['position']}'),
              ),
            TextFormField(
              initialValue: ((_content['extraMembers'] as List?) ?? [])
                  .map((e) => '${(e as List)[0]} · ${e[1]}')
                  .join('\n'),
              enabled: _editable,
              maxLines: 4,
              decoration: const InputDecoration(
                  labelText: 'Personel tambahan hari ini (Nama · Jabatan per baris)', border: OutlineInputBorder()),
              onChanged: (v) => _touch(() => _content['extraMembers'] = v
                  .split('\n')
                  .map((l) => l.split('·').map((s) => s.trim()).toList())
                  .where((p) => p.first.isNotEmpty)
                  .map((p) => [p[0], p.length > 1 ? p[1] : 'Worker'])
                  .toList()),
            ),
          ]),
        ),
      ]);

  Widget _photosTab() {
    final keys = _lib.keys.toList();
    return ListView(padding: const EdgeInsets.all(16), children: [
      Constrained(
        maxWidth: 900,
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          if (_editable)
            FilledButton.icon(
                onPressed: _busy ? null : _addPhotos,
                icon: const Icon(Icons.add_a_photo),
                label: const Text('Tambah Foto Kegiatan')),
          const SizedBox(height: 8),
          if (_photos.isEmpty) const EmptyState(icon: Icons.photo_library_outlined, text: 'Belum ada foto.'),
          for (final p in _photos)
            Card(
              // Kunci per foto: isian (jam, keterangan) tidak tertukar saat urutan berubah setelah upload/hapus.
              key: ValueKey('photo-${p['id']}'),
              child: Padding(
                padding: const EdgeInsets.all(8),
                child: Wrap(spacing: 12, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.start, children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(8),
                    child: Opacity(
                      opacity: p['included'] == true ? 1 : 0.4,
                      child: Image.network(_api.abs(p['url'] as String), width: 160, height: 120, fit: BoxFit.cover,
                          errorBuilder: (_, __, ___) => const SizedBox(width: 160, height: 120, child: Icon(Icons.broken_image))),
                    ),
                  ),
                  SizedBox(
                    width: 360,
                    child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                      DropdownButtonFormField<String>(
                        value: keys.contains(p['activityKey']) ? p['activityKey'] as String : 'custom',
                        isExpanded: true,
                        decoration: const InputDecoration(labelText: 'Aktivitas', isDense: true),
                        items: [
                          for (final k in keys)
                            DropdownMenuItem(value: k, child: Text('${(_lib[k] as Map)['id']}', overflow: TextOverflow.ellipsis)),
                        ],
                        onChanged: _editable ? (v) => _setPhotoActivity(p, v!) : null,
                      ),
                      // Tersimpan saat kolom ditinggalkan (di HP tombol Enter jarang ditekan).
                      Focus(
                        onFocusChange: (has) {
                          final draft = p['_captionDraft'] as String?;
                          if (!has && draft != null && draft.toUpperCase() != p['caption']) {
                            _updatePhoto(p, {'caption': draft.toUpperCase()});
                          }
                        },
                        child: TextFormField(
                          key: ValueKey('cap${p['id']}${p['caption']}'),
                          initialValue: (p['caption'] as String?) ?? '',
                          enabled: _editable,
                          decoration: const InputDecoration(labelText: 'Keterangan foto (huruf besar)', isDense: true),
                          onChanged: (v) => p['_captionDraft'] = v,
                          onFieldSubmitted: (v) => _updatePhoto(p, {'caption': v.toUpperCase()}),
                        ),
                      ),
                      Row(children: [
                        TimePickerField(
                          width: 110,
                          value: p['takenTime'] as String?,
                          label: 'Jam foto',
                          enabled: _editable,
                          onChanged: (v) => _setPhotoTime(p, v),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: DropdownButtonFormField<String>(
                            value: (p['sky'] as String?) ?? '',
                            decoration: const InputDecoration(labelText: 'Cuaca di foto', isDense: true),
                            items: [for (final e in _skyLabels.entries) DropdownMenuItem(value: e.key, child: Text(e.value))],
                            onChanged: _editable ? (v) => _updatePhoto(p, {'sky': v}) : null,
                          ),
                        ),
                      ]),
                      if (p['timeSourceLabel'] != null || p['dateMismatch'] == true)
                        Padding(
                          padding: const EdgeInsets.only(top: 4),
                          child: Wrap(spacing: 8, children: [
                            if (p['timeSourceLabel'] != null)
                              Text(
                                p['timeSource'] == 'file'
                                    ? '⚠ Jam ${p['timeSourceLabel']} (foto tanpa data kamera)'
                                    : 'Jam ${p['timeSourceLabel']}',
                                style: TextStyle(
                                    fontSize: 11, color: p['timeSource'] == 'file' ? const Color(0xFFEF6C00) : Colors.green.shade700),
                              ),
                            if (p['dateMismatch'] == true)
                              Text('⚠ Foto diambil ${p['takenDate']}, bukan tanggal laporan',
                                  style: const TextStyle(fontSize: 11, color: Color(0xFFD32F2F))),
                          ]),
                        ),
                      Row(children: [
                        Switch(
                            value: p['included'] == true,
                            onChanged: _editable ? (v) => _updatePhoto(p, {'included': v}) : null),
                        const Text('Masuk laporan'),
                        const Spacer(),
                        if (_editable)
                          IconButton(
                              tooltip: 'Hapus foto', icon: const Icon(Icons.delete_outline), onPressed: () => _deletePhoto(p)),
                      ]),
                    ]),
                  ),
                ]),
              ),
            ),
          const SizedBox(height: 16),
          Row(children: [
            Expanded(child: Text('Uraian aktivitas (urut jam)', style: Theme.of(context).textTheme.titleMedium)),
            if (_editable)
              PopupMenuButton<String>(
                tooltip: 'Tambah aktivitas',
                icon: const Icon(Icons.playlist_add),
                onSelected: (k) {
                  final l = (_lib[k] as Map).cast<String, dynamic>();
                  _touch(() => _activities.add({
                        'key': k, 'time': _start.text, 'caption': l['c'], 'work': l['w'] ?? '',
                        'obs': l['o'] ?? '', 'heavy': l['heavy'] == true, 'hse': l['hse'] == true,
                      }));
                },
                itemBuilder: (_) => [for (final k in keys) PopupMenuItem(value: k, child: Text('${(_lib[k] as Map)['id']}'))],
              ),
          ]),
          for (final (i, a) in _activities.indexed)
            Card(
              key: ObjectKey(a),
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(children: [
                  Row(children: [
                    TimePickerField(
                      width: 100,
                      value: a['time'] as String?,
                      label: 'Jam',
                      enabled: _editable,
                      onChanged: (v) => _touch(() => a['time'] = v),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: TextFormField(
                        initialValue: a['caption'] as String,
                        enabled: _editable,
                        decoration: const InputDecoration(labelText: 'Nama aktivitas', isDense: true),
                        onChanged: (v) => _touch(() => a['caption'] = v),
                      ),
                    ),
                    if (_editable)
                      IconButton(
                          icon: const Icon(Icons.close), onPressed: () => _touch(() => _activities.removeAt(i))),
                  ]),
                  if (a['hse'] != true)
                    TextFormField(
                      initialValue: a['work'] as String,
                      enabled: _editable,
                      decoration: const InputDecoration(labelText: 'Uraian pekerjaan (bagian 1. WORK)', isDense: true),
                      onChanged: (v) => _touch(() => a['work'] = v),
                    ),
                  TextFormField(
                    initialValue: a['obs'] as String,
                    enabled: _editable,
                    decoration: const InputDecoration(labelText: 'Observasi K3 (bagian E)', isDense: true),
                    onChanged: (v) => _touch(() => a['obs'] = v),
                  ),
                  CheckboxListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    value: a['heavy'] == true,
                    title: const Text('Melibatkan alat berat'),
                    onChanged: _editable ? (v) => _touch(() => a['heavy'] = v) : null,
                  ),
                ]),
              ),
            ),
        ]),
      ),
    ]);
  }

  Widget _k3Tab() {
    final ck = (_content['checklist'] as List).cast<bool>();
    final labels = ((_meta['checklistId'] as List?) ?? const []).cast<String>();
    final inc = (_content['incident'] as Map).cast<String, dynamic>();
    Widget incField(String label, String key) => TextFormField(
          initialValue: (inc[key] as String?) ?? '',
          enabled: _editable,
          decoration: InputDecoration(labelText: label),
          onChanged: (v) => _touch(() => inc[key] = v),
        );
    return ListView(padding: const EdgeInsets.all(16), children: [
      Constrained(
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('Checklist briefing tim', style: Theme.of(context).textTheme.titleMedium),
          for (var i = 0; i < ck.length; i++)
            CheckboxListTile(
              value: ck[i],
              title: Text(i < labels.length ? labels[i] : 'Item ${i + 1}'),
              onChanged: _editable ? (v) => _touch(() => ck[i] = v ?? false) : null,
            ),
          const SizedBox(height: 12),
          _field('Topik safety briefing', 'briefing', lines: 4),
          const SizedBox(height: 12),
          _field('Pemantauan area kerja', 'monitoring', lines: 2),
          const SizedBox(height: 12),
          SwitchListTile(
            title: const Text('Ada insiden / near miss hari ini'),
            value: inc['occurred'] == true,
            onChanged: _editable ? (v) => _touch(() => inc['occurred'] = v) : null,
          ),
          if (inc['occurred'] == true) ...[
            incField('Jenis (mis. Near Miss, First Aid Case, Property Damage)', 'type'),
            incField('Waktu & lokasi', 'timeLoc'),
            incField('Uraian singkat', 'desc'),
            incField('Korban / kerugian', 'loss'),
            incField('Tindakan darurat', 'action'),
          ],
        ]),
      ),
    ]);
  }

  Widget _weatherTab() {
    final w = (_content['weather'] as Map).cast<String, dynamic>();
    int a;
    int b;
    try {
      a = _toMin(_start.text) ~/ 60;
      b = (_toMin(_finish.text) + 59) ~/ 60;
    } catch (_) {
      a = 8;
      b = 17;
    }
    final wp = (_content['weatherPhotos'] as Map).cast<String, dynamic>();
    final auto = _autoWeather();
    final photoItems = [
      const DropdownMenuItem<int?>(value: null, child: Text('— tidak ada —')),
      for (final p in _photos)
        DropdownMenuItem<int?>(value: p['id'] as int, child: Text('${p['takenTime'] ?? '--:--'} · ${p['caption']}', overflow: TextOverflow.ellipsis)),
    ];
    final ids = _photos.map((p) => p['id']).toSet();
    return ListView(padding: const EdgeInsets.all(16), children: [
      Constrained(
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('Cuaca per jam', style: Theme.of(context).textTheme.titleMedium),
          const Text(
              'Terisi OTOMATIS dari "Cuaca di foto" pada foto yang jamnya paling dekat. Ubah bila perlu; pilih "Otomatis" '
              'untuk kembali mengikuti foto. Masuk ke tabel cuaca bulanan di laporan.',
              style: TextStyle(fontSize: 12)),
          if (!_photos.any((p) => (p['sky'] ?? '') != '' && p['included'] == true))
            const Padding(
              padding: EdgeInsets.only(top: 6),
              child: Text('⚠ Belum ada foto yang diberi "Cuaca di foto". Pilih cuaca pada foto di tab Foto & Aktivitas.',
                  style: TextStyle(fontSize: 12, color: Color(0xFFEF6C00))),
            ),
          const SizedBox(height: 8),
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final h in _weatherHours(a, b))
              Builder(builder: (_) {
                final eff = auto[h];
                final manual = (w['$h'] as String?) ?? '';
                return SizedBox(
                  width: 150,
                  child: DropdownButtonFormField<String>(
                    value: _skyCodes.contains(manual) ? manual : 'AUTO',
                    isDense: true,
                    isExpanded: true,
                    decoration: InputDecoration(
                      labelText: '${h.toString().padLeft(2, '0')}.00 · ${_skyCodes.contains(manual) ? 'manual' : 'otomatis'}',
                      border: const OutlineInputBorder(),
                    ),
                    // Teks ringkas di kotak (layar HP sempit); keterangan lengkap tampil saat daftar dibuka.
                    selectedItemBuilder: (_) => [
                      Text(eff == null ? '—' : _skyLabels[eff.code]!, overflow: TextOverflow.ellipsis),
                      for (final c in _skyCodes) Text(_skyLabels[c]!),
                    ],
                    items: [
                      DropdownMenuItem(
                        value: 'AUTO',
                        child: Text(eff == null
                            ? 'Otomatis (belum ada)'
                            : 'Otomatis: ${_skyLabels[eff.code]} (foto ${eff.photoTime})',
                            overflow: TextOverflow.ellipsis),
                      ),
                      for (final c in _skyCodes) DropdownMenuItem(value: c, child: Text(_skyLabels[c]!)),
                    ],
                    onChanged: _editable
                        ? (v) => _touch(() => v == null || v == 'AUTO' ? w.remove('$h') : w['$h'] = v)
                        : null,
                  ),
                );
              }),
          ]),
          const SizedBox(height: 16),
          DropdownButtonFormField<int?>(
            value: ids.contains(wp['mid']) ? wp['mid'] as int? : null,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Foto cuaca siang', border: OutlineInputBorder()),
            items: photoItems,
            onChanged: _editable ? (v) => _touch(() => wp['mid'] = v) : null,
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<int?>(
            value: ids.contains(wp['aft']) ? wp['aft'] as int? : null,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Foto cuaca sore', border: OutlineInputBorder()),
            items: photoItems,
            onChanged: _editable ? (v) => _touch(() => wp['aft'] = v) : null,
          ),
          const SizedBox(height: 24),
          Text('Lembar site plan', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          DropdownButtonFormField<String>(
            value: _siteTitles.contains(_content['siteTitle']) ? _content['siteTitle'] as String : 'SITE PLAN',
            decoration: const InputDecoration(labelText: 'Judul lembar', border: OutlineInputBorder()),
            items: [for (final t in _siteTitles) DropdownMenuItem(value: t, child: Text(t))],
            onChanged: _editable ? (v) => _touch(() => _content['siteTitle'] = v) : null,
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<int?>(
            value: ids.contains(_content['sitePhotoId']) ? _content['sitePhotoId'] as int? : null,
            isExpanded: true,
            decoration: const InputDecoration(
                labelText: 'Gambar denah', helperText: 'Kosong = pakai site plan dasar dari pengaturan', border: OutlineInputBorder()),
            items: photoItems,
            onChanged: _editable ? (v) => _touch(() => _content['sitePhotoId'] = v) : null,
          ),
          const SizedBox(height: 12),
          _field('Keterangan warna (satu baris satu keterangan)', 'siteNote', lines: 3),
        ]),
      ),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final r = _report;
    return PopScope(
      canPop: !_dirty,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        final leave = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text('Perubahan belum disimpan'),
            actions: [
              TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Buang')),
              FilledButton(
                  onPressed: () async {
                    final ok = await _save(quiet: true);
                    if (ctx.mounted) Navigator.pop(ctx, ok);
                  },
                  child: const Text('Simpan')),
            ],
          ),
        );
        if (leave == true && context.mounted) {
          setState(() => _dirty = false);
          Navigator.pop(context);
        }
      },
      child: DefaultTabController(
        length: 4,
        child: Scaffold(
          appBar: AppBar(
            title: Text(r == null ? 'Laporan K3' : '${r['reportNo']}', overflow: TextOverflow.ellipsis),
            actions: [
              if (_editable)
                TextButton.icon(
                  onPressed: _busy || !_dirty ? null : _save,
                  icon: const Icon(Icons.save),
                  label: Text(_dirty ? 'Simpan' : 'Tersimpan'),
                ),
            ],
            bottom: const TabBar(isScrollable: true, tabs: [
              Tab(text: 'Info'),
              Tab(text: 'Foto & Aktivitas'),
              Tab(text: 'K3'),
              Tab(text: 'Cuaca & Denah'),
            ]),
          ),
          body: r == null
              ? const Center(child: CircularProgressIndicator())
              : TabBarView(children: [_infoTab(), _photosTab(), _k3Tab(), _weatherTab()]),
        ),
      ),
    );
  }
}
