import { useEffect, useState } from 'react';
import { useSettings, useSimulationAction, useSimulationClock, useUpdateSettings } from '../api/queries.js';
import { formatDuration, formatTime } from '../lib/format.js';
import { serverNow } from '../lib/time.js';
import { useNow } from '../lib/useNow.js';
import Field from './Field.jsx';
import Modal from './Modal.jsx';
import { FormError } from './States.jsx';
import { useToast } from './Toast.jsx';

const STEPS = [
  { minutes: 15, label: '+15 min' },
  { minutes: 60, label: '+1 h' },
  { minutes: 120, label: '+2 h' },
];

function TimeoutDialog({ open, onClose, current }) {
  const toast = useToast();
  const update = useUpdateSettings();
  const [minutes, setMinutes] = useState(String(current ?? ''));

  useEffect(() => {
    if (open) {
      setMinutes(String(current ?? ''));
      update.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, current]);

  const submit = (event) => {
    event.preventDefault();
    update.mutate(
      { confirmationTimeoutMinutes: Number(minutes) },
      {
        onSuccess: (s) => {
          toast.success(`Riders now have ${s.confirmationTimeoutMinutes} min to confirm new assignments`);
          onClose();
        },
      },
    );
  };

  const fieldError = update.error?.code === 'VALIDATION_ERROR' ? update.error.details?.[0]?.message : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Confirmation timeout"
      footer={
        <>
          <button type="button" className="button button--quiet" onClick={onClose}>
            Back
          </button>
          <button type="submit" form="timeout-form" className="button button--primary" disabled={update.isPending || !minutes}>
            {update.isPending ? 'Saving…' : 'Save timeout'}
          </button>
        </>
      }
    >
      <form id="timeout-form" className="stack" onSubmit={submit}>
        <p>How long a rider has to accept an assignment before the job moves to the manual queue. Riders already waiting keep the time they were given.</p>
        <Field label="Minutes to confirm" hint="The usual setting is 120 minutes. Use 1 or 2 to watch a timeout happen quickly." error={fieldError}>
          {(props) => (
            <input {...props} className="input input--narrow" type="number" min={1} max={1440} value={minutes} onChange={(e) => setMinutes(e.target.value)} autoFocus />
          )}
        </Field>
        {update.error && !fieldError && <FormError error={update.error} />}
      </form>
    </Modal>
  );
}

/**
 * Demo controls for dispatchers: move the app clock forward to see the confirmation timeout
 * without waiting, run the timeout check now, and change the timeout. Hidden when the server
 * has demo controls turned off.
 */
export default function SimulationBar() {
  const toast = useToast();
  const settings = useSettings();
  const enabled = Boolean(settings.data?.simulationEnabled);
  const clock = useSimulationClock({ enabled });
  const simulate = useSimulationAction();
  const [timeoutOpen, setTimeoutOpen] = useState(false);
  useNow(15_000); // re-render so the displayed time keeps moving

  if (!enabled) return null;

  const offset = clock.data?.offsetMinutes ?? 0;
  const timedOut = (n) =>
    n === 0 ? 'No assignments timed out.' : `${n} ${n === 1 ? 'assignment' : 'assignments'} timed out and moved to the manual queue.`;

  const run = (args, message) =>
    simulate.mutate(args, {
      onSuccess: (result) => toast.info(message(result)),
      onError: (error) => toast.error(error.message),
    });

  return (
    <div className="simbar" role="region" aria-label="Demo controls">
      <span className="simbar__title">Demo controls</span>
      <span className="simbar__clock">
        App time <strong>{formatTime(serverNow())}</strong>
        {offset > 0 && <span className="simbar__ahead">{formatDuration(offset)} ahead of real time</span>}
      </span>
      <span className="simbar__group" role="group" aria-label="Move the app clock forward">
        {STEPS.map((step) => (
          <button
            key={step.minutes}
            type="button"
            className="button button--small button--sim"
            disabled={simulate.isPending}
            onClick={() => run({ action: 'advance', minutes: step.minutes }, (r) => `Clock moved ${step.label.slice(1)} ahead. ${timedOut(r.expired)}`)}
          >
            {step.label}
          </button>
        ))}
        <button
          type="button"
          className="button button--small button--sim"
          disabled={simulate.isPending}
          onClick={() => run({ action: 'sweep' }, (r) => `Timeout check done. ${timedOut(r.expired)}`)}
        >
          Check timeouts now
        </button>
        {offset > 0 && (
          <button
            type="button"
            className="button button--small button--sim"
            disabled={simulate.isPending}
            onClick={() => run({ action: 'reset' }, () => 'Clock is back to real time')}
          >
            Back to real time
          </button>
        )}
      </span>
      <span className="simbar__timeout">
        Riders have <strong>{settings.data.confirmationTimeoutMinutes} min</strong> to confirm.{' '}
        <button type="button" className="link-button" onClick={() => setTimeoutOpen(true)}>
          Change
        </button>
      </span>
      <TimeoutDialog open={timeoutOpen} onClose={() => setTimeoutOpen(false)} current={settings.data.confirmationTimeoutMinutes} />
    </div>
  );
}
