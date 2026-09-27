import 'package:flutter_test/flutter_test.dart';
import 'package:stories_app/app/router/router.dart';

void main() {
  group('authRedirect', () {
    test('signed-out users are sent to sign-in', () {
      expect(
        authRedirect(signedIn: false, location: Routes.home),
        Routes.signIn,
      );
      expect(
        authRedirect(signedIn: false, location: Routes.profile),
        Routes.signIn,
      );
    });

    test('signed-out users may stay on sign-in', () {
      expect(authRedirect(signedIn: false, location: Routes.signIn), isNull);
    });

    test('signed-in users leave sign-in for home', () {
      expect(
        authRedirect(signedIn: true, location: Routes.signIn),
        Routes.home,
      );
    });

    test('signed-in users keep their destination', () {
      expect(authRedirect(signedIn: true, location: Routes.orders), isNull);
    });
  });
}
