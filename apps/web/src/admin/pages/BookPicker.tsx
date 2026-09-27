import { useState } from 'react';

import { type Book, searchBooks } from '../../data/library';
import { useAsync } from '../../data/useAsync';
import { useDebounced } from '../../data/useDebounced';
import { BookCover } from '../kit';
import { lt } from '../libraryStrings';

/** Search-as-you-type catalogue picker. */
export function BookPicker({ onPick, label }: { onPick: (b: Book) => void; label: string }) {
  const [q, setQ] = useState('');
  const debounced = useDebounced(q);
  const results = useAsync(() => (debounced.trim().length >= 2 ? searchBooks(debounced, '').then((p) => p.items.slice(0, 8)) : Promise.resolve([])), [debounced]);
  return (
    <div className="field picker">
      <label>
        {label}
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={lt.searchTitle} />
      </label>
      {!!results.data?.length && (
        <ul className="picker-list">
          {results.data.filter((b) => b.status === 'ACTIVE').map((b) => (
            <li key={b.id}>
              <button type="button" onClick={() => onPick(b)} className="picker-book">
                <BookCover title={b.title} seed={b.id} size="sm" />
                <span>
                  <strong>{b.title}</strong>
                  <span className="muted small"> {b.authorNames.join(', ')}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
