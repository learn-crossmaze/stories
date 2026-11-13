// Jobs (the Careers page) and Testimonials (the home page's "What readers say"): lists of items, each saved,
// previewed and published like the rest of the website.
import { Link, useParams } from 'react-router';

import { JOB_TYPES, type JobDraft, listSite, type ListItem, SITE_URL, type TestimonialDraft } from '../../data/site';
import { paths } from '../../paths';
import { useAsync } from '../../shared/useAsync';
import { EmptyState, ErrorState, Icon, SkeletonRows, TableWrap } from '../../shared/ui';
import { SelectField, TextArea, TextField } from '../../shared/fields';
import { st } from '../../strings/site';
import { ListEditor, PublishBar, savedLine, SiteStatusBadge, useSiteItem } from './kit';

/** A list page in the crossmaze.in style: title, intro, an Add button, then the items with their status. */
function ListPage({ kind, title, intro, addLabel, emptyTitle, emptyText, to, newTo, extra }: {
  kind: 'job' | 'testimonial';
  title: string;
  intro: string;
  addLabel: string;
  emptyTitle: string;
  emptyText: string;
  to: (id: string) => string;
  newTo: string;
  extra?: { label: string; value: (i: ListItem) => string };
}) {
  const list = useAsync(() => listSite(kind), [kind]);
  return (
    <>
      <header className="page-header page-header-row">
        <div>
          <h1>{title}</h1>
          <p className="muted">{intro}</p>
        </div>
        <Link className="btn btn-filled" to={newTo}>
          <Icon name="plus" /> {addLabel}
        </Link>
      </header>
      {list.loading ? (
        <SkeletonRows />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : !list.data?.length ? (
        <EmptyState icon="folder" title={emptyTitle} message={emptyText} />
      ) : (
        <TableWrap label={title}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{st.item}</th>
                {extra && <th scope="col">{extra.label}</th>}
                <th scope="col">{st.statusLabel}</th>
                <th scope="col">{st.lastSaved}</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((i) => (
                <tr key={i.id}>
                  <td>
                    <Link to={to(i.id)}>{i.title || st.untitled}</Link>
                  </td>
                  {extra && <td>{extra.value(i)}</td>}
                  <td>
                    <SiteStatusBadge status={i.status} />
                  </td>
                  <td className="muted small">{savedLine(i.updatedBy, i.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </>
  );
}

/** Editor plumbing shared by jobs and testimonials. */
function useItem<D extends object>(kind: 'job' | 'testimonial', id: string, blank: () => D, listPath: string, itemPath: (id: string) => string) {
  const item = useSiteItem<D>({ kind, id, blank, pathOf: itemPath });
  const { e, isNew, saved } = item;
  const bar = (title: string, hidden: boolean, liveUrl: string | null) => (
    <PublishBar
      kind={kind}
      message={e.message}
      state={{ ...item.state, liveUrl }}
      onSave={item.save}
      onPublish={() => item.publish(hidden ? st.takenDown : st.published)}
      onUnpublish={saved ? item.unpublish : undefined}
      onDelete={saved ? () => item.remove(title, listPath) : undefined}
    />
  );
  return { isNew, item, e, bar };
}

// ------------------------------------------------------------------ jobs

export const JobsPage = () => (
  <ListPage
    kind="job"
    title={st.navJobs}
    intro={st.jobsIntro}
    addLabel={st.newJob}
    emptyTitle={st.noJobs}
    emptyText={st.noJobsHint}
    to={paths.adminWebsiteJob}
    newTo={paths.adminWebsiteJob('new')}
  />
);

const blankJob = (): JobDraft => ({ title: '', location: '', type: 'FULL_TIME', overview: '', qualification: '', experience: '', timings: '', responsibilities: [], hidden: false });

export function JobEditorPage() {
  const { jobId = 'new' } = useParams();
  const { isNew, item, e, bar } = useItem<JobDraft>('job', jobId, blankJob, paths.adminWebsiteJobs, paths.adminWebsiteJob);
  const d = e.draft;
  if (item.loading) return <SkeletonRows />;
  if (item.error || !d) return <ErrorState message={item.error ?? st.notFound} onRetry={item.reload} />;
  return (
    <>
      <header className="page-header">
        <p className="muted small"><Link to={paths.adminWebsiteJobs}>{st.navJobs}</Link></p>
        <h1>{isNew ? st.newJob : d.title || st.untitled}</h1>
      </header>
      {bar(d.title, d.hidden, `${SITE_URL}/careers`)}
      <section className="card editor-main" aria-label={st.job}>
        <div className="form-grid">
          <TextField label={st.jobTitle} value={d.title} onChange={(title) => e.update({ title })} />
          <TextField label={st.jobLocation} hint={st.jobLocationHint} value={d.location} onChange={(location) => e.update({ location })} />
          <SelectField label={st.jobType} value={d.type} options={JOB_TYPES.map((x) => ({ value: x, label: st.jobTypes[x] }))} onChange={(type) => e.update({ type })} />
          <TextField label={st.jobExperience} value={d.experience} onChange={(experience) => e.update({ experience })} />
        </div>
        <TextArea label={st.jobOverview} rows={4} value={d.overview} onChange={(overview) => e.update({ overview })} />
        <TextArea label={st.jobQualification} rows={2} value={d.qualification} onChange={(qualification) => e.update({ qualification })} />
        <TextField label={st.jobTimings} hint={st.jobTimingsHint} value={d.timings} onChange={(timings) => e.update({ timings })} />
        <ListEditor legend={st.jobResponsibilities} items={d.responsibilities} onChange={(responsibilities) => e.update({ responsibilities })} make={() => ''} max={12} addLabel={st.addPoint}>
          {(x, set, i) => <TextField label={`${st.point} ${i + 1}`} value={x} onChange={set} />}
        </ListEditor>
        <label className="check">
          <input type="checkbox" checked={d.hidden} onChange={(ev) => e.update({ hidden: ev.target.checked })} /> {st.jobClosed}
        </label>
      </section>
    </>
  );
}

// ------------------------------------------------------------------ testimonials

export const TestimonialsPage = () => (
  <ListPage
    kind="testimonial"
    title={st.navTestimonials}
    intro={st.testimonialsIntro}
    addLabel={st.newTestimonial}
    emptyTitle={st.noTestimonials}
    emptyText={st.noTestimonialsHint}
    to={paths.adminWebsiteTestimonial}
    newTo={paths.adminWebsiteTestimonial('new')}
  />
);

const blankTestimonial = (): TestimonialDraft => ({ quote: '', name: '', detail: '', hidden: false });

export function TestimonialEditorPage() {
  const { testimonialId = 'new' } = useParams();
  const { isNew, item, e, bar } = useItem<TestimonialDraft>('testimonial', testimonialId, blankTestimonial, paths.adminWebsiteTestimonials, paths.adminWebsiteTestimonial);
  const d = e.draft;
  if (item.loading) return <SkeletonRows />;
  if (item.error || !d) return <ErrorState message={item.error ?? st.notFound} onRetry={item.reload} />;
  return (
    <>
      <header className="page-header">
        <p className="muted small"><Link to={paths.adminWebsiteTestimonials}>{st.navTestimonials}</Link></p>
        <h1>{isNew ? st.newTestimonial : d.name || st.untitled}</h1>
      </header>
      {bar(d.name, d.hidden, SITE_URL)}
      <section className="card editor-main" aria-label={st.testimonial}>
        <TextArea label={st.quoteText} hint={st.testimonialQuoteHint} rows={5} value={d.quote} onChange={(quote) => e.update({ quote })} />
        <div className="form-grid">
          <TextField label={st.testimonialName} hint={st.testimonialNameHint} value={d.name} onChange={(name) => e.update({ name })} />
          <TextField label={st.testimonialDetail} hint={st.testimonialDetailHint} value={d.detail} onChange={(detail) => e.update({ detail })} />
        </div>
        <label className="check">
          <input type="checkbox" checked={d.hidden} onChange={(ev) => e.update({ hidden: ev.target.checked })} /> {st.hideFromWebsite}
        </label>
        <p className="muted small">{st.testimonialConsent}</p>
      </section>
    </>
  );
}
