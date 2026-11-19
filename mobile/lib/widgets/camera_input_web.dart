import 'dart:js_interop';
import 'dart:typed_data';
import 'dart:ui_web' as ui_web;

import 'package:flutter/widgets.dart';
import 'package:web/web.dart' as web;

/// Di web, kamera dibuka oleh <input type="file" capture="user"> SUNGGUHAN yang diletakkan
/// transparan di atas tombol, sehingga ketukan jari langsung mengenai elemen HTML itu.
///
/// Alasan: Safari & Chrome di iPhone hanya mau membuka kamera bila pemicunya ketukan
/// langsung pada elemen input. Membuka lewat kode (setelah ketukan diproses Flutter)
/// bisa diabaikan diam-diam oleh iOS sehingga kamera tidak muncul.
const bool nativeCameraSupported = true;

int _seq = 0;

class NativeCameraOverlay extends StatefulWidget {
  final bool enabled;
  final Widget child;

  /// Dipanggil setelah foto diambil (bytes JPEG/PNG dari kamera).
  final void Function(Uint8List bytes, String name) onPicked;

  /// Dipanggil saat input diketuk (kamera mulai dibuka).
  final VoidCallback? onTapStart;

  const NativeCameraOverlay({
    super.key,
    required this.enabled,
    required this.child,
    required this.onPicked,
    this.onTapStart,
  });

  @override
  State<NativeCameraOverlay> createState() => _NativeCameraOverlayState();
}

class _NativeCameraOverlayState extends State<NativeCameraOverlay> {
  late final String _viewType = 'native-camera-input-${_seq++}';

  @override
  void initState() {
    super.initState();
    ui_web.platformViewRegistry.registerViewFactory(_viewType, (int _) {
      final input = web.HTMLInputElement()
        ..type = 'file'
        ..accept = 'image/*'
        ..setAttribute('capture', 'user')
        ..setAttribute('aria-label', 'Ambil selfie');
      input.style
        ..width = '100%'
        ..height = '100%'
        ..opacity = '0'
        ..cursor = 'pointer'
        ..margin = '0'
        ..padding = '0'
        ..border = '0'
        ..display = 'block';
      input.onclick = (web.Event _) {
        widget.onTapStart?.call();
      }.toJS;
      input.onchange = (web.Event _) {
        final files = input.files;
        if (files == null || files.length == 0) return;
        final file = files.item(0)!;
        file.arrayBuffer().toDart.then((buf) {
          // Kosongkan agar foto berikutnya tetap memicu "change".
          input.value = '';
          widget.onPicked(buf.toDart.asUint8List(), file.name.isEmpty ? 'selfie.jpg' : file.name);
        });
      }.toJS;
      return input;
    });
  }

  @override
  Widget build(BuildContext context) => Stack(children: [
        widget.child,
        if (widget.enabled) Positioned.fill(child: HtmlElementView(viewType: _viewType)),
      ]);
}
