import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../data/api';
import type { SiteImage } from '../data/site';
import { st } from '../strings/site';

// Adding several photos to a page (the Website editors' picture list), with the upload itself faked: each
// picture's upload ends when the test says so.
const waiting = new Map<string, { resolve: (url: string) => void; reject: (e: Error) => void }>();
const uploadSiteImage = vi.fn((file: File) => new Promise<string>((resolve, reject) => waiting.set(file.name, { resolve, reject })));
vi.mock('../data/site', async (importOriginal) => ({ ...(await importOriginal<typeof import('../data/site')>()), uploadSiteImage }));

const { ImagesField } = await import('../admin/website/kit');

const photo = (name: string, type = 'image/jpeg') => new File(['x'], name, { type });
const urlOf = (name: string) => `https://pictures.test/${name}`;
/** The upload of `name` ends (it must have started). */
const finish = (name: string) => waiting.get(name)!.resolve(urlOf(name));

let latest: SiteImage[] = [];
function Page({ start = [], max = 12 }: { start?: SiteImage[]; max?: number }) {
  const [photos, setPhotos] = useState(start);
  latest = photos;
  return <ImagesField label="Photos" value={photos} onChange={setPhotos} max={max} />;
}
const pick = (...files: File[]) => fireEvent.change(screen.getByLabelText('Photos', { selector: 'input[type=file]' }), { target: { files } });
const started = () => uploadSiteImage.mock.calls.map(([f]) => f.name);

beforeEach(() => {
  waiting.clear();
  uploadSiteImage.mockClear();
  latest = [];
});

describe('adding several photos at once', () => {
  it('uploads three at a time, shows how far it is, and keeps the order they were chosen in', async () => {
    render(<Page />);
    pick(...['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg'].map((n) => photo(n)));
    await waitFor(() => expect(started()).toEqual(['1.jpg', '2.jpg', '3.jpg']));
    expect(screen.getByRole('status')).toHaveTextContent(st.uploadingOf(1, 5));
    expect(screen.getByRole('button', { name: st.uploading })).toBeDisabled();

    // The third finishes first: the fourth starts, and never more than three are on their way.
    finish('3.jpg');
    await waitFor(() => expect(started()).toEqual(['1.jpg', '2.jpg', '3.jpg', '4.jpg']));
    expect(screen.getByRole('status')).toHaveTextContent(st.uploadingOf(2, 5));
    expect(latest).toEqual([]);
    finish('4.jpg');
    await waitFor(() => expect(started()).toHaveLength(5));
    finish('5.jpg');
    finish('2.jpg');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(st.uploadingOf(5, 5)));
    expect(latest).toEqual([]);
    finish('1.jpg');
    // Added once, all together, in the order chosen (the first is the page's cover).
    await waitFor(() => expect(latest.map((p) => p.url)).toEqual(['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg'].map(urlOf)));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(screen.getByRole('button', { name: st.addPictures })).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps the photos that worked when others fail, and names the ones to try again', async () => {
    render(<Page />);
    pick(photo('a.jpg'), photo('b.jpg'), photo('c.jpg'), photo('d.jpg'));
    await waitFor(() => expect(started()).toHaveLength(3));
    waiting.get('b.jpg')!.reject(new ApiError('The picture is too large (2 MB at most).', 'INVALID_INPUT'));
    await waitFor(() => expect(started()).toHaveLength(4));
    finish('a.jpg');
    finish('c.jpg');
    waiting.get('d.jpg')!.reject(new Error('offline'));
    await waitFor(() => expect(latest.map((p) => p.url)).toEqual([urlOf('a.jpg'), urlOf('c.jpg')]));
    expect(screen.getByRole('alert')).toHaveTextContent(st.uploadsFailed(['b.jpg', 'd.jpg']));
  });

  it('says why when a single photo fails', async () => {
    render(<Page />);
    pick(photo('a.jpg'), photo('b.jpg'));
    await waitFor(() => expect(started()).toHaveLength(2));
    finish('a.jpg');
    waiting.get('b.jpg')!.reject(new ApiError('The picture is too large (2 MB at most).', 'INVALID_INPUT'));
    await waitFor(() => expect(latest.map((p) => p.url)).toEqual([urlOf('a.jpg')]));
    expect(screen.getByRole('alert')).toHaveTextContent('b.jpg: The picture is too large (2 MB at most).');
  });

  it('fills only the room left, and a file that is no picture takes none of it', async () => {
    const start = Array.from({ length: 10 }, (_, i) => ({ url: urlOf(`old${i}.jpg`), alt: '' }));
    render(<Page start={start} />);
    pick(photo('notes.pdf', 'application/pdf'), photo('a.jpg'), photo('b.jpg'), photo('c.jpg'));
    await waitFor(() => expect(started()).toEqual(['a.jpg', 'b.jpg']));
    finish('a.jpg');
    finish('b.jpg');
    await waitFor(() => expect(latest).toHaveLength(12));
    expect(latest.slice(10).map((p) => p.url)).toEqual([urlOf('a.jpg'), urlOf('b.jpg')]);
    // Full: no more can be added.
    expect(screen.queryByRole('button', { name: st.addPictures })).not.toBeInTheDocument();
  });

  it('never goes over the limit when photos were added some other way meanwhile', async () => {
    function Shared() {
      const [photos, setPhotos] = useState<SiteImage[]>([{ url: urlOf('old.jpg'), alt: '' }]);
      latest = photos;
      return (
        <>
          <ImagesField label="Photos" value={photos} onChange={setPhotos} max={3} />
          <button type="button" onClick={() => setPhotos((p) => [...p, { url: urlOf('elsewhere.jpg'), alt: '' }])}>Add elsewhere</button>
        </>
      );
    }
    render(<Shared />);
    pick(photo('a.jpg'), photo('b.jpg'));
    await waitFor(() => expect(started()).toHaveLength(2));
    await userEvent.click(screen.getByRole('button', { name: 'Add elsewhere' }));
    finish('a.jpg');
    finish('b.jpg');
    await waitFor(() => expect(latest.map((p) => p.url)).toEqual([urlOf('old.jpg'), urlOf('elsewhere.jpg'), urlOf('a.jpg')]));
  });

  it('keeps a description typed and a photo removed while the upload runs', async () => {
    const user = userEvent.setup();
    render(<Page start={[{ url: urlOf('old1.jpg'), alt: '' }, { url: urlOf('old2.jpg'), alt: '' }]} />);
    pick(photo('new.jpg'));
    await waitFor(() => expect(started()).toEqual(['new.jpg']));
    await user.type(screen.getByLabelText(`${st.altText} (1)`), 'The reading room');
    await user.click(screen.getAllByRole('button', { name: st.remove })[1]);
    finish('new.jpg');
    await waitFor(() => expect(latest).toEqual([{ url: urlOf('old1.jpg'), alt: 'The reading room' }, { url: urlOf('new.jpg'), alt: '' }]));
  });

  it('asks for a photo when none of the files is one', async () => {
    render(<Page />);
    pick(photo('notes.pdf', 'application/pdf'));
    expect(await screen.findByRole('alert')).toHaveTextContent(st.notAPicture);
    expect(uploadSiteImage).not.toHaveBeenCalled();
  });
});
