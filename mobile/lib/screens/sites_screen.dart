import 'package:flutter/material.dart';

import '../models/models.dart';
import '../services/api.dart';
import '../services/location.dart';
import '../widgets/common.dart';

class SitesScreen extends StatefulWidget {
  const SitesScreen({super.key});
  @override
  State<SitesScreen> createState() => _SitesScreenState();
}

class _SitesScreenState extends State<SitesScreen> {
  List<Site> _sites = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final r = await Api.instance.get('/sites', query: {'all': '1'});
      setState(() => _sites =
          (r['sites'] as List).map((e) => Site.fromJson(e as Map<String, dynamic>)).toList());
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _openForm([Site? s]) async {
    final saved = await showDialog<bool>(context: context, builder: (_) => _SiteForm(site: s));
    if (saved == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _openForm(),
        icon: const Icon(Icons.add_location_alt),
        label: const Text('Tambah'),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: _sites.isEmpty
                  ? ListView(children: const [
                      EmptyState(
                          icon: Icons.place_outlined,
                          text: 'Belum ada lokasi kerja. Tambahkan lokasi agar pegawai bisa absen.')
                    ])
                  : ListView.builder(
                      padding: const EdgeInsets.only(bottom: 88),
                      itemCount: _sites.length,
                      itemBuilder: (context, i) {
                        final s = _sites[i];
                        return Constrained(
                          child: ListTile(
                            leading: Icon(s.isActive ? Icons.place : Icons.location_off),
                            title: Text(s.name),
                            subtitle: Text(
                                '${s.latitude.toStringAsFixed(6)}, ${s.longitude.toStringAsFixed(6)} · radius ${s.radiusM} m'
                                '${s.isActive ? '' : ' · NONAKTIF'}'
                                '${s.address == null ? '' : '\n${s.address}'}'),
                            isThreeLine: s.address != null,
                            onTap: () => _openForm(s),
                          ),
                        );
                      },
                    ),
            ),
    );
  }
}

class _SiteForm extends StatefulWidget {
  final Site? site;
  const _SiteForm({this.site});
  @override
  State<_SiteForm> createState() => _SiteFormState();
}

class _SiteFormState extends State<_SiteForm> {
  final _form = GlobalKey<FormState>();
  late final _name = TextEditingController(text: widget.site?.name);
  late final _address = TextEditingController(text: widget.site?.address);
  late final _lat = TextEditingController(text: widget.site?.latitude.toString());
  late final _lng = TextEditingController(text: widget.site?.longitude.toString());
  late final _radius = TextEditingController(text: '${widget.site?.radiusM ?? 100}');
  late bool _active = widget.site?.isActive ?? true;
  bool _busy = false;

  Future<void> _useCurrent() async {
    setState(() => _busy = true);
    try {
      final p = await LocationService.current();
      _lat.text = p.latitude.toStringAsFixed(7);
      _lng.text = p.longitude.toStringAsFixed(7);
      if (mounted) showSnack(context, 'Koordinat diisi dari GPS (akurasi ${p.accuracy.round()} m)');
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String? _numValidator(String? v, double min, double max) {
    final n = double.tryParse((v ?? '').replaceAll(',', '.'));
    if (n == null || n < min || n > max) return 'Harus angka antara $min dan $max';
    return null;
  }

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _busy = true);
    final body = {
      'name': _name.text.trim(),
      'address': _address.text.trim(),
      'latitude': double.parse(_lat.text.replaceAll(',', '.')),
      'longitude': double.parse(_lng.text.replaceAll(',', '.')),
      'radiusM': int.parse(_radius.text),
      'isActive': _active,
    };
    try {
      if (widget.site == null) {
        await Api.instance.post('/sites', body);
      } else {
        await Api.instance.put('/sites/${widget.site!.id}', body);
      }
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: Text(widget.site == null ? 'Tambah Lokasi' : 'Ubah Lokasi'),
        content: SizedBox(
          width: 420,
          child: Form(
            key: _form,
            child: SingleChildScrollView(
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                TextFormField(
                    controller: _name,
                    decoration: const InputDecoration(labelText: 'Nama lokasi'),
                    validator: (v) => (v == null || v.trim().isEmpty) ? 'Wajib diisi' : null),
                TextFormField(
                    controller: _address,
                    decoration: const InputDecoration(labelText: 'Alamat (opsional)')),
                Row(children: [
                  Expanded(
                      child: TextFormField(
                          controller: _lat,
                          decoration: const InputDecoration(labelText: 'Latitude'),
                          keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true),
                          validator: (v) => _numValidator(v, -90, 90))),
                  const SizedBox(width: 12),
                  Expanded(
                      child: TextFormField(
                          controller: _lng,
                          decoration: const InputDecoration(labelText: 'Longitude'),
                          keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true),
                          validator: (v) => _numValidator(v, -180, 180))),
                ]),
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton.icon(
                      onPressed: _busy ? null : _useCurrent,
                      icon: const Icon(Icons.my_location),
                      label: const Text('Pakai lokasi saya sekarang')),
                ),
                TextFormField(
                    controller: _radius,
                    decoration: const InputDecoration(labelText: 'Radius absen (meter)'),
                    keyboardType: TextInputType.number,
                    validator: (v) {
                      final n = int.tryParse(v ?? '');
                      return (n == null || n < 10 || n > 50000) ? 'Antara 10 - 50000 meter' : null;
                    }),
                SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Aktif'),
                    value: _active,
                    onChanged: (v) => setState(() => _active = v)),
              ]),
            ),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Batal')),
          FilledButton(onPressed: _busy ? null : _save, child: const Text('Simpan')),
        ],
      );
}
