import 'package:firebase_core/firebase_core.dart';

enum AppFlavor { dev, staging, prod }

/// Build-time configuration, supplied via `--dart-define-from-file=config/<env>.json`.
abstract final class AppEnv {
  static const _flavor = String.fromEnvironment(
    'STORIES_FLAVOR',
    defaultValue: 'dev',
  );

  static AppFlavor get flavor => AppFlavor.values.byName(_flavor);

  static const useEmulators = bool.fromEnvironment('USE_EMULATORS');
  static const emulatorHost = String.fromEnvironment(
    'EMULATOR_HOST',
    defaultValue: 'localhost',
  );

  static const _projectId = String.fromEnvironment('FIREBASE_PROJECT_ID');
  static const _apiKey = String.fromEnvironment('FIREBASE_API_KEY');
  static const _appId = String.fromEnvironment('FIREBASE_APP_ID');
  static const _senderId = String.fromEnvironment(
    'FIREBASE_MESSAGING_SENDER_ID',
  );
  static const _authDomain = String.fromEnvironment('FIREBASE_AUTH_DOMAIN');
  static const _storageBucket = String.fromEnvironment(
    'FIREBASE_STORAGE_BUCKET',
  );
  static const _measurementId = String.fromEnvironment(
    'FIREBASE_MEASUREMENT_ID',
  );

  /// reCAPTCHA Enterprise site key for App Check on web. Empty disables App
  /// Check (emulator runs only; enforcement is configured per project).
  static const appCheckWebKey = String.fromEnvironment(
    'APP_CHECK_RECAPTCHA_ENTERPRISE_KEY',
  );

  static bool get isConfigured =>
      _projectId.isNotEmpty && _apiKey.isNotEmpty && _appId.isNotEmpty;

  static FirebaseOptions get firebaseOptions {
    if (!isConfigured) {
      throw StateError(
        'Firebase is not configured. Run with '
        '--dart-define-from-file=config/emulator.json (or dev/staging/prod).',
      );
    }
    return FirebaseOptions(
      apiKey: _apiKey,
      appId: _appId,
      messagingSenderId: _senderId,
      projectId: _projectId,
      authDomain: _authDomain.isEmpty ? null : _authDomain,
      storageBucket: _storageBucket.isEmpty ? null : _storageBucket,
      measurementId: _measurementId.isEmpty ? null : _measurementId,
    );
  }
}
