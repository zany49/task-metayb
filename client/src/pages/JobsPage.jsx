import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useDashboardSummary, useJobs, useMeta } from '../api/queries.js';
import Pagination from '../components/Pagination.jsx';
import RouteLine from '../components/RouteLine.jsx';
import { EmptyState, ErrorState, SkeletonRows } from '../components/States.jsx';
import { PriorityTag, RouteText, StatusPill } from '../components/Tags.jsx';
import { describeDeadline, formatDuration, formatTime } from '../lib/format.js';
import { minutesUntil, useNow } from '../lib/useNow.js';
import {
  JOB_STATUS_ORDER,
  PRIORITY_LABELS,
  PRIORITY_ORDER,
  STATUS_LONG_LABELS,
  ZONE_LABELS,
  ZONE_ORDER,
} from '../lib/labels.js';

const FILTER_KEYS = ['status', 'zone', 'priority', 'q', 'overdue'];
const PAGE_SIZE = 20;

/** Filters live in the URL, so a filtered view can be bookmarked or shared and Back works. */
function useJobFilters() {
  const [params, setParams] = useSearchParams();
  const filters = {
    status: params.get('status') ?? '',
    zone: params.get('zone') ?? '',
    priority: params.get('priority') ?? '',
    q: params.get('q') ?? '',
    overdue: params.get('overdue') === 'true' ? 'true' : '',
    sort: params.get('sort') ?? 'newest',
    page: Math.max(1, Number(params.get('page')) || 1),
  };

  const update = (changes, { replace = false } = {}) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === '' || value === null || value === undefined) next.delete(key);
      else next.set(key, String(value));
    }
    if (!('page' in changes)) next.delete('page'); // a new filter starts at page 1
    setParams(next, { replace });
  };

  const clear = () => setParams(new URLSearchParams(filters.sort !== 'newest' ? { sort: filters.sort } : {}));
  const active = FILTER_KEYS.some((key) => filters[key]);
  return { filters, update, clear, active };
}

/** Who has the job; while waiting for confirmation, how long they have left. */
function RiderCell({ job, now }) {
  if (!job.riderName) return <span className="muted">—</span>;
  if (job.status !== 'AWAITING_CONFIRMATION' || !job.confirmationDueAt) return job.riderName;
  const left = minutesUntil(job.confirmationDueAt, now);
  return (
    <span className="person">
      <span>{job.riderName}</span>
      <span className={`person__meta${left <= 15 ? ' deadline--soon' : ''}`}>
        {left > 0 ? `${formatDuration(left)} to confirm` : 'Time to confirm is up'}
      </span>
    </span>
  );
}

function DeadlineCell({ job }) {
  const { text, tone } = describeDeadline(job.deadline, { isFinal: job.nextStatuses.length === 0 });
  return <span className={`deadline deadline--${tone}`}>{text}</span>;
}

export default function JobsPage() {
  const navigate = useNavigate();
  const { filters, update, clear, active } = useJobFilters();
  const [search, setSearch] = useState(filters.q);

  useMeta(); // keeps relative times in step with the server's clock
  const now = useNow(15_000);
  const summary = useDashboardSummary();
  const jobs = useJobs({ ...filters, limit: PAGE_SIZE });

  // Search as you type, without a request per keystroke.
  useEffect(() => {
    const handle = setTimeout(() => {
      if (search.trim() !== filters.q) update({ q: search.trim() }, { replace: true });
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => setSearch(filters.q), [filters.q]);

  const counts = summary.data?.jobs.byStatus;
  const manualQueue = counts?.MANUAL_QUEUE ?? 0;
  const overdue = summary.data?.jobs.overdue ?? 0;
  const dueSoon = summary.data?.jobs.confirmationsDueSoon ?? 0;
  const rows = jobs.data?.items ?? [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Jobs</h1>
          <p className="page-subtitle">
            {summary.data ? `${summary.data.jobs.open} open of ${summary.data.jobs.total} received` : 'Loading jobs…'}
            {jobs.dataUpdatedAt > 0 && <span className="page-subtitle__live">Updated {formatTime(jobs.dataUpdatedAt)}</span>}
          </p>
        </div>
        <Link to="/jobs/new" className="button button--primary">
          New job
        </Link>
      </div>

      <section className="panel panel--route" aria-label="Jobs by status">
        {summary.isError && !summary.data ? (
          <ErrorState error={summary.error} onRetry={summary.refetch} title="Status counts are unavailable" />
        ) : (
          <RouteLine mode="overview" counts={counts} selected={filters.status || null} onSelect={(status) => update({ status, overdue: '' })} />
        )}
      </section>

      {(manualQueue > 0 || overdue > 0 || dueSoon > 0) && (
        <div className="attention" role="status">
          {manualQueue > 0 && (
            <button type="button" className="attention__item" onClick={() => update({ status: 'MANUAL_QUEUE', overdue: '' })}>
              {manualQueue === 1 ? '1 job needs a dispatcher' : `${manualQueue} jobs need a dispatcher`} in the manual queue
            </button>
          )}
          {dueSoon > 0 && (
            <button type="button" className="attention__item" onClick={() => update({ status: 'AWAITING_CONFIRMATION', overdue: '' })}>
              {dueSoon === 1 ? '1 rider has' : `${dueSoon} riders have`} less than 15 min left to confirm
            </button>
          )}
          {overdue > 0 && (
            <button type="button" className="attention__item attention__item--late" onClick={() => update({ overdue: 'true', status: '' })}>
              {overdue === 1 ? '1 open job is past its deadline' : `${overdue} open jobs are past their deadline`}
            </button>
          )}
        </div>
      )}

      <section className="panel">
        <form className="filters" role="search" onSubmit={(e) => e.preventDefault()}>
          <label className="filters__search">
            <span className="visually-hidden">Search by order reference</span>
            <input
              className="input"
              type="search"
              placeholder="Search order, e.g. 1004"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label>
            <span className="visually-hidden">Status</span>
            <select className="input" value={filters.status} onChange={(e) => update({ status: e.target.value })}>
              <option value="">All statuses</option>
              {JOB_STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LONG_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="visually-hidden">Zone</span>
            <select className="input" value={filters.zone} onChange={(e) => update({ zone: e.target.value })}>
              <option value="">All zones</option>
              {ZONE_ORDER.map((z) => (
                <option key={z} value={z}>
                  {ZONE_LABELS[z]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="visually-hidden">Priority</span>
            <select className="input" value={filters.priority} onChange={(e) => update({ priority: e.target.value })}>
              <option value="">All priorities</option>
              {[...PRIORITY_ORDER].reverse().map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="visually-hidden">Sort</span>
            <select className="input" value={filters.sort} onChange={(e) => update({ sort: e.target.value === 'newest' ? '' : e.target.value })}>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="priority">Most urgent first</option>
            </select>
          </label>
          {active && (
            <button type="button" className="button button--quiet" onClick={() => { setSearch(''); clear(); }}>
              Clear filters
            </button>
          )}
        </form>

        {filters.overdue && (
          <p className="filter-note">
            Showing open jobs past their deadline.{' '}
            <button type="button" className="link-button" onClick={() => update({ overdue: '' })}>
              Show all
            </button>
          </p>
        )}

        {jobs.isError && jobs.data && (
          <p className="stale-warning" role="status">
            Could not refresh: {jobs.error.message} Showing the list from {formatTime(jobs.dataUpdatedAt)}.
          </p>
        )}

        {jobs.isError && !jobs.data ? (
          <ErrorState error={jobs.error} onRetry={jobs.refetch} title="Jobs could not be loaded" />
        ) : jobs.data && rows.length === 0 ? (
          active ? (
            <EmptyState
              title="No jobs match these filters"
              action={
                <button type="button" className="button" onClick={() => { setSearch(''); clear(); }}>
                  Clear filters
                </button>
              }
            />
          ) : (
            <EmptyState
              title="No jobs yet"
              action={
                <Link to="/jobs/new" className="button button--primary">
                  Create the first job
                </Link>
              }
            >
              Jobs you create appear here, newest first.
            </EmptyState>
          )
        ) : (
          <div className="table-wrap">
            <table className="table table--clickable table--stack table--jobs">
              <thead>
                <tr>
                  <th scope="col">Order</th>
                  <th scope="col">Route</th>
                  <th scope="col" className="num">
                    Load
                  </th>
                  <th scope="col">Priority</th>
                  <th scope="col">Deadline</th>
                  <th scope="col">Status</th>
                  <th scope="col">Rider</th>
                  <th scope="col">In status</th>
                </tr>
              </thead>
              <tbody aria-busy={jobs.isFetching}>
                {jobs.isPending ? (
                  <SkeletonRows columns={8} />
                ) : (
                  rows.map((job) => (
                    <tr key={job.id} onClick={() => navigate(`/jobs/${job.orderRef}`)}>
                      <td className="c-ref">
                        <Link className="order-ref" to={`/jobs/${job.orderRef}`} onClick={(e) => e.stopPropagation()}>
                          {job.orderRef}
                        </Link>
                      </td>
                      <td className="c-route">
                        <RouteText from={job.pickupZone} to={job.dropZone} />
                      </td>
                      <td className="num c-load">{job.load}</td>
                      <td className="c-priority">
                        <PriorityTag priority={job.priority} />
                      </td>
                      <td className="c-deadline">
                        <DeadlineCell job={job} />
                      </td>
                      <td className="c-status">
                        <StatusPill status={job.status} />
                      </td>
                      <td className="c-rider">
                        <RiderCell job={job} now={now} />
                      </td>
                      <td className="muted c-age">{formatDuration(job.minutesInStatus)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {jobs.data && (
          <Pagination {...jobs.data} onPageChange={(page) => update({ page })} />
        )}
      </section>
    </>
  );
}
