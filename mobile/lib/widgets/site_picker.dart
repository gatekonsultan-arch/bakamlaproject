import 'package:flutter/material.dart';

import '../main.dart';
import '../models/models.dart';
import '../services/api.dart';

/// Pilihan lokasi. User yang ditugaskan ke satu lokasi otomatis terkunci ke lokasinya.
class SitePicker extends StatefulWidget {
  final int? value;
  final ValueChanged<int?> onChanged;
  final bool allowAll;
  const SitePicker({super.key, required this.value, required this.onChanged, this.allowAll = true});

  @override
  State<SitePicker> createState() => _SitePickerState();
}

class _SitePickerState extends State<SitePicker> {
  List<Site> _sites = [];

  @override
  void initState() {
    super.initState();
    Api.instance.get('/sites').then((r) {
      if (!mounted) return;
      setState(() => _sites =
          (r['sites'] as List).map((e) => Site.fromJson(e as Map<String, dynamic>)).toList());
      if (!widget.allowAll && widget.value == null && _sites.isNotEmpty) {
        widget.onChanged(auth.user!.siteId ?? _sites.first.id);
      }
    }).catchError((_) {});
  }

  @override
  Widget build(BuildContext context) {
    final u = auth.user!;
    final locked = u.siteId != null && const {'SITE_MANAGER', 'LOGISTIK', 'HSE_OFFICER'}.contains(u.role);
    if (locked) {
      return InputDecorator(
        decoration: const InputDecoration(labelText: 'Lokasi', border: OutlineInputBorder(), isDense: true),
        child: Text(u.siteName ?? '-'),
      );
    }
    final ids = _sites.map((s) => s.id).toSet();
    return DropdownButtonFormField<int?>(
      value: ids.contains(widget.value) ? widget.value : null,
      isExpanded: true,
      decoration: const InputDecoration(labelText: 'Lokasi', border: OutlineInputBorder(), isDense: true),
      items: [
        if (widget.allowAll) const DropdownMenuItem<int?>(value: null, child: Text('Semua lokasi')),
        for (final s in _sites) DropdownMenuItem<int?>(value: s.id, child: Text(s.name)),
      ],
      onChanged: widget.onChanged,
    );
  }
}
