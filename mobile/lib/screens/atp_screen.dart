import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:url_launcher/url_launcher.dart';

import '../config.dart';
import '../main.dart';
import '../services/api.dart';
import '../widgets/common.dart';
import '../widgets/signature_pad.dart';
import '../widgets/site_picker.dart';

const _statusColor = {
  'DRAFT': Color(0xFF757575),
  'SUBMITTED': Color(0xFFF9A825),
  'APPROVED': Color(0xFF2E7D32),
  'REVISION': Color(0xFFD32F2F),
};
const _ok = Color(0xFF2E7D32);
const _no = Color(0xFFD32F2F);

/// ATP Checklist: pemeriksaan mutu pekerjaan struktur (Site Manager isi, PM setujui, dicetak untuk pengawas).
class AtpScreen extends StatefulWidget {
  const AtpScreen({super.key});
  @override
  State<AtpScreen> createState() => _AtpScreenState();
}

class _AtpScreenState extends State<AtpScreen> {
  int? _siteId;
  List<Map<String, dynamic>> _docs = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final r = await Api.instance.get('/atp', query: {if (_siteId != null) 'siteId': '$_siteId'});
      setState(() => _docs = (r['documents'] as List).cast<Map<String, dynamic>>());
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _create() async {
    final meta = await Api.instance.get('/atp/meta');
    if (!mounted) return;
    final sections = (meta['sectionsId'] as Map).cast<String, dynamic>();
    int? siteId = _siteId ?? auth.user!.siteId;
    final area = TextEditingController();
    final chosen = <String>{'A'};
    DateTime date = DateTime.now();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => AlertDialog(
          title: const Text('ATP Baru'),
          content: SizedBox(
            width: 420,
            child: SingleChildScrollView(
              child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
                SitePicker(value: siteId, allowAll: false, onChanged: (v) => set(() => siteId = v)),
                TextField(controller: area, decoration: const InputDecoration(labelText: 'Lokasi / area pekerjaan (mis. Gedung Utama, As 1–4)')),
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  icon: const Icon(Icons.event),
                  label: Text('Tanggal pemeriksaan: ${fmtDate.format(date)}'),
                  onPressed: () async {
                    final d = await showDatePicker(context: ctx, firstDate: DateTime(2024), lastDate: DateTime.now(), initialDate: date);
                    if (d != null) set(() => date = d);
                  },
                ),
                const SizedBox(height: 8),
                const Text('Jenis pekerjaan yang diperiksa (item standar akan disiapkan, bisa diubah):'),
                for (final e in sections.entries.where((e) => e.key != 'F'))
                  CheckboxListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    value: chosen.contains(e.key),
                    title: Text('${e.key}. ${e.value}'),
                    onChanged: (v) => set(() => v == true ? chosen.add(e.key) : chosen.remove(e.key)),
                  ),
              ]),
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Batal')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Buat')),
          ],
        ),
      ),
    );
    if (ok != true || siteId == null) return;
    try {
      final r = await Api.instance.post('/atp', {
        'siteId': siteId, 'workArea': area.text, 'inspectionDate': fmtYmd.format(date), 'sections': chosen.toList()..sort(),
      });
      if (!mounted) return;
      await Navigator.push(context, MaterialPageRoute(builder: (_) => AtpEditor(id: r['id'] as int)));
      _load();
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      floatingActionButton: canWriteAtp(auth.user!.role)
          ? FloatingActionButton.extended(onPressed: _create, icon: const Icon(Icons.add_task), label: const Text('ATP Baru'))
          : null,
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.fromLTRB(12, 12, 12, 88), children: [
          Constrained(
            maxWidth: 960,
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              SitePicker(value: _siteId, onChanged: (v) {
                setState(() => _siteId = v);
                _load();
              }),
              const SizedBox(height: 8),
              if (_loading)
                const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator()))
              else if (_docs.isEmpty)
                const EmptyState(icon: Icons.fact_check_outlined, text: 'Belum ada dokumen ATP.')
              else
                for (final d in _docs)
                  Card(
                    child: ListTile(
                      leading: CircleAvatar(
                        backgroundColor: (_statusColor[d['status']] ?? Colors.grey).withValues(alpha: 0.15),
                        child: Icon(Icons.fact_check, color: _statusColor[d['status']]),
                      ),
                      title: Text('${d['docNo']} · ${d['workArea']}'),
                      subtitle: Text('${d['siteName']} · ${d['inspectionDate']} · ${d['itemCount']} item'
                          '${(d['rejectCount'] as num) > 0 ? ' · ${d['rejectCount']} REJECT' : ''}\n${d['statusLabel']}'),
                      isThreeLine: true,
                      onTap: () async {
                        await Navigator.push(context, MaterialPageRoute(builder: (_) => AtpEditor(id: d['id'] as int)));
                        _load();
                      },
                    ),
                  ),
            ]),
          ),
        ]),
      ),
    );
  }
}

class AtpEditor extends StatefulWidget {
  final int id;
  const AtpEditor({super.key, required this.id});
  @override
  State<AtpEditor> createState() => _AtpEditorState();
}

class _AtpEditorState extends State<AtpEditor> {
  Map<String, dynamic>? _doc;
  List<Map<String, dynamic>> _items = [];
  Map<String, dynamic> _summary = {};
  Map<String, dynamic> _actions = {};
  Map<String, dynamic> _sections = {};
  final _notes = TextEditingController();
  bool _dirty = false;
  bool _busy = false;

  bool get _editable => _actions['edit'] == true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await Future.wait([Api.instance.get('/atp/${widget.id}'), Api.instance.get('/atp/meta')]);
      setState(() {
        _doc = r[0]['document'] as Map<String, dynamic>;
        _items = (r[0]['items'] as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
        _summary = r[0]['summary'] as Map<String, dynamic>;
        _actions = r[0]['actions'] as Map<String, dynamic>;
        _sections = (r[1]['sections'] as Map).cast<String, dynamic>();
        _notes.text = (_doc!['notes'] as String?) ?? '';
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

  /// Saran hasil (sama dengan aturan server): APPROVE bila |aktual − DED| dalam toleransi.
  String? _suggest(Map<String, dynamic> i) {
    double? n(dynamic s) {
      final m = RegExp(r'-?\d+(\.\d+)?').firstMatch('${s ?? ''}'.replaceAll(',', '.'));
      return m == null ? null : double.parse(m.group(0)!);
    }
    final p = n(i['planned']), a = n(i['actual']);
    final t = '${i['tolerance'] ?? ''}'.replaceAll(',', '.').replaceAll(' ', '');
    if (p == null || a == null || t.isEmpty) return null;
    final pct = t.contains('%');
    double scale(double v) => pct ? p.abs() * v / 100 : v;
    double plus, minus;
    final asym = RegExp(r'\+(\d+(?:\.\d+)?)%?/?-(\d+(?:\.\d+)?)').firstMatch(t);
    if (asym != null) {
      plus = scale(double.parse(asym.group(1)!));
      minus = scale(double.parse(asym.group(2)!));
    } else {
      final v = n(t.replaceFirst(RegExp(r'^(±|\+/-|\+-)'), ''));
      if (v == null) return null;
      plus = minus = scale(v.abs());
    }
    final diff = a - p;
    return diff <= plus + 1e-9 && -diff <= minus + 1e-9 ? 'APPROVE' : 'REJECT';
  }

  Future<bool> _save({bool quiet = false}) async {
    if (!_editable) return true;
    setState(() => _busy = true);
    try {
      await Api.instance.put('/atp/${widget.id}', {
        'notes': _notes.text,
        'items': [
          for (final i in _items)
            {
              if (i['id'] != null) 'id': i['id'],
              'section': i['section'], 'description': i['description'], 'unit': i['unit'],
              'planned': i['planned'], 'actual': i['actual'], 'tolerance': i['tolerance'],
              'result': i['result'], 'remarks': i['remarks'],
            },
        ],
      });
      if (!quiet && mounted) showSnack(context, 'ATP disimpan');
      await _load();
      return true;
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
      return false;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _act(String action, [Map<String, dynamic>? body]) async {
    if (_dirty && !await _save(quiet: true)) return;
    setState(() => _busy = true);
    try {
      final r = await Api.instance.post('/atp/${widget.id}/$action', body ?? {});
      if (mounted) showSnack(context, r['message'] as String);
      await _load();
    } on ApiException catch (e) {
      if (e.data['code'] == 'SIGNATURE_REQUIRED' && mounted) {
        final url = await promptSignature(context, reason: e.message);
        if (url != null) {
          if (mounted) setState(() => _busy = false);
          return _act(action, body);
        }
      } else if (mounted) {
        showSnack(context, e.message, error: true);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _photo(Map<String, dynamic> item) async {
    if (item['id'] == null || _dirty) {
      if (!await _save(quiet: true) || !mounted) return;
      return showSnack(context, 'Item disimpan. Ketuk lagi untuk menambah foto.');
    }
    XFile? x;
    try {
      x = await ImagePicker().pickImage(source: ImageSource.camera, maxWidth: 2000);
    } catch (_) {
      x = await ImagePicker().pickImage(source: ImageSource.gallery, maxWidth: 2000);
    }
    if (x == null) return;
    try {
      await Api.instance.upload('/atp/${widget.id}/items/${item['id']}/photo', [(field: 'photo', filename: x.name, bytes: await x.readAsBytes())]);
      await _load();
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
    }
  }

  Future<void> _print() async {
    if (_dirty && !await _save(quiet: true)) return;
    try {
      final r = await Api.instance.post('/atp/${widget.id}/print-link', {});
      await launchUrl(Uri.parse(Api.instance.abs(r['url'] as String)), webOnlyWindowName: '_blank');
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
    }
  }

  Widget _field(Map<String, dynamic> i, String key, String label, {double? width}) => SizedBox(
        width: width,
        child: TextFormField(
          initialValue: (i[key] as String?) ?? '',
          enabled: _editable,
          decoration: InputDecoration(labelText: label, isDense: true),
          onChanged: (v) => _touch(() => i[key] = v),
        ),
      );

  Widget _itemCard(Map<String, dynamic> i, int no) {
    final sug = _suggest(i);
    final res = i['result'] as String?;
    final border = res == 'REJECT' ? _no : res == 'APPROVE' ? _ok : Colors.transparent;
    return Card(
      key: ObjectKey(i),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10), side: BorderSide(color: border, width: res == null ? 0 : 1.5)),
      child: Padding(
        padding: const EdgeInsets.all(10),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            Text('$no. ', style: const TextStyle(fontWeight: FontWeight.bold)),
            Expanded(
              child: TextFormField(
                initialValue: i['description'] as String,
                enabled: _editable,
                decoration: const InputDecoration(isDense: true, border: InputBorder.none),
                style: const TextStyle(fontWeight: FontWeight.w600),
                onChanged: (v) => _touch(() => i['description'] = v),
              ),
            ),
            if (_editable)
              IconButton(tooltip: 'Hapus item', icon: const Icon(Icons.delete_outline), onPressed: () => _touch(() => _items.remove(i))),
          ]),
          Wrap(spacing: 10, runSpacing: 6, children: [
            _field(i, 'planned', 'DED (rencana)', width: 110),
            _field(i, 'actual', 'Aktual (as-built)', width: 120),
            _field(i, 'tolerance', 'Toleransi (±10)', width: 110),
            _field(i, 'unit', 'Satuan', width: 70),
          ]),
          const SizedBox(height: 8),
          Wrap(spacing: 8, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
            SegmentedButton<String>(
              emptySelectionAllowed: true,
              segments: const [
                ButtonSegment(value: 'APPROVE', label: Text('APPROVE')),
                ButtonSegment(value: 'REJECT', label: Text('REJECT')),
              ],
              selected: {if (res != null) res},
              onSelectionChanged: _editable ? (v) => _touch(() => i['result'] = v.isEmpty ? null : v.first) : null,
            ),
            if (sug != null && sug != res && _editable)
              ActionChip(
                avatar: Icon(sug == 'APPROVE' ? Icons.check_circle : Icons.error, color: sug == 'APPROVE' ? _ok : _no, size: 18),
                label: Text('Saran: $sug'),
                onPressed: () => _touch(() => i['result'] = sug),
              )
            else if (sug != null)
              Text('sesuai saran toleransi', style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.outline)),
          ]),
          TextFormField(
            initialValue: (i['remarks'] as String?) ?? '',
            enabled: _editable,
            decoration: InputDecoration(
                labelText: res == 'REJECT' ? 'Keterangan perbaikan (wajib untuk REJECT)' : 'Keterangan', isDense: true),
            onChanged: (v) => _touch(() => i['remarks'] = v),
          ),
          const SizedBox(height: 6),
          Row(children: [
            if (i['photoUrl'] != null)
              ClipRRect(
                borderRadius: BorderRadius.circular(6),
                child: Image.network(Api.instance.abs(i['photoUrl'] as String), width: 96, height: 72, fit: BoxFit.cover),
              ),
            if (_editable)
              TextButton.icon(
                onPressed: () => _photo(i),
                icon: const Icon(Icons.add_a_photo, size: 18),
                label: Text(i['photoUrl'] == null ? 'Foto' : 'Ganti foto'),
              ),
          ]),
        ]),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final d = _doc;
    if (d == null) return Scaffold(appBar: AppBar(), body: const Center(child: CircularProgressIndicator()));
    final c = _statusColor[d['status']] ?? Colors.grey;
    var no = 0;
    return Scaffold(
      appBar: AppBar(title: Text('${d['docNo']}'), actions: [
        IconButton(tooltip: 'Cetak / PDF', onPressed: _print, icon: const Icon(Icons.print)),
        if (_editable)
          TextButton.icon(onPressed: _busy || !_dirty ? null : _save, icon: const Icon(Icons.save), label: Text(_dirty ? 'Simpan' : 'Tersimpan')),
      ]),
      body: ListView(padding: const EdgeInsets.all(12), children: [
        Constrained(
          maxWidth: 900,
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Card(
              color: Color.alphaBlend(c.withValues(alpha: 0.08), Theme.of(context).colorScheme.surface),
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Text('${d['statusLabel']}', style: TextStyle(color: c, fontWeight: FontWeight.bold)),
                  Text('${d['siteName']} · ${d['workArea']} · pemeriksaan ${d['inspectionDate']}'),
                  if (d['revisionNote'] != null && d['status'] == 'REVISION')
                    Text('Catatan revisi: ${d['revisionNote']}', style: const TextStyle(color: _no)),
                  const SizedBox(height: 6),
                  Wrap(spacing: 8, children: [
                    Chip(label: Text('${_summary['total']} item')),
                    Chip(avatar: const Icon(Icons.check_circle, color: _ok, size: 18), label: Text('${_summary['approve']} APPROVE')),
                    Chip(avatar: const Icon(Icons.error, color: _no, size: 18), label: Text('${_summary['reject']} REJECT')),
                    if ((_summary['empty'] as num? ?? 0) > 0) Chip(label: Text('${_summary['empty']} belum dinilai')),
                  ]),
                  if (d['status'] == 'APPROVED')
                    const Text('Cetak dokumen ini untuk ditandatangani Inspektur/pengawas pada kolom APPROVED BY.',
                        style: TextStyle(fontSize: 12)),
                  const SizedBox(height: 6),
                  Wrap(spacing: 8, runSpacing: 8, children: [
                    if (_actions['submit'] == true)
                      FilledButton.icon(onPressed: _busy ? null : () => _act('submit'), icon: const Icon(Icons.send), label: const Text('Kirim ke PM')),
                    if (_actions['approve'] == true)
                      FilledButton.icon(onPressed: _busy ? null : () => _act('approve'), icon: const Icon(Icons.verified), label: const Text('Setujui')),
                    if (_actions['returnForRevision'] == true)
                      OutlinedButton.icon(
                        onPressed: _busy
                            ? null
                            : () async {
                                final t = TextEditingController();
                                final ok = await showDialog<bool>(
                                  context: context,
                                  builder: (ctx) => AlertDialog(
                                    title: const Text('Kembalikan untuk revisi'),
                                    content: TextField(controller: t, maxLines: 3, decoration: const InputDecoration(labelText: 'Apa yang perlu diperbaiki?')),
                                    actions: [
                                      TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Batal')),
                                      FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Kembalikan')),
                                    ],
                                  ),
                                );
                                if (ok == true && t.text.trim().isNotEmpty) _act('return', {'note': t.text.trim()});
                              },
                        icon: const Icon(Icons.undo),
                        label: const Text('Kembalikan'),
                      ),
                  ]),
                ]),
              ),
            ),
            for (final sec in _sections.keys)
              if (_items.any((i) => i['section'] == sec) || (_editable && sec != 'F')) ...[
                Padding(
                  padding: const EdgeInsets.fromLTRB(4, 14, 4, 4),
                  child: Row(children: [
                    Expanded(child: Text('$sec. ${_sections[sec]}', style: Theme.of(context).textTheme.titleSmall)),
                    if (_editable)
                      TextButton.icon(
                        onPressed: () => _touch(() => _items.add({'section': sec, 'description': 'Item baru', 'unit': 'mm'})),
                        icon: const Icon(Icons.add, size: 18),
                        label: const Text('Tambah item'),
                      ),
                  ]),
                ),
                for (final i in _items.where((i) => i['section'] == sec)) _itemCard(i, ++no),
              ],
            const SizedBox(height: 12),
            TextField(
              controller: _notes,
              enabled: _editable,
              maxLines: 3,
              decoration: const InputDecoration(labelText: 'Catatan umum', border: OutlineInputBorder()),
              onChanged: (_) => _touch(() {}),
            ),
            const SizedBox(height: 24),
          ]),
        ),
      ]),
    );
  }
}
