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
