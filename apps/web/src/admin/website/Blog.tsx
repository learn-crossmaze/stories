import { useState } from 'react';
import { Link, useParams } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { DESIGNS, listSite, liveUrl, type PostDraft, previewUrl, slugify } from '../../data/site';
import { paths } from '../../paths';
import { useAsync } from '../../shared/useAsync';
import { EmptyState, ErrorState, Icon, SkeletonRows, TableWrap } from '../../shared/ui';
import { SelectField, TextArea, TextField } from '../../shared/fields';
import { st } from '../../strings/site';
import { useWorkspace } from '../Workspace';
import { BookPicker, ImageField, ListEditor, PublishBar, RichField, savedLine, SiteStatusBadge, useSiteItem, WordsField } from './kit';

export function BlogPage() {
  const list = useAsync(() => listSite('post'), []);
  const [filter, setFilter] = useState<'all' | 'mine' | 'waiting'>('all');
  const rows = (list.data ?? []).filter((p) => filter === 'all' || (filter === 'mine' ? p.mine : p.status === 'IN_REVIEW' || p.status === 'CHANGED' || p.status === 'DRAFT'));
  return (
    <>
      <header className="page-header page-header-row">
        <div>
            <h1>{st.navBlog}</h1>
          <p className="muted">{st.blogIntro}</p>
        </div>
        <Link className="btn btn-filled" to={paths.adminWebsitePost('new')}>
          <Icon name="plus" /> {st.newPost}
        </Link>
      </header>
      <div className="toolbar" role="group" aria-label={st.show}>
        {(['all', 'mine', 'waiting'] as const).map((f) => (
          <button key={f} type="button" className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {st.postFilter[f]}
          </button>
        ))}
      </div>
      {list.loading ? (
        <SkeletonRows />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : !rows.length ? (
        <EmptyState icon="folder" title={st.noPosts} message={st.noPostsHint} />
      ) : (
        <TableWrap label={st.navBlog}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{st.postTitle}</th>
                <th scope="col">{st.design}</th>
                <th scope="col">{st.statusLabel}</th>
                <th scope="col">{st.writer}</th>
                <th scope="col">{st.lastSaved}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link to={paths.adminWebsitePost(p.id)}>{p.title}</Link>
                    {p.liveOn && <span className="muted small"> · {p.liveOn}</span>}
                  </td>
                  <td>{st.designs[(p.design ?? 'CLASSIC') as PostDraft['design']].name}</td>
                  <td>
                    <SiteStatusBadge status={p.status} />
                  </td>
                  <td>{p.by}</td>
                  <td className="muted small">{savedLine(p.updatedBy, p.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </>
  );
}

const blank = (author: string): PostDraft => ({
  title: '', slug: '', summary: '', design: 'CLASSIC', cover: null, intro: '', sections: [], quote: null, takeaways: [], books: [],
  author: { name: author, role: '' }, branch: null, tags: [], cta: null, hidden: false,
});

export function PostEditorPage() {
  const { postId = 'new' } = useParams();
  const isNew = postId === 'new';
  const { user } = useAuth();
  const { org, myBranches } = useWorkspace();
  // A new post is read once too: who may publish it depends on the person.
  const item = useSiteItem<PostDraft>({ kind: 'post', id: postId, blank: () => blank(user?.displayName ?? ''), readNew: true, pathOf: paths.adminWebsitePost });
  const [slugTouched, setSlugTouched] = useState(!isNew);
  const { e, saved: info } = item;
  const d = e.draft;
  if (item.loading) return <SkeletonRows />;
  if (item.error || !d) return <ErrorState message={item.error ?? st.notFound} onRetry={item.reload} />;
  const branchOptions = [{ value: '', label: st.noBranch }, ...myBranches.map((b) => ({ value: `${org?.id}|${b.id}`, label: b.name }))];
  const branchValue = d.branch ? `${d.branch.orgId}|${d.branch.branchId}` : '';
  const designNote = st.designs[d.design];

  return (
    <>
      <header className="page-header">
        <p className="muted small">
          <Link to={paths.adminWebsiteBlog}>{st.navBlog}</Link>
        </p>
        <h1>{isNew ? st.newPost : d.title || st.untitled}</h1>
      </header>
      <PublishBar
        kind="post"
        message={e.message}
        state={{ ...item.state, liveUrl: liveUrl('post', info?.liveSlug ?? null), previewUrl: info ? previewUrl('post', info.id, info.previewToken) : null }}
        onSave={item.save}
        onPublish={() => item.publish(d.hidden ? st.takenDown : st.published)}
        onReview={item.review}
        onUnpublish={info ? item.unpublish : undefined}
        onDelete={info?.canDelete ? () => item.remove(d.title, paths.adminWebsiteBlog) : undefined}
      />
      {info?.review && <p className="notice notice-warn">{st.reviewAsked(info.review.by, savedLine(null, info.review.at) ?? '')}</p>}

      <div className="editor-grid">
        <section className="card editor-main" aria-label={st.post}>
          <TextField
            label={st.postTitle}
            value={d.title}
            onChange={(title) => e.update({ title, ...(slugTouched ? {} : { slug: slugify(title) }) })}
          />
          <TextField label={st.address} hint={st.addressHint(`/blog/${d.slug || '…'}`)} value={d.slug} onChange={(slug) => { setSlugTouched(true); e.update({ slug: slug.toLowerCase().replace(/[^a-z0-9-]/g, '-') }); }} />
          <TextArea label={st.summary} hint={st.summaryHint} rows={2} value={d.summary} onChange={(summary) => e.update({ summary })} />
          <ImageField label={st.cover} value={d.cover} onChange={(cover) => e.update({ cover })} hint={st.coverHint} />
          <RichField label={st.opening} value={d.intro} onChange={(intro) => e.update({ intro })} />
          {d.design === 'BOOKLIST' && <BookPicker legend={st.booksInList} hint={st.booksInListHint} value={d.books} onChange={(books) => e.update({ books })} max={24} />}
          <ListEditor
            legend={d.design === 'TIPS' ? st.tips : st.sections}
            hint={d.design === 'TIPS' ? st.tipsHint : st.sectionsHint}
            items={d.sections}
            onChange={(sections) => e.update({ sections })}
            make={() => ({ heading: '', text: '', image: null })}
            max={20}
            addLabel={d.design === 'TIPS' ? st.addTip : st.addSection}
          >
            {(s, set, i) => (
              <>
                <TextField label={`${st.heading} ${i + 1}`} value={s.heading} onChange={(heading) => set({ ...s, heading })} />
                <RichField label={st.text} rows={4} value={s.text} onChange={(text) => set({ ...s, text })} />
                <ImageField label={st.sectionPicture} value={s.image} onChange={(image) => set({ ...s, image })} />
              </>
            )}
          </ListEditor>
          <fieldset className="choices">
            <legend>{st.quote}</legend>
            <TextArea label={st.quoteText} rows={2} value={d.quote?.text ?? ''} onChange={(text) => e.update({ quote: text.trim() ? { text, by: d.quote?.by ?? '' } : null })} />
            <TextField label={st.quoteBy} value={d.quote?.by ?? ''} onChange={(by) => e.update({ quote: d.quote ? { ...d.quote, by } : null })} />
          </fieldset>
          <ListEditor legend={st.takeaways} items={d.takeaways} onChange={(takeaways) => e.update({ takeaways })} make={() => ''} max={8} addLabel={st.addPoint}>
            {(t, set, i) => <TextField label={`${st.point} ${i + 1}`} value={t} onChange={set} />}
          </ListEditor>
          {d.design !== 'BOOKLIST' && <BookPicker legend={st.booksMentioned} hint={st.booksMentionedHint} value={d.books} onChange={(books) => e.update({ books })} max={24} />}
        </section>

        <aside className="editor-side">
          <section className="card">
            <h2 className="h3">{st.design}</h2>
            <div className="design-picks" role="radiogroup" aria-label={st.design}>
              {DESIGNS.map((k) => (
                <label key={k} className={`design-pick${d.design === k ? ' on' : ''}`}>
                  <input type="radio" name="design" checked={d.design === k} onChange={() => e.update({ design: k })} />
                  <strong>{st.designs[k].name}</strong>
                  <span className="muted small">{st.designs[k].best}</span>
                </label>
              ))}
            </div>
            <p className="muted small">{designNote.tip}</p>
          </section>
          <section className="card">
            <h2 className="h3">{st.aboutPost}</h2>
            <TextField label={st.authorName} value={d.author.name} onChange={(name) => e.update({ author: { ...d.author, name } })} />
            <TextField label={st.authorRole} hint={st.authorRoleHint} value={d.author.role} onChange={(role) => e.update({ author: { ...d.author, role } })} />
            <SelectField
              label={st.aboutBranch}
              hint={st.aboutBranchHint}
              value={branchValue}
              options={d.branch && !branchOptions.some((o) => o.value === branchValue) ? [...branchOptions, { value: branchValue, label: st.otherBranch }] : branchOptions}
              onChange={(v) => {
                const [orgId, branchId] = v.split('|');
                e.update({ branch: v ? { orgId, branchId } : null });
              }}
            />
            <WordsField label={st.tags} hint={st.tagsHint} value={d.tags} onChange={(tags) => e.update({ tags: tags.map((x) => x.toLowerCase()) })} max={6} />
          </section>
          <section className="card">
            <h2 className="h3">{st.button}</h2>
            <TextField label={st.buttonLabel} hint={st.buttonHint} value={d.cta?.label ?? ''} onChange={(label) => e.update({ cta: label.trim() || d.cta?.url ? { label, url: d.cta?.url ?? '/plans' } : null })} />
            <TextField label={st.buttonLink} hint={st.linkHint} value={d.cta?.url ?? ''} onChange={(url) => e.update({ cta: d.cta || url ? { label: d.cta?.label ?? '', url } : null })} />
          </section>
          <section className="card">
            <label className="check">
              <input type="checkbox" checked={d.hidden} onChange={(ev) => e.update({ hidden: ev.target.checked })} />
              {st.hideFromWebsite}
            </label>
            <p className="muted small">{st.hideHint}</p>
          </section>
        </aside>
      </div>
    </>
  );
}
