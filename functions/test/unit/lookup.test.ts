import { describe, expect, it } from 'vitest';

import { fromGoogle, fromOpenLibrary, guessGenres, merge } from '../../src/catalog/lookup.js';

// Trimmed real-world response shapes.
const google = {
  kind: 'books#volumes',
  totalItems: 2,
  items: [
    {
      volumeInfo: {
        title: 'Treasure Island',
        authors: ['Robert Louis Stevenson'],
        publisher: 'Penguin UK',
        publishedDate: '2008-04-03',
        description: '<p>Young <b>Jim Hawkins</b> finds a treasure map…</p>',
        industryIdentifiers: [{ type: 'ISBN_10', identifier: '0141321008' }, { type: 'ISBN_13', identifier: '9780141321004' }],
        categories: ['Juvenile Fiction'],
        language: 'en',
        imageLinks: { smallThumbnail: 'http://books.google.com/books/content?id=x&printsec=frontcover&img=1&zoom=5&edge=curl&source=gbs_api', thumbnail: 'http://books.google.com/books/content?id=x&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api' },
      },
    },
    { volumeInfo: { title: 'Godaan', authors: ['Premchand'], publishedDate: '1936', language: 'hi' } },
    { volumeInfo: {} },
  ],
};

const openLibrary = {
  numFound: 2,
  docs: [
    {
      title: 'Treasure Island', author_name: ['Robert Louis Stevenson'], publisher: ['Cassell'], first_publish_year: 1883,
      isbn: ['0141321008', '9780141321004'], language: ['eng'], subject: ['Pirates', 'Buried treasure', 'Adventure stories'], cover_i: 8231856,
    },
    { title: 'Malgudi Days', author_name: ['R. K. Narayan'], first_publish_year: 1943, language: ['eng'], subject: ['Short stories'], isbn: ['not-an-isbn'] },
  ],
};

describe('book lookup parsing', () => {
  it('normalizes Google Books volumes (ISBN-13, https cover, plain-text synopsis)', () => {
    const [ti, godaan] = fromGoogle(google);
    expect(ti).toMatchObject({
      source: 'Google Books', title: 'Treasure Island', authors: ['Robert Louis Stevenson'], publisher: 'Penguin UK', year: 2008,
      isbn: '9780141321004', language: 'en', synopsis: 'Young Jim Hawkins finds a treasure map…', genres: ['FICTION'],
    });
    expect(ti.coverUrl).toBe('https://books.google.com/books/content?id=x&printsec=frontcover&img=1&zoom=0&source=gbs_api');
    expect(godaan).toMatchObject({ title: 'Godaan', year: 1936, language: 'hi', isbn: null, coverUrl: null });
    expect(fromGoogle(google)).toHaveLength(2); // the volume without a title is dropped
    expect(fromGoogle({ totalItems: 0 })).toEqual([]);
  });

  it('normalizes Open Library docs (language codes, cover by id, invalid ISBNs ignored)', () => {
    const [ti, malgudi] = fromOpenLibrary(openLibrary);
    expect(ti).toMatchObject({
      source: 'Open Library', publisher: 'Cassell', year: 1883, isbn: '9780141321004', language: 'en',
      coverUrl: 'https://covers.openlibrary.org/b/id/8231856-L.jpg', genres: ['ADVENTURE', 'FICTION'],
    });
    expect(malgudi.isbn).toBeNull();
  });

  it('merges sources, one result per ISBN, Google first', () => {
    const merged = merge([fromGoogle(google), fromOpenLibrary(openLibrary)]);
    expect(merged.map((c) => `${c.source}: ${c.title}`)).toEqual(['Google Books: Treasure Island', 'Google Books: Godaan', 'Open Library: Malgudi Days']);
  });

  it('guesses at most three genres from subjects', () => {
    expect(guessGenres(['Detective and mystery stories', 'Fiction', 'Science fiction', 'Classic literature'])).toEqual(['MYSTERY', 'SCIENCE', 'CLASSICS']);
    expect(guessGenres([])).toEqual([]);
  });
});
