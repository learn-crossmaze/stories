import 'package:flutter/material.dart';

import 'tokens.dart';

/// Builds the Stories Material 3 themes.
abstract final class StoriesTheme {
  static ThemeData light() => _build(_lightScheme);

  static ThemeData dark() => _build(_darkScheme);

  static const _lightScheme = ColorScheme(
    brightness: Brightness.light,
    primary: StoriesPalette.terracotta,
    onPrimary: Colors.white,
    primaryContainer: StoriesPalette.terracottaContainer,
    onPrimaryContainer: Color(0xFF4A1A08),
    secondary: StoriesPalette.sage,
    onSecondary: Colors.white,
    secondaryContainer: StoriesPalette.sageContainer,
    onSecondaryContainer: Color(0xFF14261A),
    tertiary: StoriesPalette.info,
    onTertiary: Colors.white,
    error: StoriesPalette.danger,
    onError: Colors.white,
    surface: StoriesPalette.paper,
    onSurface: StoriesPalette.ink,
    onSurfaceVariant: StoriesPalette.inkSoft,
    surfaceContainerLowest: Colors.white,
    surfaceContainerLow: Color(0xFFF7F2EA),
    surfaceContainer: StoriesPalette.paperDim,
    surfaceContainerHigh: Color(0xFFEAE2D5),
    surfaceContainerHighest: Color(0xFFE2D9CA),
    outline: Color(0xFF8A8F8C),
    outlineVariant: Color(0xFFD6CEC1),
    inverseSurface: StoriesPalette.ink,
    onInverseSurface: StoriesPalette.paper,
    inversePrimary: StoriesPalette.terracottaLight,
  );

  static const _darkScheme = ColorScheme(
    brightness: Brightness.dark,
    primary: StoriesPalette.terracottaLight,
    onPrimary: Color(0xFF4A1A08),
    primaryContainer: Color(0xFF7A3419),
    onPrimaryContainer: StoriesPalette.terracottaContainer,
    secondary: StoriesPalette.sageLight,
    onSecondary: Color(0xFF14261A),
    secondaryContainer: Color(0xFF3C5441),
    onSecondaryContainer: StoriesPalette.sageContainer,
    tertiary: Color(0xFF9CC3E4),
    onTertiary: Color(0xFF0C2D47),
    error: Color(0xFFF2B8B5),
    onError: Color(0xFF601410),
    surface: StoriesPalette.midnight,
    onSurface: Color(0xFFEDE6DA),
    onSurfaceVariant: Color(0xFFB9B3A8),
    surfaceContainerLowest: Color(0xFF0C1113),
    surfaceContainerLow: Color(0xFF161D20),
    surfaceContainer: StoriesPalette.midnightRaised,
    surfaceContainerHigh: StoriesPalette.midnightHigh,
    surfaceContainerHighest: Color(0xFF303C42),
    outline: Color(0xFF858B88),
    outlineVariant: Color(0xFF3B4549),
    inverseSurface: Color(0xFFEDE6DA),
    onInverseSurface: StoriesPalette.ink,
    inversePrimary: StoriesPalette.terracotta,
  );

  static TextTheme _textTheme(ColorScheme scheme) {
    TextStyle display(double size, double height, FontWeight weight) =>
        TextStyle(
          fontFamily: StoriesFonts.display,
          package: StoriesFonts.package,
          fontSize: size,
          height: height,
          fontWeight: weight,
          letterSpacing: -0.5,
          color: scheme.onSurface,
        );
    TextStyle text(
      double size,
      double height,
      FontWeight weight, [
      double spacing = 0,
    ]) => TextStyle(
      fontFamily: StoriesFonts.text,
      package: StoriesFonts.package,
      fontSize: size,
      height: height,
      fontWeight: weight,
      letterSpacing: spacing,
      color: scheme.onSurface,
    );

    return TextTheme(
      displayLarge: display(56, 1.08, FontWeight.w700),
      displayMedium: display(44, 1.1, FontWeight.w700),
      displaySmall: display(36, 1.12, FontWeight.w600),
      headlineLarge: display(32, 1.15, FontWeight.w600),
      headlineMedium: display(28, 1.2, FontWeight.w600),
      headlineSmall: display(24, 1.25, FontWeight.w600),
      titleLarge: text(20, 1.3, FontWeight.w600),
      titleMedium: text(16, 1.4, FontWeight.w600),
      titleSmall: text(14, 1.4, FontWeight.w600),
      bodyLarge: text(16, 1.55, FontWeight.w400),
      bodyMedium: text(14, 1.5, FontWeight.w400),
      bodySmall: text(12, 1.45, FontWeight.w400),
      labelLarge: text(14, 1.3, FontWeight.w600, 0.1),
      labelMedium: text(12, 1.3, FontWeight.w500, 0.2),
      labelSmall: text(11, 1.3, FontWeight.w500, 0.3),
    );
  }

  static ThemeData _build(ColorScheme scheme) {
    final textTheme = _textTheme(scheme);
    final rounded = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(StoriesRadius.md),
    );
    const buttonPadding = EdgeInsets.symmetric(
      horizontal: StoriesSpace.xl,
      vertical: StoriesSpace.lg,
    );

    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      textTheme: textTheme,
      scaffoldBackgroundColor: scheme.surface,
      fontFamily: StoriesFonts.text,
      visualDensity: VisualDensity.standard,
      appBarTheme: AppBarTheme(
        backgroundColor: scheme.surface,
        foregroundColor: scheme.onSurface,
        elevation: 0,
        scrolledUnderElevation: 1,
        centerTitle: false,
        titleTextStyle: textTheme.titleLarge,
      ),
      cardTheme: CardThemeData(
        elevation: 0,
        color: scheme.surfaceContainerLowest,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(StoriesRadius.lg),
          side: BorderSide(color: scheme.outlineVariant),
        ),
        margin: EdgeInsets.zero,
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size(64, 48),
          padding: buttonPadding,
          shape: rounded,
          textStyle: textTheme.labelLarge,
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(64, 48),
          padding: buttonPadding,
          shape: rounded,
          side: BorderSide(color: scheme.outline),
          textStyle: textTheme.labelLarge,
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          minimumSize: const Size(48, 48),
          shape: rounded,
          textStyle: textTheme.labelLarge,
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: scheme.surfaceContainerLowest,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: StoriesSpace.lg,
          vertical: StoriesSpace.lg,
        ),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(StoriesRadius.md),
          borderSide: BorderSide(color: scheme.outlineVariant),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(StoriesRadius.md),
          borderSide: BorderSide(color: scheme.outlineVariant),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(StoriesRadius.md),
          borderSide: BorderSide(color: scheme.primary, width: 2),
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: scheme.surfaceContainerLow,
        indicatorColor: scheme.primaryContainer,
        labelTextStyle: WidgetStatePropertyAll(textTheme.labelMedium),
      ),
      navigationRailTheme: NavigationRailThemeData(
        backgroundColor: scheme.surfaceContainerLow,
        indicatorColor: scheme.primaryContainer,
      ),
      dividerTheme: DividerThemeData(color: scheme.outlineVariant, space: 1),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        shape: rounded,
      ),
    );
  }
}
