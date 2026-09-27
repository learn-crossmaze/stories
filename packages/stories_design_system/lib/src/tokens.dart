import 'package:flutter/material.dart';

/// Raw brand palette. Widgets never use these directly — they read the
/// [ColorScheme] built in `theme.dart` so light and dark stay consistent.
abstract final class StoriesPalette {
  // Paper & ink: the editorial base.
  static const paper = Color(0xFFFBF7F0);
  static const paperDim = Color(0xFFF1EADF);
  static const ink = Color(0xFF1E2A2F);
  static const inkSoft = Color(0xFF4A565B);

  // Terracotta: primary accent, warm and bookish.
  static const terracotta = Color(0xFFB4502B);
  static const terracottaLight = Color(0xFFF0B49A);
  static const terracottaContainer = Color(0xFFFBE3D7);

  // Sage: secondary, calm and natural.
  static const sage = Color(0xFF55705A);
  static const sageLight = Color(0xFFB5CDB8);
  static const sageContainer = Color(0xFFDDEADF);

  // Midnight: dark surfaces.
  static const midnight = Color(0xFF12181B);
  static const midnightRaised = Color(0xFF1B2327);
  static const midnightHigh = Color(0xFF263136);

  // Status hues (always paired with an icon + label, never color alone).
  static const success = Color(0xFF2E7D4F);
  static const warning = Color(0xFFB7791F);
  static const danger = Color(0xFFB3261E);
  static const info = Color(0xFF2F6690);
}

/// 4-pt spacing scale.
abstract final class StoriesSpace {
  static const double xxs = 2;
  static const double xs = 4;
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 24;
  static const double xxl = 32;
  static const double xxxl = 48;
}

abstract final class StoriesRadius {
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 20;
  static const double pill = 999;
}

/// Layout breakpoints shared by every responsive shell.
abstract final class StoriesBreakpoints {
  static const double compact = 600;
  static const double medium = 1024;
}

abstract final class StoriesFonts {
  static const package = 'stories_design_system';
  static const display = 'Fraunces';
  static const text = 'Inter';
}
