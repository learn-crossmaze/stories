/// The signed-in identity as the app needs it. Authorization (roles,
/// organizations, branches) is resolved separately and enforced server-side.
class AppUser {
  const AppUser({
    required this.uid,
    this.email,
    this.displayName,
    this.emailVerified = false,
  });

  final String uid;
  final String? email;
  final String? displayName;
  final bool emailVerified;
}

enum AuthFailureCode {
  invalidCredentials,
  emailInUse,
  weakPassword,
  tooManyRequests,
  network,
  popupClosed,
  userDisabled,
  unknown,
}

/// A user-presentable auth error. Raw Firebase messages are never shown.
class AuthFailure implements Exception {
  const AuthFailure(this.code);

  final AuthFailureCode code;

  static AuthFailure fromFirebaseCode(String code) =>
      AuthFailure(switch (code) {
        'invalid-credential' ||
        'wrong-password' ||
        'user-not-found' ||
        'invalid-email' => AuthFailureCode.invalidCredentials,
        'email-already-in-use' => AuthFailureCode.emailInUse,
        'weak-password' => AuthFailureCode.weakPassword,
        'too-many-requests' => AuthFailureCode.tooManyRequests,
        'network-request-failed' => AuthFailureCode.network,
        'popup-closed-by-user' ||
        'cancelled-popup-request' => AuthFailureCode.popupClosed,
        'user-disabled' => AuthFailureCode.userDisabled,
        _ => AuthFailureCode.unknown,
      });

  @override
  String toString() => 'AuthFailure($code)';
}
