import { z } from 'zod';

// Catalogue vocabularies (docs/LIBRARY.md). Mirrored in apps/web/src/data/common.ts.
export const GENRES = ['FICTION', 'FANTASY', 'MYSTERY', 'ADVENTURE', 'SCIENCE', 'BIOGRAPHY', 'SELF_HELP', 'CLASSICS', 'COMICS', 'EDUCATIONAL'] as const;
export const AGE_GROUPS = ['CHILDREN', 'TEENS', 'ADULTS'] as const;
export const READING_LEVELS = ['EARLY_READER', 'BEGINNER', 'INTERMEDIATE', 'ADVANCED'] as const;
export const LANGUAGES = ['en', 'hi', 'kn', 'ta', 'te', 'ml', 'mr', 'bn', 'gu', 'pa', 'ur', 'or'] as const;

export type Genre = (typeof GENRES)[number];
export type AgeGroup = (typeof AGE_GROUPS)[number];

export const money = z.number().int('must be in paise').min(0).max(100_000_000);
