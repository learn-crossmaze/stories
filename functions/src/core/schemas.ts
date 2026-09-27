import { z } from 'zod';

export const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'must be a valid id');
export const name = z.string().trim().min(2, 'is too short').max(80, 'is too long');
export const reason = z.string().trim().min(3, 'please give a reason').max(500);

export const address = z.strictObject({
  line1: z.string().trim().min(3).max(120),
  line2: z.string().trim().max(120).default(''),
  city: z.string().trim().min(2).max(60),
  state: z.string().trim().min(2).max(60),
  postalCode: z.string().trim().regex(/^\d{6}$/, 'must be a 6-digit PIN code'),
});

export const contact = z.strictObject({
  phone: z.string().trim().regex(/^\+?[0-9 ]{8,16}$/, 'must be a valid phone number'),
  email: z.email().or(z.literal('')).default(''),
});

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM');
export const weekday = z.enum(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);
export const operatingHours = z
  .array(z.strictObject({ day: weekday, open: time, close: time }))
  .max(7)
  .refine((d) => new Set(d.map((x) => x.day)).size === d.length, 'has a day listed twice')
  .refine((d) => d.every((x) => x.open < x.close), 'must open before it closes');
