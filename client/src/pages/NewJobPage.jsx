import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fieldErrorsFrom } from '../api/client.js';
import { useCreateJob } from '../api/queries.js';
import Field, { FieldSet } from '../components/Field.jsx';
import { FormError } from '../components/States.jsx';
import { useToast } from '../components/Toast.jsx';
import { formatDateTime, toLocalInputValue } from '../lib/format.js';
import { PRIORITY_LABELS, PRIORITY_ORDER, ZONE_LABELS, ZONE_ORDER } from '../lib/labels.js';
import { serverNow } from '../lib/time.js';

const EMPTY = { orderRef: '', pickupZone: '', dropZone: '', load: '', priority: 'NORMAL', deadline: '', notes: '' };

const FIELD_NAMES = { pickupZone: 'Pickup zone', dropZone: 'Drop zone', load: 'Load', priority: 'Priority', deadline: 'Deadline', notes: 'Notes' };

function showValue(field, value) {
  if (value === null || value === undefined || value === '') return 'none';
  if (field === 'deadline') return formatDateTime(value);
  if (field === 'pickupZone' || field === 'dropZone') return ZONE_LABELS[value] ?? value;
  if (field === 'priority') return PRIORITY_LABELS[value] ?? value;
  return String(value);
}

/** Shown when the order reference already exists with other details. */
function ConflictMessage({ error }) {
  const { differences = [], jobId } = error.details ?? {};
  return (
    <FormError>
      <p>{error.message}</p>
      {differences.length > 0 && (
        <ul className="diff-list">
          {differences.map((d) => (
            <li key={d.field}>
              {FIELD_NAMES[d.field] ?? d.field}: existing job has {showValue(d.field, d.existing)}, you entered {showValue(d.field, d.submitted)}
            </li>
          ))}
        </ul>
      )}
      {jobId && (
        <Link to={`/jobs/${jobId}`} className="link-button">
          Open the existing job
        </Link>
      )}
    </FormError>
  );
}

export default function NewJobPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const createJob = useCreateJob();
  const [form, setForm] = useState(EMPTY);

  const set = (field) => (event) => setForm((f) => ({ ...f, [field]: event.target.value }));
  const errors = fieldErrorsFrom(createJob.error);
  const code = createJob.error?.code;
  if (code === 'DEADLINE_IN_PAST') errors.deadline = createJob.error.message;

  const submit = (event) => {
    event.preventDefault();
    createJob.mutate(
      {
        orderRef: form.orderRef,
        pickupZone: form.pickupZone || undefined,
        dropZone: form.dropZone || undefined,
        load: form.load === '' ? undefined : Number(form.load),
        priority: form.priority,
        deadline: form.deadline ? new Date(form.deadline).toISOString() : undefined,
        notes: form.notes.trim() || undefined,
      },
      {
        onSuccess: ({ job, created }) => {
          if (created) toast.success(`Job ${job.orderRef} created`);
          else toast.info(`${job.orderRef} already existed with these details, so no new job was created`);
          navigate(`/jobs/${job.orderRef}`);
        },
      },
    );
  };

  return (
    <>
      <Link to="/jobs" className="back-link">
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M10 3 5 8l5 5" />
        </svg>
        All jobs
      </Link>
      <div className="page-head">
        <div>
          <h1 className="page-title">New job</h1>
          <p className="page-subtitle">The job is ready to dispatch as soon as it is created.</p>
        </div>
      </div>

      <form className="panel form" onSubmit={submit} noValidate>
        <div className="form__grid">
          <Field label="Order reference" hint="From the order system, e.g. ORD-2001. Each order becomes one job." error={errors.orderRef}>
            {(props) => (
              <input {...props} className="input input--ref" value={form.orderRef} onChange={set('orderRef')} placeholder="ORD-2001" autoFocus />
            )}
          </Field>
          <Field label="Load (units)" hint="Must fit within a rider's capacity." error={errors.load}>
            {(props) => <input {...props} className="input" type="number" min={1} max={1000} value={form.load} onChange={set('load')} />}
          </Field>
          <Field label="Pickup zone" error={errors.pickupZone}>
            {(props) => (
              <select {...props} className="input" value={form.pickupZone} onChange={set('pickupZone')}>
                <option value="">Choose a zone</option>
                {ZONE_ORDER.map((z) => (
                  <option key={z} value={z}>
                    {ZONE_LABELS[z]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Drop zone" error={errors.dropZone}>
            {(props) => (
              <select {...props} className="input" value={form.dropZone} onChange={set('dropZone')}>
                <option value="">Choose a zone</option>
                {ZONE_ORDER.map((z) => (
                  <option key={z} value={z}>
                    {ZONE_LABELS[z]}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>

        <FieldSet legend="Priority" error={errors.priority}>
          <div className="segmented" role="radiogroup">
            {PRIORITY_ORDER.map((p) => (
              <label key={p} className={`segmented__option segmented__option--${p.toLowerCase()}`}>
                <input type="radio" name="priority" value={p} checked={form.priority === p} onChange={set('priority')} />
                <span>{PRIORITY_LABELS[p]}</span>
              </label>
            ))}
          </div>
        </FieldSet>

        <div className="form__grid">
          <Field label="Deadline (optional)" hint="Leave empty if there is no delivery deadline." error={errors.deadline}>
            {(props) => (
              <input
                {...props}
                className="input"
                type="datetime-local"
                min={toLocalInputValue(serverNow())}
                value={form.deadline}
                onChange={set('deadline')}
              />
            )}
          </Field>
          <Field label="Notes (optional)" error={errors.notes}>
            {(props) => (
              <textarea {...props} className="input" rows={2} maxLength={500} value={form.notes} onChange={set('notes')} placeholder="e.g. Fragile, handle with care" />
            )}
          </Field>
        </div>

        {code === 'ORDER_REF_CONFLICT' ? (
          <ConflictMessage error={createJob.error} />
        ) : (
          createJob.error && Object.keys(errors).length === 0 && <FormError error={createJob.error} />
        )}

        <div className="form__actions">
          <Link to="/jobs" className="button button--quiet">
            Cancel
          </Link>
          <button type="submit" className="button button--primary" disabled={createJob.isPending}>
            {createJob.isPending ? 'Creating job…' : 'Create job'}
          </button>
        </div>
      </form>
    </>
  );
}
