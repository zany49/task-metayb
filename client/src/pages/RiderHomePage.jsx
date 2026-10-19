import { useState } from 'react';
import { useMe, useMyAssignments, useSetAvailability, useWorkflowAction } from '../api/queries.js';
import { useAuth } from '../auth/AuthContext.jsx';
import ReasonDialog from '../components/ReasonDialog.jsx';
import { EmptyState, ErrorState, Spinner } from '../components/States.jsx';
import { LoadBar, PriorityTag, RouteText, ZoneList } from '../components/Tags.jsx';
import { useToast } from '../components/Toast.jsx';
import { describeDeadline, formatDateTime, formatDuration, formatMobile } from '../lib/format.js';
import { ASSIGNMENT_STATUS_LABELS, AVAILABILITY_LABELS, AVAILABILITY_ORDER, ZONE_LABELS, zoneLabel } from '../lib/labels.js';
import { minutesUntil, useNow } from '../lib/useNow.js';

function JobFacts({ job }) {
  const deadline = describeDeadline(job.deadline, { isFinal: job.nextStatuses.length === 0 });
  return (
    <p className="job-card__facts">
      <RouteText from={job.pickupZone} to={job.dropZone} />
      <span>{job.load} units</span>
      <PriorityTag priority={job.priority} />
      {job.deadline && <span className={`deadline deadline--${deadline.tone}`}>Due {deadline.text}</span>}
    </p>
  );
}

/** One live job: a new offer to answer, or a job in progress. */
function LiveJob({ item, now, onDecline, onDrop, run, pending }) {
  const { assignment, job } = item;
  if (!job) return null;

  if (assignment.status === 'PENDING') {
    const left = minutesUntil(assignment.expiresAt, now);
    return (
      <li className="job-card job-card--offer">
        <p className="job-card__eyebrow">New job offer</p>
        <h3 className="job-card__title">{job.orderRef}</h3>
        <JobFacts job={job} />
        {job.notes && <p className="job-card__notes">{job.notes}</p>}
        <p className={`countdown${left <= 15 ? ' countdown--soon' : ''}`}>
          {left > 0 ? `Answer within ${formatDuration(left)}` : 'Time to answer is up'}
        </p>
        <div className="job-card__actions">
          <button
            type="button"
            className="button button--primary"
            disabled={pending || left <= 0}
            onClick={() => run(`/assignments/${assignment.id}/accept`, `You accepted ${job.orderRef}. Head to ${zoneLabel(job.pickupZone)} for pickup.`)}
          >
            Accept
          </button>
          <button type="button" className="button" disabled={pending || left <= 0} onClick={() => onDecline(item)}>
            Decline
          </button>
        </div>
      </li>
    );
  }

  const pickedUp = job.status === 'PICKED_UP';
  return (
    <li className="job-card job-card--active">
      <p className="job-card__eyebrow">{pickedUp ? `Deliver to ${zoneLabel(job.dropZone)}` : `Pick up in ${zoneLabel(job.pickupZone)}`}</p>
      <h3 className="job-card__title">{job.orderRef}</h3>
      <JobFacts job={job} />
      {job.notes && <p className="job-card__notes">{job.notes}</p>}
      <div className="job-card__actions">
        {pickedUp ? (
          <button
            type="button"
            className="button button--primary"
            disabled={pending}
            onClick={() => run(`/jobs/${job.orderRef}/deliver`, `${job.orderRef} delivered. Thank you!`)}
          >
            Delivered
          </button>
        ) : (
          <>
            <button
              type="button"
              className="button button--primary"
              disabled={pending}
              onClick={() => run(`/jobs/${job.orderRef}/pickup`, `Picked up ${job.orderRef}. Deliver to ${zoneLabel(job.dropZone)}.`)}
            >
              Picked up
            </button>
            <button type="button" className="button button--danger-quiet" disabled={pending} onClick={() => onDrop(item)}>
              I can't do this job
            </button>
          </>
        )}
      </div>
    </li>
  );
}

function MyJobs() {
  const toast = useToast();
  const mine = useMyAssignments();
  const action = useWorkflowAction();
  const now = useNow(15_000);
  const [declineFor, setDeclineFor] = useState(null);
  const [dropFor, setDropFor] = useState(null);

  const run = (path, message) =>
    action.mutate({ path }, { onSuccess: () => toast.success(message), onError: (error) => toast.error(error.message) });

  if (mine.isPending) return <Spinner label="Loading your jobs" />;
  if (mine.isError) return <ErrorState error={mine.error} onRetry={mine.refetch} title="Your jobs could not be loaded" />;

  const { live, recent } = mine.data;
  return (
    <>
      {live.length === 0 ? (
        <EmptyState title="No jobs assigned to you">When a dispatcher assigns you a job, it appears here for you to accept or decline.</EmptyState>
      ) : (
        <ul className="job-cards">
          {live.map((item) => (
            <LiveJob
              key={item.assignment.id}
              item={item}
              now={now}
              run={run}
              pending={action.isPending}
              onDecline={setDeclineFor}
              onDrop={setDropFor}
            />
          ))}
        </ul>
      )}

      {recent.length > 0 && (
        <>
          <h3 className="subsection-title">Recent</h3>
          <ul className="recent-list">
            {recent.map(({ assignment, job }) => (
              <li key={assignment.id}>
                <span className="order-ref order-ref--small">{assignment.orderRef}</span>
                <span className={`attempt-status attempt-status--${assignment.status.toLowerCase()}`}>
                  {ASSIGNMENT_STATUS_LABELS[assignment.status]}
                </span>
                {job && <RouteText from={job.pickupZone} to={job.dropZone} />}
                <span className="muted">{assignment.endedAt && formatDateTime(assignment.endedAt)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <ReasonDialog
        open={Boolean(declineFor)}
        onClose={() => setDeclineFor(null)}
        title={declineFor ? `Decline ${declineFor.job.orderRef}?` : ''}
        description="The dispatcher will give this job to someone else."
        label="Why can't you take it?"
        placeholder="e.g. Vehicle is being repaired"
        confirmLabel="Decline job"
        onConfirm={(reason) =>
          action.mutateAsync({ path: `/assignments/${declineFor.assignment.id}/reject`, body: { reason } }).then(() => toast.success('Job declined'))
        }
      />
      <ReasonDialog
        open={Boolean(dropFor)}
        onClose={() => setDropFor(null)}
        title={dropFor ? `Give ${dropFor.job.orderRef} back?` : ''}
        description="The job goes back to the dispatcher to find another rider."
        label="What happened?"
        placeholder="e.g. Vehicle broke down"
        confirmLabel="Give job back"
        danger
        onConfirm={(reason) =>
          action.mutateAsync({ path: `/jobs/${dropFor.job.orderRef}/unassign`, body: { reason } }).then(() => toast.success('Job given back to the dispatcher'))
        }
      />
    </>
  );
}

/** A rider's own page: their jobs, their availability, capacity and zones. */
export default function RiderHomePage() {
  const { user } = useAuth();
  const toast = useToast();
  const me = useMe();
  const setAvailability = useSetAvailability();

  if (me.isPending) {
    return (
      <div className="center-block">
        <Spinner label="Loading your profile" />
      </div>
    );
  }
  if (me.isError) return <ErrorState error={me.error} onRetry={me.refetch} title="Your profile could not be loaded" />;

  const rider = me.data.rider;
  const firstName = user.name.split(' ')[0];

  const choose = (availability) => {
    if (availability === rider.availability) return;
    setAvailability.mutate(
      { id: rider.id, availability },
      {
        onSuccess: () => toast.success(`You are now ${AVAILABILITY_LABELS[availability].toLowerCase()}`),
        onError: (error) => toast.error(error.message),
      },
    );
  };

  return (
    <div className="rider-home">
      <div className="page-head">
        <div>
          <h1 className="page-title">Hello, {firstName}</h1>
          <p className="page-subtitle">{formatMobile(rider.mobile)}</p>
        </div>
      </div>

      <section className="panel">
        <h2 className="section-title">Your jobs</h2>
        <MyJobs />
      </section>

      <section className="panel">
        <h2 className="section-title">Your status</h2>
        <p className="muted">Dispatchers only offer you jobs while you are available.</p>
        <div className="segmented segmented--large" role="radiogroup" aria-label="Your availability">
          {AVAILABILITY_ORDER.map((a) => (
            <label key={a} className={`segmented__option segmented__option--${a.toLowerCase()}`}>
              <input
                type="radio"
                name="availability"
                value={a}
                checked={rider.availability === a}
                disabled={setAvailability.isPending}
                onChange={() => choose(a)}
              />
              <span>{AVAILABILITY_LABELS[a]}</span>
            </label>
          ))}
        </div>

        <dl className="facts facts--wide">
          <dt>Load reserved</dt>
          <dd>
            <LoadBar used={rider.reservedLoad} total={rider.capacity} label="Your reserved load" />
          </dd>
          <dt>Jobs</dt>
          <dd>
            {rider.activeJobs} of {rider.maxActiveJobs}
          </dd>
          <dt>Zones</dt>
          <dd>
            <ZoneList zones={rider.zones} />
          </dd>
          <dt>Current zone</dt>
          <dd>{ZONE_LABELS[rider.currentZone]}</dd>
        </dl>
        {!rider.workload.canTakeMoreJobs && (
          <p className="callout">
            You won't receive new jobs right now:{' '}
            {rider.workload.blockers.map((b) => b.replace(/^Rider is/, 'you are').replace(/^At/, 'at').replace(/^No/, 'no')).join('; ')}.
          </p>
        )}
      </section>
    </div>
  );
}
