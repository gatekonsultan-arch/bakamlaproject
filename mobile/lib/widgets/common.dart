import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

final fmtTime = DateFormat('HH:mm', 'id_ID');
final fmtDate = DateFormat('EEEE, d MMM yyyy', 'id_ID');
final fmtYmd = DateFormat('yyyy-MM-dd');

void showSnack(BuildContext context, String msg, {bool error = false}) {
  final cs = Theme.of(context).colorScheme;
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(
      content: Text(msg),
      backgroundColor: error ? cs.error : null,
      behavior: SnackBarBehavior.floating,
    ));
}

String formatDuration(Duration d) {
  final h = d.inHours;
  final m = d.inMinutes.remainder(60);
  return '${h}j ${m}m';
}

/// Pembatas lebar konten agar nyaman di layar web lebar.
class Constrained extends StatelessWidget {
  final Widget child;
  final double maxWidth;
  const Constrained({super.key, required this.child, this.maxWidth = 720});

  @override
  Widget build(BuildContext context) => Align(
        alignment: Alignment.topCenter,
        child: ConstrainedBox(constraints: BoxConstraints(maxWidth: maxWidth), child: child),
      );
}

class EmptyState extends StatelessWidget {
  final IconData icon;
  final String text;
  const EmptyState({super.key, required this.icon, required this.text});

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.all(32),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(icon, size: 48, color: Theme.of(context).colorScheme.outline),
          const SizedBox(height: 12),
          Text(text, textAlign: TextAlign.center),
        ]),
      );
}

/// Membuka halaman cetak/PDF. Di iPhone (Safari/Chrome) tab baru yang dibuka setelah menunggu
/// server diblokir sebagai pop-up, jadi di sana halaman dibuka di tab yang sama
/// (kembali ke aplikasi dengan tombol Back).
Future<void> openPrintPage(String url) async {
  final iosWeb = kIsWeb && defaultTargetPlatform == TargetPlatform.iOS;
  final ok = await launchUrl(Uri.parse(url), webOnlyWindowName: iosWeb ? '_self' : '_blank');
  if (!ok) throw Exception('Tidak dapat membuka halaman cetak');
}

/// Kolom jam dengan pemilih jam (format 24 jam). Mengganti ketik manual "HH:MM" yang sulit di HP.
class TimePickerField extends StatelessWidget {
  final String? value;
  final String label;
  final bool enabled;
  final ValueChanged<String> onChanged;
  final double? width;
  const TimePickerField({
    super.key,
    required this.value,
    required this.label,
    required this.onChanged,
    this.enabled = true,
    this.width,
  });

  static TimeOfDay? parse(String? v) {
    final m = RegExp(r'^(\d{1,2}):(\d{2})$').firstMatch(v ?? '');
    return m == null ? null : TimeOfDay(hour: int.parse(m.group(1)!), minute: int.parse(m.group(2)!));
  }

  Future<void> _pick(BuildContext context) async {
    final t = await showTimePicker(
      context: context,
      initialTime: parse(value) ?? TimeOfDay.now(),
      helpText: label,
      builder: (ctx, child) => MediaQuery(
        data: MediaQuery.of(ctx).copyWith(alwaysUse24HourFormat: true),
        child: child!,
      ),
    );
    if (t != null) {
      onChanged('${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}');
    }
  }

  @override
  Widget build(BuildContext context) => SizedBox(
        width: width,
        child: InkWell(
          onTap: enabled ? () => _pick(context) : null,
          child: InputDecorator(
            isEmpty: value == null || value!.isEmpty,
            decoration: InputDecoration(
              labelText: label,
              isDense: true,
              enabled: enabled,
              suffixIcon: const Icon(Icons.schedule, size: 18),
            ),
            child: Text(value ?? ''),
          ),
        ),
      );
}
