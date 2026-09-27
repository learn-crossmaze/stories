import '../../features/auth/domain/auth_models.dart';
import '../../l10n/gen/app_localizations.dart';

extension AuthFailureMessage on AuthFailure {
  String message(AppLocalizations l10n) => switch (code) {
    AuthFailureCode.invalidCredentials => l10n.authErrorInvalidCredentials,
    AuthFailureCode.emailInUse => l10n.authErrorEmailInUse,
    AuthFailureCode.weakPassword => l10n.authErrorWeakPassword,
    AuthFailureCode.tooManyRequests => l10n.authErrorTooManyRequests,
    AuthFailureCode.network => l10n.authErrorNetwork,
    AuthFailureCode.popupClosed => l10n.authErrorPopupClosed,
    AuthFailureCode.userDisabled => l10n.authErrorUserDisabled,
    AuthFailureCode.unknown => l10n.errorGenericMessage,
  };
}
