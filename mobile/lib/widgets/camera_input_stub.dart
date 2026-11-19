import 'dart:typed_data';

import 'package:flutter/widgets.dart';

/// Versi non-web: tidak dipakai (aplikasi Android/iOS memakai image_picker biasa).
const bool nativeCameraSupported = false;

class NativeCameraOverlay extends StatelessWidget {
  final bool enabled;
  final Widget child;
  final void Function(Uint8List bytes, String name) onPicked;
  final VoidCallback? onTapStart;
  const NativeCameraOverlay({
    super.key,
    required this.enabled,
    required this.child,
    required this.onPicked,
    this.onTapStart,
  });

  @override
  Widget build(BuildContext context) => child;
}
