import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../services/api.dart';
import '../widgets/common.dart';
import '../widgets/site_picker.dart';

/// Pengaturan laporan per lokasi: kop, data proyek, tim, APD, logo & site plan dasar.
class HseSettingsScreen extends StatefulWidget {
  final int? siteId;
  const HseSettingsScreen({super.key, this.siteId});
  @override
  State<HseSettingsScreen> createState() => _HseSettingsScreenState();
}

class _HseSettingsScreenState extends State<HseSettingsScreen> {
  late int? _siteId = widget.siteId;
  Map<String, dynamic>? _s;
  final Map<String, TextEditingController> _c = {};
  bool _busy = false;

  static const _text = {
    'head': 'Judul kop (baris 1)',
    'title': 'Judul laporan (baris 2)',
    'proj': 'Nama proyek',
    'loc': 'Lokasi (alamat lengkap)',
    'client': 'Client',
    'con': 'Kontraktor',
    'start': 'Tanggal laporan pertama No. 001 (YYYY-MM-DD)',
    'noFmt': 'Format nomor ({no} urut, {rom} bulan romawi, {yyyy} tahun)',
    'pic': 'Nama PIC Site',
    'hse': 'Nama HSE Officer',
    'pm': 'Nama Project Manager',
    'hseM': 'Nama HSE Manager',
  };

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (_siteId == null) return;
    final r = await Api.instance.get('/hse-reports/settings/$_siteId');
    final s = r['settings'] as Map<String, dynamic>;
    setState(() {
      _s = s;
      for (final k in _text.keys) {
        (_c[k] ??= TextEditingController()).text = '${s[k] ?? ''}';
      }
      (_c['insp'] ??= TextEditingController()).text = (s['insp'] as List).join('\n');
      (_c['members'] ??= TextEditingController()).text =
          (s['members'] as List).map((m) => '${(m as List)[0]} · ${m[1]}').join('\n');
      (_c['brk'] ??= TextEditingController()).text = '${s['brk']}';
    });
  }

  Future<void> _save() async {
    setState(() => _busy = true);
    try {
      final body = <String, dynamic>{
        for (final k in _text.keys) k: _c[k]!.text.trim(),
        'insp': _c['insp']!.text.split('\n').map((s) => s.trim()).where((s) => s.isNotEmpty).toList(),
        'members': _c['members']!
            .text
            .split('\n')
            .map((l) => l.split('·').map((s) => s.trim()).toList())
            .where((p) => p.first.isNotEmpty)
            .map((p) => [p[0], p.length > 1 ? p[1] : 'Worker'])
            .toList(),
        'ppe': _s!['ppe'],
        'tbm': _s!['tbm'],
        'useAttendance': _s!['useAttendance'],
        'brk': double.tryParse(_c['brk']!.text.replaceAll(',', '.')) ?? 1,
      };
      if ((body['start'] as String).isEmpty) body['start'] = null;
      await Api.instance.put('/hse-reports/settings/$_siteId', body);
      if (mounted) showSnack(context, 'Pengaturan disimpan');
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _upload(String slot) async {
    final x = await ImagePicker().pickImage(source: ImageSource.gallery);
    if (x == null) return;
    try {
      final r = await Api.instance.upload('/hse-reports/settings/$_siteId/image/$slot',
          [(field: 'file', filename: x.name, bytes: await x.readAsBytes())]);
      setState(() => _s = r['settings'] as Map<String, dynamic>);
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = _s;
    return Scaffold(
      appBar: AppBar(title: const Text('Pengaturan Laporan K3'), actions: [
        if (s != null)
          TextButton.icon(onPressed: _busy ? null : _save, icon: const Icon(Icons.save), label: const Text('Simpan')),
      ]),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Constrained(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            SitePicker(value: _siteId, allowAll: false, onChanged: (v) {
              setState(() => _siteId = v);
              _load();
            }),
            const SizedBox(height: 8),
            const Text('Isian tampil di laporan resmi, jadi tulis dalam bahasa Inggris.', style: TextStyle(fontSize: 12)),
            if (s == null)
              const Padding(padding: EdgeInsets.all(32), child: Center(child: Text('Pilih lokasi')))
            else ...[
              for (final e in _text.entries)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: TextField(controller: _c[e.key], decoration: InputDecoration(labelText: e.value, border: const OutlineInputBorder())),
                ),
              const SizedBox(height: 12),
              TextField(
                  controller: _c['insp'],
                  maxLines: 3,
                  decoration: const InputDecoration(labelText: 'Bakamla RI (User/Inspector), satu nama per baris', border: OutlineInputBorder())),
              const SizedBox(height: 12),
              TextField(
                  controller: _c['members'],
                  maxLines: 5,
                  decoration: const InputDecoration(
                      labelText: 'Personel tetap tanpa akun aplikasi (Nama · Jabatan per baris)',
                      helperText: 'Pegawai yang absen lewat aplikasi otomatis masuk daftar anggota',
                      border: OutlineInputBorder())),
              const SizedBox(height: 12),
              TextField(
                  controller: _c['brk'],
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(labelText: 'Istirahat (jam, untuk hitung man-hours)', border: OutlineInputBorder())),
              SwitchListTile(
                title: const Text('Ambil anggota tim dari absensi'),
                value: s['useAttendance'] != false,
                onChanged: (v) => setState(() => s['useAttendance'] = v),
              ),
              SwitchListTile(
                title: const Text('Laporan baru otomatis berisi Toolbox Meeting'),
                value: s['tbm'] == true,
                onChanged: (v) => setState(() => s['tbm'] = v),
              ),
              const SizedBox(height: 8),
              Text('APD yang dipakai', style: Theme.of(context).textTheme.titleMedium),
              for (final p in (s['ppe'] as List))
                CheckboxListTile(
                  title: Text('${p[0]}'),
                  subtitle: Text('${p[1]}'),
                  value: p[2] == true,
                  onChanged: (v) => setState(() => p[2] = v ?? false),
                ),
              const SizedBox(height: 8),
              Text('Logo & site plan dasar', style: Theme.of(context).textTheme.titleMedium),
              for (final slot in const [('logoL', 'Logo kiri (PRIMA)'), ('logoR', 'Logo kanan (SRT)'), ('site', 'Site plan dasar')])
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: SizedBox(
                    width: 64,
                    height: 48,
                    child: (s['imgUrl'] as Map)[slot.$1] == null
                        ? const Icon(Icons.image_not_supported_outlined)
                        : Image.network(Api.instance.abs((s['imgUrl'] as Map)[slot.$1] as String), fit: BoxFit.contain),
                  ),
                  title: Text(slot.$2),
                  subtitle: ((s['imgDefault'] as Map?)?[slot.$1] == true)
                      ? const Text('Logo bawaan (otomatis). Unggah untuk mengganti khusus lokasi ini.', style: TextStyle(fontSize: 12))
                      : null,
                  trailing: OutlinedButton(onPressed: () => _upload(slot.$1), child: const Text('Unggah')),
                ),
            ],
          ]),
        ),
      ]),
    );
  }
}
