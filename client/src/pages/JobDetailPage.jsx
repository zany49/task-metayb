import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fieldErrorsFrom } from '../api/client.js';
import { useCancelJob, useJob, useJobEvents, useMeta } from '../api/queries.js';
import DispatchPanel, { AttemptList } from '../components/DispatchPanel.jsx';
import Field from '../components/Field.jsx';
import Modal from '../components/Modal.jsx';
import RouteLine from '../components/RouteLine.jsx';
import { EmptyState, ErrorState, FormError, Spinner } from '../components/States.jsx';
import { PriorityTag, RouteText, StatusPill } from '../components/Tags.jsx';
import { useToast } from '../components/Toast.jsx';
import { describeDeadline, formatDate, formatDateTime, formatDuration, formatTime } from '../lib/format.js';
import { MANUAL_QUEUE_REASON_LABELS, ROLE_LABELS, STATUS_LABELS, STATUS_LONG_LABELS } from '../lib/labels.js';

function BackLink() {
  return (
    <Link to="/jobs" className="back-link">
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M10 3 5 8l5 5" />
      </svg>
      All jobs
    </Link>
  );
}

function CancelJobDialog({ job, open, onClose }) {
  const toast = useToast();
  const cancelJob = useCancelJob(job.orderRef);
  const [reason, setReason] = useState('');
  const errors = fieldErrorsFrom(cancelJob.error);

  const close = () => {
    cancelJob.reset();
    setReason('');
    onClose();
  };

  const submit = (event) => {
    event.preventDefault();
    cancelJob.mutate(reason, {
      onSuccess: () => {
        toast.success(`Job ${job.orderRef} cancelled`);
        close();
      },
    });
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={`Cancel job ${job.orderRef}?`}
      footer={
        <>
          <button type="button" className="button button--quiet" onClick={close}>
            Keep job
          </button>
          <button type="submit" form="cancel-job-form" className="button button--danger" disabled={cancelJob.isPending || reason.trim().length < 3}>
            {cancelJob.isPending ? 'Cancelling…' : 'Cancel job'}
          </button>
        </>
      }
    >
      <form id="cancel-job-form" onSubmit={submit} className="stack">
        <p>
          The job leaves the dispatch queue and cannot be reopened. The reason is saved in its history.
          {job.riderName && ` ${job.riderName}'s assignment ends and their reserved capacity is released.`}
        </p>
        <Field label="Reason" error={errors.reason}>
          {(props) => (
            <textarea
              {...props}
              className="input"
              rows={3}
              maxLength={300}
              placeholder="e.g. Customer cancelled the order"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              autoFocus
            />
          )}
        </Field>
        {!errors.reason && <FormError error={cancelJob.error} />}
      </form>
    </Modal>
  );
}

function History({ events }) {
  if (events.length === 0) return <EmptyState title="No history yet" />;

  let lastDate = null;
  return (
    <ol className="timeline">
      {events.map((event) => {
        const date = formatDate(event.at);
        const showDate = date !== lastDate;
        lastDate = date;
        return (
          <li key={event.id} className={`timeline__item timeline__item--${event.actor.type.toLowerCase()}`}>
            <time className="timeline__time" dateTime={event.at}>
              {formatTime(event.at)}
              {showDate && <span className="timeline__date">{date}</span>}
            </time>
            <span className="timeline__node" aria-hidden="true" />
            <div className="timeline__body">
              <p className="timeline__message">{event.message}</p>
              <p className="timeline__meta">
                <span className={`actor actor--${event.actor.type.toLowerCase()}`}>{ROLE_LABELS[event.actor.type]}</span>
                {event.fromStatus && event.toStatus && (
                  <span className="timeline__change">
                    {STATUS_LABELS[event.fromStatus]} <span aria-label="to">→</span> {STATUS_LABELS[event.toStatus]}
                  </span>
                )}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export default function JobDetailPage() {
  const { jobRef } = useParams();
  const [cancelOpen, setCancelOpen] = useState(false);
  useMeta(); // keeps relative times in step with the server's clock
  const job = useJob(jobRef);
  const history = useJobEvents(jobRef);

  if (job.isPending) {
    return (
      <>
        <BackLink />
        <div className="center-block">
          <Spinner label="Loading job" />
        </div>
      </>
    );
  }

  if (job.isError) {
    return (
      <>
        <BackLink />
        {job.error.status === 404 ? (
          <EmptyState title={`Job ${jobRef.toUpperCase()} was not found`} action={<Link to="/jobs" className="button">Back to all jobs</Link>}>
            Check the order reference, or search for it in the jobs list.
          </EmptyState>
        ) : (
          <ErrorState error={job.error} onRetry={job.refetch} title="This job could not be loaded" />
        )}
      </>
    );
  }

  const j = job.data;
  const events = history.data?.events ?? [];
  const visited = new Set(events.flatMap((e) => [e.fromStatus, e.toStatus]).filter(Boolean));
  const canCancel = j.nextStatuses.includes('CANCELLED');
  const deadline = describeDeadline(j.deadline, { isFinal: j.nextStatuses.length === 0 });

  return (
    <>
      <BackLink />
      <div className="page-head">
        <div>
          <h1 className="page-title page-title--ref">{j.orderRef}</h1>
          <p className="job-tags">
            <StatusPill status={j.status} />
            <PriorityTag priority={j.priority} />
            {j.isOverdue && <span className="deadline deadline--late">Past deadline</span>}
          </p>
        </div>
        {canCancel && (
          <button type="button" className="button button--danger-quiet" onClick={() => setCancelOpen(true)}>
            Cancel job
          </button>
        )}
      </div>

      <section className="panel panel--route" aria-label="Where this job is">
        <RouteLine mode="job" current={j.status} visited={visited} />
        <p className="route-caption">
          {STATUS_LONG_LABELS[j.status]} for {formatDuration(j.minutesInStatus)}
        </p>
      </section>

      {j.status === 'MANUAL_QUEUE' && j.manualQueueReason && (
        <div className="callout callout--attention" role="status">
          <strong>Needs a dispatcher: {MANUAL_QUEUE_REASON_LABELS[j.manualQueueReason.code]?.toLowerCase() ?? 'see history'}.</strong>{' '}
          {j.manualQueueReason.message}
        </div>
      )}
      {j.status === 'CANCELLED' && j.cancelReason && (
        <div className="callout">
          <strong>Cancelled.</strong> {j.cancelReason}
        </div>
      )}

      <DispatchPanel job={j} />

      <div className="detail-grid">
        <section className="panel">
          <h2 className="section-title">Delivery</h2>
          <dl className="facts">
            <dt>Route</dt>
            <dd>
              <RouteText from={j.pickupZone} to={j.dropZone} />
            </dd>
            <dt>Load</dt>
            <dd>{j.load} units</dd>
            <dt>Deadline</dt>
            <dd>
              {j.deadline ? (
                <>
                  {formatDateTime(j.deadline)}
                  {deadline.text !== formatDateTime(j.deadline) && (
                    <span className={`deadline deadline--${deadline.tone} facts__aside`}>{deadline.text}</span>
                  )}
                </>
              ) : (
                'No deadline'
              )}
            </dd>
            <dt>Notes</dt>
            <dd>{j.notes ?? <span className="muted">None</span>}</dd>
            <dt>Rider</dt>
            <dd>{j.riderName ?? <span className="muted">Not assigned</span>}</dd>
          </dl>

          <h2 className="section-title">Assignment attempts</h2>
          <div className="facts-block">
            <AttemptList jobRef={j.orderRef} />
          </div>

          <h2 className="section-title">Record</h2>
          <dl className="facts">
            <dt>Created by</dt>
            <dd>{j.createdBy.name}</dd>
            <dt>Created</dt>
            <dd>{formatDateTime(j.createdAt)}</dd>
          </dl>
        </section>

        <section className="panel">
          <h2 className="section-title">History</h2>
          {history.isPending ? (
            <Spinner label="Loading history" />
          ) : history.isError ? (
            <ErrorState error={history.error} onRetry={history.refetch} title="History could not be loaded" />
          ) : (
            <History events={events} />
          )}
        </section>
      </div>

      {canCancel && <CancelJobDialog job={j} open={cancelOpen} onClose={() => setCancelOpen(false)} />}
    </>
  );
}
