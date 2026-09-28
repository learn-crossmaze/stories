/** Book cover image, or a generated cover (title on a colour picked from the book id) when there is none. */
export function BookCover({ title, author, seed, url, size = 'md' }: { title: string; author?: string; seed: string; url?: string | null; size?: 'sm' | 'md' | 'lg' }) {
  if (url) return <img className={`cover cover-img cover-${size}`} src={url} alt="" loading="lazy" />;
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const palettes = [
    ['#b4502b', '#fbe3d7'], ['#55705a', '#ddeadf'], ['#2f6690', '#dbe8f3'], ['#6b4c9a', '#e8e0f3'],
    ['#8a5a00', '#f6e7c8'], ['#1e2a2f', '#f1eadf'], ['#9c2f4f', '#f6dbe3'], ['#2e7d6b', '#d7eee8'],
  ];
  const [ink, paper] = palettes[h % palettes.length];
  return (
    <div className={`cover cover-${size}`} style={{ background: paper, color: ink, borderColor: ink }} aria-hidden="true">
      <span className="cover-band" style={{ background: ink }} />
      <span className="cover-title">{title}</span>
      {author && size !== 'sm' && <span className="cover-author">{author}</span>}
    </div>
  );
}
