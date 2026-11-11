// The website's enquiry forms (Contact, Franchise, branch pages, Careers): sent to /api/submit, where they are saved
// and the right people told (functions/src/site/inbox.ts). They work without the page's other data.
const MAX_CV = 2_000_000;

const fileToBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

async function send(form: HTMLFormElement) {
  const status = form.querySelector<HTMLElement>('.form-status');
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  const say = (text: string, tone: 'ok' | 'error' | '' = '') => {
    if (!status) return;
    status.textContent = text;
    status.dataset.tone = tone;
  };
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }
  const data = new FormData(form);
  const body: Record<string, unknown> = { form: form.dataset.form, page: location.pathname };
  for (const [k, v] of data) if (typeof v === 'string') body[k] = v.trim();
  const cv = data.get('resume');
  if (cv instanceof File && cv.size) {
    if (cv.size > MAX_CV) return say('Your CV is larger than 2 MB. Please attach a smaller PDF.', 'error');
    body.resume = { name: cv.name, data: await fileToBase64(cv) };
  } else delete body.resume;
  if (button) button.disabled = true;
  say('Sending…');
  try {
    const res = await fetch('/api/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const answer = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !answer.ok) throw new Error(answer.error || 'Something went wrong.');
    form.reset();
    say(form.dataset.form === 'JOB' ? 'Thank you! We have your application and will be in touch.' : 'Thank you! We will call you back soon.', 'ok');
  } catch (e) {
    say(`${e instanceof Error ? e.message : 'Something went wrong.'} You can also call or WhatsApp your nearest branch.`, 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

export function wireForms() {
  document.querySelectorAll<HTMLFormElement>('form.site-form').forEach((form) => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void send(form);
    });
  });
  // "Apply for this job" picks the job in the form below.
  document.querySelectorAll<HTMLAnchorElement>('[data-pick-job]').forEach((a) =>
    a.addEventListener('click', () => {
      const select = document.querySelector<HTMLSelectElement>('select[name="jobId"]');
      if (select) select.value = a.dataset.pickJob ?? '';
    }),
  );
}
