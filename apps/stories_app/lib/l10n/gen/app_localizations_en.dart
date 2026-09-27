// ignore: unused_import
import 'package:intl/intl.dart' as intl;

import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appTitle => 'Stories';

  @override
  String get tagline => 'Every book begins a new story.';

  @override
  String get signInTitle => 'Welcome back';

  @override
  String get signInSubtitle =>
      'Sign in to borrow, exchange and discover your next book.';

  @override
  String get emailLabel => 'Email';

  @override
  String get passwordLabel => 'Password';

  @override
  String get signInButton => 'Sign in';

  @override
  String get createAccountButton => 'Create an account';

  @override
  String get haveAccountButton => 'I already have an account';

  @override
  String get createAccountTitle => 'Join Stories';

  @override
  String get createAccountSubtitle =>
      'Create your account. You\'ll choose a subscription next.';

  @override
  String get fullNameLabel => 'Full name';

  @override
  String get continueWithGoogle => 'Continue with Google';

  @override
  String get forgotPassword => 'Forgot password?';

  @override
  String resetEmailSent(String email) {
    return 'If an account exists for $email, a reset link is on its way.';
  }

  @override
  String get orDivider => 'or';

  @override
  String get validationEmail => 'Enter a valid email address.';

  @override
  String get validationPassword => 'Use at least 8 characters.';

  @override
  String get validationName => 'Enter your name.';

  @override
  String get navHome => 'Home';

  @override
  String get navExplore => 'Explore';

  @override
  String get navMyBooks => 'My Books';

  @override
  String get navOrders => 'Orders';

  @override
  String get navProfile => 'Profile';

  @override
  String greeting(String name) {
    return 'Hello, $name';
  }

  @override
  String get greetingFallback => 'Hello, reader';

  @override
  String get noMembershipTitle => 'No active membership yet';

  @override
  String get noMembershipMessage =>
      'Subscriptions open soon. Once you subscribe you can borrow within your plan and exchange books as often as you like.';

  @override
  String get exploreEmptyTitle => 'The catalogue is on its way';

  @override
  String get exploreEmptyMessage =>
      'Our librarians are adding books. Check back soon to browse by age, genre and language.';

  @override
  String get myBooksEmptyTitle => 'No books currently borrowed';

  @override
  String get myBooksEmptyMessage =>
      'Books you borrow, reserve or add to your wishlist will appear here.';

  @override
  String get ordersEmptyTitle => 'No upcoming deliveries';

  @override
  String get ordersEmptyMessage =>
      'Home deliveries, return pickups and exchanges will appear here.';

  @override
  String profileSignedInAs(String email) {
    return 'Signed in as $email';
  }

  @override
  String get signOut => 'Sign out';

  @override
  String get errorGenericTitle => 'Something went wrong';

  @override
  String get errorGenericMessage =>
      'Please try again. If it keeps happening, contact your branch.';

  @override
  String get retry => 'Try again';

  @override
  String get authErrorInvalidCredentials =>
      'That email and password don\'t match. Check them and try again, or reset your password.';

  @override
  String get authErrorEmailInUse =>
      'An account already exists for this email. Sign in instead.';

  @override
  String get authErrorWeakPassword =>
      'Choose a stronger password with at least 8 characters.';

  @override
  String get authErrorTooManyRequests =>
      'Too many attempts. Wait a few minutes, then try again.';

  @override
  String get authErrorNetwork =>
      'You appear to be offline. Check your connection and try again.';

  @override
  String get authErrorPopupClosed => 'Google sign-in was cancelled.';

  @override
  String get authErrorUserDisabled =>
      'This account has been disabled. Please contact Stories support.';
}
