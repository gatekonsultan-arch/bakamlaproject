/// Tombol kamera "asli" untuk versi web: lihat camera_input_web.dart.
/// Di Android/iOS (aplikasi), [NativeCameraOverlay] hanya menampilkan child-nya.
library;
export 'camera_input_stub.dart' if (dart.library.js_interop) 'camera_input_web.dart';
