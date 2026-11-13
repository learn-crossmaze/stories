import { useState } from 'react';

import { type Book, findBooks } from '../../data/catalogue';
import { useAsync } from '../../shared/useAsync';
import { useDebounced } from '../../shared/useDebounced';
import { BookCover } from '../components/kit';
import { lt } from '../../strings/library';

/** Search-as-you-type catalogue picker. */
export function BookPicker({ onPick, label }: { onPick: (b: Book) => void; label: string }) {
  const [q, setQ] = useState('');
  const debounced = useDebounced(q);
  // Titles that can be picked only (archived ones would take places in the short list), the closest first.
  const results = useAsync(() => (debounced.trim().length >= 2 ? findBooks(debounced, 8, 'ACTIVE') : Promise.resolve([])), [debounced]);
  return (
    <div className="field picker">
      <label>
        {label}
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={lt.searchTitle} />
      </label>
      {!!results.data?.length && (
        <ul className="picker-list">
          {results.data.map((b) => (
            <li key={b.id}>
              <button type="button" onClick={() => onPick(b)} className="picker-book">
                <BookCover title={b.title} seed={b.id} url={b.coverUrl} size="sm" />
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
