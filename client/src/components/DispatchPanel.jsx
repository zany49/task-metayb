import { useState } from 'react';
import { useJobAssignments, useRecommendations, useWorkflowAction } from '../api/queries.js';
import { formatDateTime, formatDuration, formatTime } from '../lib/format.js';
import { ASSIGNMENT_STATUS_LABELS, zoneLabel } from '../lib/labels.js';
import { minutesUntil, useNow } from '../lib/useNow.js';
import ReasonDialog from './ReasonDialog.jsx';
import { EmptyState, ErrorState, Spinner } from './States.jsx';
import { useToast } from './Toast.jsx';

const jobPath = (job, action) => `/jobs/${encodeURIComponent(job.orderRef)}/${action}`;
const firstName = (name) => (name ?? '').split(' ')[0];

/** Runs a workflow action and reports the outcome in a toast. Returns the promise. */
function useRun() {
  const action = useWorkflowAction();
  const toast = useToast();
  const run = (path, body, successMessage) =>
    action.mutateAsync({ path, body }).then((result) => {
      if (successMessage) toast.success(successMessage);
      return result;
    });
  /** Same, but errors become a toast instead of being thrown (for buttons without a dialog). */
  const runWithToast = (path, body, successMessage) => run(path, body, successMessage).catch((err) => toast.error(err.message));
  return { run, runWithToast, pending: action.isPending };
}

// ---------------------------------------------------------------------------------------------
// Ready / Manual queue: recommendations

function Candidate({ candidate, top, onAssign, onOverride, disabled }) {
  const isTop = candidate.rank === 1;
  return (
    <li className={`candidate${isTop ? ' candidate--top' : ''}`}>
      <span className="candidate__rank" aria-label={`Rank ${candidate.rank}`}>
        {candidate.rank}
      </span>
      <div className="candidate__main">
        <p className="candidate__name">
          {candidate.name}
          {isTop && <span className="tag-recommended">Recommended</span>}
        </p>
        <ul className="candidate__reasons">
          {candidate.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
        {candidate.warnings.map((warning) => (
          <p key={warning} className="candidate__warning">
            {warning}
          </p>
        ))}
        {candidate.whyAboveNext && <p className="candidate__why">{candidate.whyAboveNext}.</p>}
      </div>
      <div className="candidate__score" title="Match score out of 100">
        <span className="candidate__score-value">{candidate.score}</span>
        <span className="candidate__score-bar" aria-hidden="true">
          <span style={{ width: `${candidate.score}%` }} />
        </span>
      </div>
      <div className="candidate__action">
        {isTop ? (
          <button type="button" className="button button--primary" disabled={disabled} onClick={() => onAssign(candidate)}>
            Assign
          </button>
        ) : (
          <button
            type="button"
            className="button"
            disabled={disabled}
            onClick={() => onOverride(candidate)}
            aria-label={`Assign ${candidate.name} instead of ${top.name}`}
          >
            Assign instead
          </button>
        )}
      </div>
    </li>
  );
}

function Recommendations({ job }) {
  const recs = useRecommendations(job.orderRef);
  const { run, pending } = useRun();
  const toast = useToast();
  const [overrideFor, setOverrideFor] = useState(null);
  const [parkOpen, setParkOpen] = useState(false);

  const assign = (candidate, overrideReason) =>
    run(
      jobPath(job, 'assignments'),
      { riderId: candidate.riderId, overrideReason },
      `${candidate.name} assigned. Waiting for ${firstName(candidate.name)} to confirm.`,
    );

  const assignTop = (candidate) =>
    assign(candidate).catch((err) => {
      toast.error(err.message);
      recs.refetch();
    });

  const data = recs.data;
  const top = data?.recommended[0];

  return (
    <section className="panel dispatch" aria-labelledby="dispatch-title">
      <div className="dispatch__head">
        <h2 id="dispatch-title" className="section-title">
          {job.status === 'MANUAL_QUEUE' ? 'Reassign a rider' : 'Assign a rider'}
        </h2>
        {data && (
          <p className="muted">
            Ranked by distance to pickup, current jobs, deadline and spare capacity. The rider then has{' '}
            {data.confirmationTimeoutMinutes} min to confirm.
          </p>
        )}
      </div>

      {recs.isPending || recs.error?.code === 'JOB_NOT_ASSIGNABLE' ? (
        // JOB_NOT_ASSIGNABLE: someone (maybe us) just assigned the job; the page is about to refresh.
        <Spinner label={recs.isPending ? 'Finding riders' : 'Updating'} />
      ) : recs.isError ? (
        <ErrorState error={recs.error} onRetry={recs.refetch} title="Riders could not be ranked" />
      ) : data.recommended.length === 0 ? (
        <EmptyState
          title="No rider can take this job right now"
          action={
            job.status === 'READY_FOR_ASSIGNMENT' && (
              <button type="button" className="button" onClick={() => setParkOpen(true)}>
                Move to manual queue
              </button>
            )
          }
        >
          Change a rider's availability, zones or capacity on the Riders page, and they will appear here.
        </EmptyState>
      ) : (
        <ol className="candidates">
          {data.recommended.map((candidate) => (
            <Candidate
              key={candidate.riderId}
              candidate={candidate}
              top={top}
              disabled={pending}
              onAssign={assignTop}
              onOverride={setOverrideFor}
            />
          ))}
        </ol>
      )}

      {data?.notEligible.length > 0 && (
        <details className="not-eligible">
          <summary>
            {data.notEligible.length} {data.notEligible.length === 1 ? 'rider is' : 'riders are'} not eligible
          </summary>
          <ul>
            {data.notEligible.map((rider) => (
              <li key={rider.riderId}>
                <span className="not-eligible__name">{rider.name}</span>
                <span className="not-eligible__reasons">{rider.reasons.join('; ')}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <ReasonDialog
        open={Boolean(overrideFor)}
        onClose={() => setOverrideFor(null)}
        title={overrideFor ? `Assign ${overrideFor.name} instead?` : ''}
        description={
          overrideFor && top
            ? `${top.name} is the recommended rider. Your reason for choosing ${firstName(overrideFor.name)} is saved in the job's history.`
            : ''
        }
        label="Reason"
        placeholder={`e.g. ${top ? firstName(top.name) : 'The recommended rider'} is stuck in traffic`}
        minLength={5}
        confirmLabel={overrideFor ? `Assign ${firstName(overrideFor.name)}` : 'Assign'}
        pendingLabel="Assigning…"
        onConfirm={(reason) => assign(overrideFor, reason)}
      />
      <ReasonDialog
        open={parkOpen}
        onClose={() => setParkOpen(false)}
        title={`Move ${job.orderRef} to the manual queue?`}
        description="The job stays unassigned and is listed in the manual queue for a dispatcher to follow up."
        placeholder="e.g. Waiting for a large vehicle to come back"
        confirmLabel="Move to manual queue"
        pendingLabel="Moving…"
        onConfirm={(reason) => run(jobPath(job, 'manual-queue'), { reason }, `${job.orderRef} moved to the manual queue`)}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Awaiting confirmation

function AwaitingRider({ job }) {
  const now = useNow(15_000);
  const { run, runWithToast, pending } = useRun();
  const [declineOpen, setDeclineOpen] = useState(false);
  const [takeBackOpen, setTakeBackOpen] = useState(false);
  const left = minutesUntil(job.confirmationDueAt, now);
  const name = firstName(job.riderName);

  return (
    <section className="panel dispatch dispatch--waiting" aria-labelledby="dispatch-title">
      <div className="dispatch__head">
        <h2 id="dispatch-title" className="section-title">
          Waiting for {job.riderName} to confirm
        </h2>
        <p className={`countdown${left <= 15 ? ' countdown--soon' : ''}`}>
          {left > 0 ? `${formatDuration(left)} left` : 'Time is up. Moving to the manual queue…'}
          <span className="countdown__until">until {formatTime(job.confirmationDueAt)}</span>
        </p>
        <p className="muted">If {name} doesn't confirm in time, the job moves to the manual queue automatically.</p>
      </div>
      <div className="dispatch__actions">
        <button
          type="button"
          className="button button--primary"
          disabled={pending}
          onClick={() => runWithToast(`/assignments/${job.currentAssignmentId}/accept`, {}, `Recorded: ${name} accepted ${job.orderRef}`)}
        >
          Mark as accepted
        </button>
        <button type="button" className="button" disabled={pending} onClick={() => setDeclineOpen(true)}>
          Mark as declined
        </button>
        <button type="button" className="button button--danger-quiet" disabled={pending} onClick={() => setTakeBackOpen(true)}>
          Take job back
        </button>
      </div>
      <p className="field__hint">Use these when {name} answers by phone. Riders can also answer in their own app.</p>

      <ReasonDialog
        open={declineOpen}
        onClose={() => setDeclineOpen(false)}
        title={`Record that ${name} declined?`}
        description="The job moves to the manual queue, and this rider is not recommended for it again."
        label="Reason given"
        placeholder="e.g. Vehicle is being repaired"
        confirmLabel="Record decline"
        onConfirm={(reason) => run(`/assignments/${job.currentAssignmentId}/reject`, { reason }, `${job.orderRef} moved to the manual queue`)}
      />
      <ReasonDialog
        open={takeBackOpen}
        onClose={() => setTakeBackOpen(false)}
        title={`Take ${job.orderRef} back from ${name}?`}
        description={`${name}'s reserved capacity is released and the job moves to the manual queue.`}
        placeholder="e.g. Customer asked for a later slot"
        confirmLabel="Take job back"
        danger
        onConfirm={(reason) => run(jobPath(job, 'unassign'), { reason }, `${job.orderRef} taken back from ${name}`)}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// With the rider: accepted / picked up / delivered

function WithRider({ job }) {
  const { run, runWithToast, pending } = useRun();
  const [takeBackOpen, setTakeBackOpen] = useState(false);
  const name = firstName(job.riderName);

  if (job.status === 'DELIVERED') {
    return (
      <section className="panel dispatch dispatch--done">
        <h2 className="section-title">Delivered by {job.riderName}</h2>
        <p className="muted">
          Delivered in {zoneLabel(job.dropZone)} at {formatDateTime(job.statusChangedAt)}.
        </p>
      </section>
    );
  }

  const accepted = job.status === 'ACCEPTED';
  return (
    <section className="panel dispatch" aria-labelledby="dispatch-title">
      <div className="dispatch__head">
        <h2 id="dispatch-title" className="section-title">
          {accepted ? `${job.riderName} is heading to the pickup` : `${job.riderName} has the delivery`}
        </h2>
        <p className="muted">
          {accepted
            ? `Accepted. Pick up in ${zoneLabel(job.pickupZone)}, deliver to ${zoneLabel(job.dropZone)}.`
            : `Picked up in ${zoneLabel(job.pickupZone)}; on the way to ${zoneLabel(job.dropZone)}.`}
        </p>
      </div>
      <div className="dispatch__actions">
        {accepted ? (
          <>
            <button
              type="button"
              className="button button--primary"
              disabled={pending}
              onClick={() => runWithToast(jobPath(job, 'pickup'), {}, `Recorded: ${name} picked up ${job.orderRef}`)}
            >
              Mark as picked up
            </button>
            <button type="button" className="button button--danger-quiet" disabled={pending} onClick={() => setTakeBackOpen(true)}>
              Take job back
            </button>
          </>
        ) : (
          <button
            type="button"
            className="button button--primary"
            disabled={pending}
            onClick={() => runWithToast(jobPath(job, 'deliver'), {}, `${job.orderRef} delivered`)}
          >
            Mark as delivered
          </button>
        )}
      </div>

      <ReasonDialog
        open={takeBackOpen}
        onClose={() => setTakeBackOpen(false)}
        title={`Take ${job.orderRef} back from ${name}?`}
        description={`${name}'s reserved capacity is released and the job moves to the manual queue.`}
        placeholder="e.g. Rider's vehicle broke down"
        confirmLabel="Take job back"
        danger
        onConfirm={(reason) => run(jobPath(job, 'unassign'), { reason }, `${job.orderRef} taken back from ${name}`)}
      />
    </section>
  );
}

/** The part of the job page where the dispatcher acts, depending on where the job is. */
export default function DispatchPanel({ job }) {
  switch (job.status) {
    case 'READY_FOR_ASSIGNMENT':
    case 'MANUAL_QUEUE':
      return <Recommendations job={job} />;
    case 'AWAITING_CONFIRMATION':
      return <AwaitingRider job={job} />;
    case 'ACCEPTED':
    case 'PICKED_UP':
    case 'DELIVERED':
      return <WithRider job={job} />;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Attempts

/** Every rider asked to take this job, and how each attempt went. */
export function AttemptList({ jobRef }) {
  const attempts = useJobAssignments(jobRef);
  if (attempts.isPending) return <Spinner label="Loading assignment attempts" />;
  if (attempts.isError) return <ErrorState error={attempts.error} onRetry={attempts.refetch} title="Attempts could not be loaded" />;
  if (attempts.data.items.length === 0) return <p className="muted">No rider has been assigned yet.</p>;

  return (
    <ol className="attempts">
      {attempts.data.items.map((a) => (
        <li key={a.id} className="attempt">
          <p className="attempt__head">
            <span className="attempt__name">
              {a.attempt}. {a.riderName}
            </span>
            <span className={`attempt-status attempt-status--${a.status.toLowerCase()}`}>{ASSIGNMENT_STATUS_LABELS[a.status]}</span>
          </p>
          <p className="attempt__meta">
            {a.assignedBy.name}, {formatDateTime(a.assignedAt)}.{' '}
            {a.isOverride
              ? `Chosen over ${a.recommendation?.recommendedRider?.name}: "${a.overrideReason}"`
              : `Recommended rider${a.recommendation?.rank ? ` (#${a.recommendation.rank})` : ''}`}
          </p>
          {a.endReason && a.status !== 'COMPLETED' && <p className="attempt__meta">{a.endReason.message}</p>}
        </li>
      ))}
    </ol>
  );
}
