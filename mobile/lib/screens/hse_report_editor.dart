import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:url_launcher/url_launcher.dart';

import '../services/api.dart';
import '../widgets/common.dart';
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
    setState(() => _busy = true);
    try {
      final r = await _api.post('/hse-reports/${widget.id}/$action', note == null ? {} : {'note': note});
      if (mounted) showSnack(context, r['message'] as String? ?? 'Berhasil');
      await _load();
    } catch (e) {
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
      final ok = await launchUrl(Uri.parse(_api.abs(r['url'] as String)), webOnlyWindowName: '_blank');
      if (!ok && mounted) showSnack(context, 'Tidak dapat membuka halaman cetak', error: true);
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
    }
  }

  // ------------------------------------------------------------ foto
  Future<void> _addPhotos() async {
    if (_dirty && !await _save(quiet: true)) return;
    final picked = await ImagePicker().pickMultiImage(imageQuality: 90, maxWidth: 2400);
    if (picked.isEmpty) return;
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
                child: TextField(
                  controller: _start,
                  enabled: _editable,
                  decoration: const InputDecoration(labelText: 'Jam mulai (HH:MM)', border: OutlineInputBorder()),
                  onChanged: (_) => _touch(() {}),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: _finish,
                  enabled: _editable,
                  decoration: const InputDecoration(labelText: 'Jam selesai (HH:MM)', border: OutlineInputBorder()),
                  onChanged: (_) => _touch(() {}),
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
                      TextFormField(
                        key: ValueKey('cap${p['id']}${p['caption']}'),
                        initialValue: (p['caption'] as String?) ?? '',
                        enabled: _editable,
                        decoration: const InputDecoration(labelText: 'Keterangan foto (huruf besar)', isDense: true),
                        onFieldSubmitted: (v) => _updatePhoto(p, {'caption': v.toUpperCase()}),
                      ),
                      Row(children: [
                        SizedBox(
                          width: 90,
                          child: TextFormField(
                            initialValue: (p['takenTime'] as String?) ?? '',
                            enabled: _editable,
                            decoration: const InputDecoration(labelText: 'Jam', isDense: true),
                            onFieldSubmitted: (v) => _updatePhoto(p, {'takenTime': v.trim().isEmpty ? null : v.trim()}),
                          ),
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
                    SizedBox(
                      width: 80,
                      child: TextFormField(
                        initialValue: a['time'] as String,
                        enabled: _editable,
                        decoration: const InputDecoration(labelText: 'Jam', isDense: true),
                        onChanged: (v) => _touch(() => a['time'] = v.trim()),
                      ),
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
          const Text('Masuk ke tabel cuaca bulanan di laporan.', style: TextStyle(fontSize: 12)),
          const SizedBox(height: 8),
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (var h = a; h < b; h++)
              SizedBox(
                width: 130,
                child: DropdownButtonFormField<String>(
                  value: (w['$h'] as String?) ?? '',
                  isDense: true,
                  decoration: InputDecoration(labelText: '${h.toString().padLeft(2, '0')}.00', border: const OutlineInputBorder()),
                  items: [for (final e in _skyLabels.entries) DropdownMenuItem(value: e.key, child: Text(e.value))],
                  onChanged: _editable ? (v) => _touch(() => w['$h'] = v ?? '') : null,
                ),
              ),
          ]),
          if (_editable)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                icon: const Icon(Icons.auto_fix_high),
                label: const Text('Isi dari cuaca di foto'),
                onPressed: () => _touch(() {
                  for (var h = a; h < b; h++) {
                    final near = _photos.where((p) =>
                        (p['sky'] ?? '') != '' && p['takenTime'] != null && (_toMin(p['takenTime'] as String) ~/ 60 - h).abs() <= 1);
                    if (near.isNotEmpty) w['$h'] = near.first['sky'];
                  }
                }),
              ),
            ),
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
