// Build-time settings (apps/site/.env; see docs/SITE.md).
export const APP_URL = (import.meta.env.VITE_APP_URL as string | undefined)?.replace(/\/$/, '') || 'https://app.storiesforall.in';
export const CONTACT_EMAIL = (import.meta.env.VITE_CONTACT_EMAIL as string | undefined) ?? '';
