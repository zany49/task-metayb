import { useEffect, useState } from 'react';
import { fieldErrorsFrom } from '../api/client.js';
import { useCreateRider, useUpdateRider } from '../api/queries.js';
import { formatMobile } from '../lib/format.js';
import { AVAILABILITY_LABELS, AVAILABILITY_ORDER, ZONE_LABELS, ZONE_ORDER } from '../lib/labels.js';
import Field, { FieldSet } from './Field.jsx';
import Modal from './Modal.jsx';
import { FormError } from './States.jsx';
import { useToast } from './Toast.jsx';

const EMPTY = { name: '', mobile: '', zones: [], capacity: '', maxActiveJobs: '3', currentZone: '', availability: 'AVAILABLE' };

function fromRider(rider) {
  return {
    name: rider.name,
    mobile: rider.mobile,
    zones: rider.zones,
    capacity: String(rider.capacity),
    maxActiveJobs: String(rider.maxActiveJobs),
    currentZone: rider.currentZone,
    availability: rider.availability,
  };
}

const toNumber = (value) => (value === '' ? undefined : Number(value));

/** Add a rider (rider === null) or edit one. */
export default function RiderFormModal({ open, rider, onClose }) {
  const toast = useToast();
  const createRider = useCreateRider();
  const updateRider = useUpdateRider();
  const mutation = rider ? updateRider : createRider;
  const [form, setForm] = useState(EMPTY);

  useEffect(() => {
    if (open) {
      setForm(rider ? fromRider(rider) : EMPTY);
      createRider.reset();
      updateRider.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rider]);

  const set = (field) => (event) => setForm((f) => ({ ...f, [field]: event.target.value }));
  const toggleZone = (zone) =>
    setForm((f) => ({ ...f, zones: f.zones.includes(zone) ? f.zones.filter((z) => z !== zone) : [...f.zones, zone] }));

  const errors = fieldErrorsFrom(mutation.error);
  if (mutation.error?.code === 'MOBILE_ALREADY_REGISTERED') errors.mobile = mutation.error.message;
  if (mutation.error?.code === 'RIDER_LOAD_EXCEEDS_LIMIT') errors.capacity = mutation.error.message;
  const otherError = mutation.error && Object.keys(errors).length === 0 ? mutation.error : null;

  const submit = (event) => {
    event.preventDefault();
    const common = {
      name: form.name,
      zones: ZONE_ORDER.filter((z) => form.zones.includes(z)),
      capacity: toNumber(form.capacity),
      maxActiveJobs: toNumber(form.maxActiveJobs),
      currentZone: form.currentZone || undefined,
    };
    if (rider) {
      updateRider.mutate(
        { id: rider.id, ...common },
        {
          onSuccess: (saved) => {
            toast.success(`${saved.name} updated`);
            onClose();
          },
        },
      );
    } else {
      createRider.mutate(
        { ...common, mobile: form.mobile, availability: form.availability },
        {
          onSuccess: (saved) => {
            toast.success(`${saved.name} added. They can sign in with ${formatMobile(saved.mobile)}.`);
            onClose();
          },
        },
      );
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={rider ? `Edit ${rider.name}` : 'Add rider'}
      footer={
        <>
          <button type="button" className="button button--quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="rider-form" className="button button--primary" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : rider ? 'Save changes' : 'Add rider'}
          </button>
        </>
      }
    >
      <form id="rider-form" className="stack" onSubmit={submit} noValidate>
        <div className="form__grid">
          <Field label="Full name" error={errors.name}>
            {(props) => <input {...props} className="input" value={form.name} onChange={set('name')} autoComplete="off" autoFocus />}
          </Field>
          {rider ? (
            <Field label="Mobile number" hint="The mobile number is the rider's sign-in, so it can't be changed here.">
              {(props) => <input {...props} className="input" value={formatMobile(form.mobile)} readOnly disabled />}
            </Field>
          ) : (
            <Field label="Mobile number" hint="The rider signs in with this number." error={errors.mobile}>
              {(props) => <input {...props} className="input" type="tel" inputMode="tel" value={form.mobile} onChange={set('mobile')} placeholder="98765 43210" />}
            </Field>
          )}
        </div>

        <FieldSet legend="Service zones" hint="Zones this rider can pick up from and deliver to." error={errors.zones}>
          <div className="chip-options">
            {ZONE_ORDER.map((zone) => (
              <label key={zone} className="chip-option">
                <input type="checkbox" checked={form.zones.includes(zone)} onChange={() => toggleZone(zone)} />
                <span>{ZONE_LABELS[zone]}</span>
              </label>
            ))}
          </div>
        </FieldSet>

        <div className="form__grid form__grid--three">
          <Field label="Capacity (units)" error={errors.capacity}>
            {(props) => <input {...props} className="input" type="number" min={1} value={form.capacity} onChange={set('capacity')} />}
          </Field>
          <Field label="Most jobs at once" error={errors.maxActiveJobs}>
            {(props) => <input {...props} className="input" type="number" min={1} max={20} value={form.maxActiveJobs} onChange={set('maxActiveJobs')} />}
          </Field>
          <Field label="Current zone" hint="Where the rider is now." error={errors.currentZone}>
            {(props) => (
              <select {...props} className="input" value={form.currentZone} onChange={set('currentZone')}>
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

        {!rider && (
          <Field label="Availability" error={errors.availability}>
            {(props) => (
              <select {...props} className="input input--narrow" value={form.availability} onChange={set('availability')}>
                {AVAILABILITY_ORDER.map((a) => (
                  <option key={a} value={a}>
                    {AVAILABILITY_LABELS[a]}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}

        <FormError error={otherError} />
      </form>
    </Modal>
  );
}
