import { describe, expect, it } from 'vitest';

import { defaultTemplateName, EVENTS, placeholders, tooFewWords } from '../../src/messaging/events.js';

// whatsapp-addTemplates adds notifications with their default wording and name without checking them
// (whatsapp-saveTemplate checks what a person types): every default must pass the same rules.
describe('default WhatsApp wordings', () => {
  it('each passes the rules a saved wording has to pass', () => {
    for (const e of EVENTS) {
      const known = e.variables.map((v) => v.key);
      expect(placeholders(e.body).filter((k) => !known.includes(k)), e.key).toEqual([]);
      expect(/^\s*\{\{|\}\}\s*$/.test(e.body), e.key).toBe(false);
      expect(tooFewWords(e.body), e.key).toBeNull();
      expect(e.body.length, e.key).toBeGreaterThanOrEqual(10);
      expect(e.body.length, e.key).toBeLessThanOrEqual(1024);
      expect(defaultTemplateName(e.key), e.key).toMatch(/^[a-z0-9_]{1,512}$/);
    }
  });

  it('every event has its own key', () => {
    expect(new Set(EVENTS.map((e) => e.key)).size).toBe(EVENTS.length);
  });
});
