import 'package:flutter/material.dart';

import 'tokens.dart';

/// The "Stories" wordmark with its tagline.
class StoriesWordmark extends StatelessWidget {
  const StoriesWordmark({super.key, this.showTagline = true, this.size = 40});

  final bool showTagline;
  final double size;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Semantics(
      header: true,
      label: 'Stories',
      child: ExcludeSemantics(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Stories',
              style: theme.textTheme.displaySmall?.copyWith(
                fontSize: size,
                color: theme.colorScheme.onSurface,
              ),
            ),
            if (showTagline)
              Text(
                'Every book begins a new story.',
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                  fontStyle: FontStyle.italic,
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// A meaningful empty state — never an unexplained blank screen.
class StoriesEmptyState extends StatelessWidget {
  const StoriesEmptyState({
    super.key,
    required this.icon,
    required this.title,
    this.message,
    this.action,
  });

  final IconData icon;
  final String title;
  final String? message;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 420),
        child: Padding(
          padding: const EdgeInsets.all(StoriesSpace.xl),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              DecoratedBox(
                decoration: BoxDecoration(
                  color: theme.colorScheme.secondaryContainer,
                  shape: BoxShape.circle,
                ),
                child: Padding(
                  padding: const EdgeInsets.all(StoriesSpace.lg),
                  child: Icon(
                    icon,
                    size: 32,
                    color: theme.colorScheme.onSecondaryContainer,
                  ),
                ),
              ),
              const SizedBox(height: StoriesSpace.lg),
              Text(
                title,
                style: theme.textTheme.headlineSmall,
                textAlign: TextAlign.center,
              ),
              if (message != null) ...[
                const SizedBox(height: StoriesSpace.sm),
                Text(
                  message!,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                  textAlign: TextAlign.center,
                ),
              ],
              if (action != null) ...[
                const SizedBox(height: StoriesSpace.xl),
                action!,
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Error state: what happened and what the user can do next.
class StoriesErrorState extends StatelessWidget {
  const StoriesErrorState({
    super.key,
    required this.title,
    required this.message,
    this.onRetry,
    this.retryLabel = 'Try again',
  });

  final String title;
  final String message;
  final VoidCallback? onRetry;
  final String retryLabel;

  @override
  Widget build(BuildContext context) {
    return StoriesEmptyState(
      icon: Icons.error_outline,
      title: title,
      message: message,
      action: onRetry == null
          ? null
          : OutlinedButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: Text(retryLabel),
            ),
    );
  }
}

/// Full-area loading indicator with an accessible label.
class StoriesLoading extends StatelessWidget {
  const StoriesLoading({super.key, this.label = 'Loading'});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Semantics(
        label: label,
        liveRegion: true,
        child: const CircularProgressIndicator(),
      ),
    );
  }
}

enum StatusTone { neutral, success, warning, danger, info }

/// Status chip: always icon + text, never color alone.
class StatusBadge extends StatelessWidget {
  const StatusBadge({
    super.key,
    required this.label,
    this.tone = StatusTone.neutral,
    this.icon,
  });

  final String label;
  final StatusTone tone;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final (Color color, IconData defaultIcon) = switch (tone) {
      StatusTone.success => (StoriesPalette.success, Icons.check_circle),
      StatusTone.warning => (StoriesPalette.warning, Icons.schedule),
      StatusTone.danger => (StoriesPalette.danger, Icons.error),
      StatusTone.info => (StoriesPalette.info, Icons.info),
      StatusTone.neutral => (theme.colorScheme.onSurfaceVariant, Icons.circle),
    };
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: StoriesSpace.sm,
        vertical: StoriesSpace.xs,
      ),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(StoriesRadius.pill),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon ?? defaultIcon, size: 14, color: color),
          const SizedBox(width: StoriesSpace.xs),
          Text(
            label,
            style: theme.textTheme.labelMedium?.copyWith(color: color),
          ),
        ],
      ),
    );
  }
}
