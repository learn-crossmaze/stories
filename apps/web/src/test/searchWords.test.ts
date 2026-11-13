import { describe, expect, it } from 'vitest';

import { matchesAll, normalizeText, primaryWord, queryWords } from '../shared/searchWords';

// The words a typed search is turned into, the one the database is asked for, and how the rest narrow.
describe('search words', () => {
  it('reads words without case, accents or punctuation', () => {
    expect(normalizeText('  García-Márquez, G. ')).toBe('garcia marquez g');
    expect(queryWords('García Márquez')).toEqual(['garcia', 'marquez']);
    expect(queryWords("Charlotte's WEB")).toEqual(['charlotte', 'web']);
  });

  it('leaves out one-character pieces and repeats, and keeps the order typed', () => {
    expect(queryWords('a tale of 2 cities')).toEqual(['tale', 'of', 'cities']);
    expect(queryWords('the cat in the hat')).toEqual(['the', 'cat', 'in', 'hat']);
    expect(queryWords('x')).toEqual([]);
    expect(queryWords('   ')).toEqual([]);
  });

  it('cuts each word to the 12 characters the index holds', () => {
    expect(queryWords('extraordinarily gentlemanliness')).toEqual(['extraordinar', 'gentlemanlin']);
    // Two long words with the same start are one word to the index.
    expect(queryWords('internationalism internationalist')).toEqual(['internationa']);
  });

  it('asks the database for the longest word, the first typed of equals', () => {
    expect(primaryWord(queryWords('secret seven'))).toBe('secret');
    expect(primaryWord(queryWords('famous five island'))).toBe('famous');
    expect(primaryWord(queryWords('jungle the'))).toBe('jungle');
    expect(primaryWord([])).toBeNull();
  });

  it('passes over little words when anything else was typed', () => {
    expect(primaryWord(queryWords('the cat in the hat'))).toBe('cat');
    expect(primaryWord(queryWords('and the sea'))).toBe('sea');
    expect(primaryWord(queryWords('for me'))).toBe('me');
    // Only little words: the longest of them.
    expect(primaryWord(queryWords('of the'))).toBe('the');
    expect(primaryWord(queryWords('an'))).toBe('an');
  });

  it('matches only a record holding every word', () => {
    const tokens = ['secret', 'se', 'sec', 'seven', 'sev', 'blyton'];
    expect(matchesAll(tokens, ['secret', 'sev'])).toBe(true);
    expect(matchesAll(tokens, ['secret', 'five'])).toBe(false);
    expect(matchesAll(tokens, [])).toBe(true);
  });

  it('never matches a record without stored words', () => {
    expect(matchesAll(undefined, ['secret'])).toBe(false);
    expect(matchesAll(null, ['secret'])).toBe(false);
    expect(matchesAll(undefined, [])).toBe(false);
  });
});
