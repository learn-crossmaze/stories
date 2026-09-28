import { ACCENTS, type Accent, type Appearance, DEFAULT_APPEARANCE, useAppearance } from './appearance';
import { t } from './strings';

type Choice<K extends keyof Appearance> = {
  value: Appearance[K];
  label: string;
  hint?: string;
};

function Options<K extends keyof Appearance>({
  name,
  legend,
  value,
  options,
  onChange,
}: {
  name: K;
  legend: string;
  value: Appearance[K];
  options: Choice<K>[];
  onChange: (v: Appearance[K]) => void;
}) {
  return (
    <fieldset className="appearance-group">
      <legend>{legend}</legend>
      <div className="segmented">
        {options.map((o) => (
          <label key={o.value} className="segment">
            <input type="radio" name={name} checked={value === o.value} onChange={() => onChange(o.value)} />
            <span>
              {o.label}
              {o.hint && <small className="muted">{o.hint}</small>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Personal appearance controls: changes apply immediately and are remembered
 * in this browser (each person and device can have their own).
 */
export function AppearanceSettings() {
  const [a, update] = useAppearance();
  const set =
    <K extends keyof Appearance>(k: K) =>
    (v: Appearance[K]) =>
      update({ ...a, [k]: v });
  const changed = JSON.stringify(a) !== JSON.stringify(DEFAULT_APPEARANCE);
  return (
    <div className="appearance">
      <div className="appearance-controls">
        <Options
          name="theme"
          legend={t.apTheme}
          value={a.theme}
          onChange={set('theme')}
          options={[
            { value: 'system', label: t.apSystem, hint: t.apSystemHint },
            { value: 'light', label: t.apLight },
            { value: 'dark', label: t.apDark },
          ]}
        />
        <fieldset className="appearance-group">
          <legend>{t.apAccent}</legend>
          <div className="swatches">
            {(Object.keys(ACCENTS) as Accent[]).map((k) => (
              <label key={k} className="swatch" title={ACCENTS[k].label}>
                <input type="radio" name="accent" checked={a.accent === k} onChange={() => set('accent')(k)} />
                <span className="swatch-dot" style={{ background: ACCENTS[k].light }} aria-hidden="true" />
                <span>{ACCENTS[k].label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <Options
          name="textSize"
          legend={t.apTextSize}
          value={a.textSize}
          onChange={set('textSize')}
          options={[
            { value: 'default', label: t.apDefault },
            { value: 'large', label: t.apLarge },
            { value: 'larger', label: t.apLarger },
          ]}
        />
        <Options
          name="density"
          legend={t.apDensity}
          value={a.density}
          onChange={set('density')}
          options={[
            {
              value: 'comfortable',
              label: t.apComfortable,
              hint: t.apComfortableHint,
            },
            { value: 'compact', label: t.apCompact, hint: t.apCompactHint },
          ]}
        />
        <Options
          name="corners"
          legend={t.apCorners}
          value={a.corners}
          onChange={set('corners')}
          options={[
            { value: 'rounded', label: t.apRounded },
            { value: 'square', label: t.apSquare },
          ]}
        />
        <Options
          name="contrast"
          legend={t.apContrast}
          value={a.contrast}
          onChange={set('contrast')}
          options={[
            { value: 'default', label: t.apDefault },
            {
              value: 'more',
              label: t.apMoreContrast,
              hint: t.apMoreContrastHint,
            },
          ]}
        />
        <Options
          name="motion"
          legend={t.apMotion}
          value={a.motion}
          onChange={set('motion')}
          options={[
            { value: 'system', label: t.apSystem },
            { value: 'reduce', label: t.apReduceMotion },
          ]}
        />
        <div className="row">
          <button type="button" className="btn btn-outlined" disabled={!changed} onClick={() => update(DEFAULT_APPEARANCE)}>
            {t.apReset}
          </button>
          <span className="muted small">{t.apSaved}</span>
        </div>
      </div>
      <aside className="appearance-preview" aria-label={t.apPreview}>
        <h2>{t.apPreview}</h2>
        <p className="muted">{t.apPreviewText}</p>
        <div className="row">
          <button type="button" className="btn btn-filled" tabIndex={-1}>
            {t.apPrimaryButton}
          </button>
          <button type="button" className="btn btn-outlined" tabIndex={-1}>
            {t.cancel}
          </button>
        </div>
        <div className="field">
          <label htmlFor="ap-sample">{t.apSampleField}</label>
          <input id="ap-sample" defaultValue="The Wonderful Wizard of Oz" tabIndex={-1} readOnly />
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t.apSampleMember}</th>
                <th scope="col">{t.apSampleStatus}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Asha Rao</td>
                <td>
                  <span className="badge badge-ok">{t.apSampleActive}</span>
                </td>
              </tr>
              <tr>
                <td>Ravi Kumar</td>
                <td>
                  <span className="badge badge-warn">{t.apSampleDue}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </aside>
    </div>
  );
}
