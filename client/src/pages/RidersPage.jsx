import { useEffect, useState } from 'react';
import { useDashboardSummary, useRiders, useSetAvailability } from '../api/queries.js';
import RiderFormModal from '../components/RiderFormModal.jsx';
import { EmptyState, ErrorState, SkeletonRows } from '../components/States.jsx';
import { LoadBar, ZoneList } from '../components/Tags.jsx';
import { useToast } from '../components/Toast.jsx';
import { formatMobile } from '../lib/format.js';
import { AVAILABILITY_LABELS, AVAILABILITY_ORDER, ZONE_LABELS, ZONE_ORDER } from '../lib/labels.js';

/** Dropdown in the table row: changes the rider's availability straight away. */
function AvailabilitySelect({ rider }) {
  const toast = useToast();
  const setAvailability = useSetAvailability();

  return (
    <select
      className={`input input--compact availability-select availability-select--${rider.availability.toLowerCase()}`}
      aria-label={`Availability of ${rider.name}`}
      value={rider.availability}
      disabled={setAvailability.isPending}
      onChange={(e) =>
        setAvailability.mutate(
          { id: rider.id, availability: e.target.value },
          {
            onSuccess: (saved) => toast.success(`${saved.name} is now ${AVAILABILITY_LABELS[saved.availability].toLowerCase()}`),
            onError: (error) => toast.error(error.message),
          },
        )
      }
    >
      {AVAILABILITY_ORDER.map((a) => (
        <option key={a} value={a}>
          {AVAILABILITY_LABELS[a]}
        </option>
      ))}
    </select>
  );
}

function WorkStatus({ workload }) {
  if (workload.canTakeMoreJobs) return <span className="can-take">Can take work</span>;
  return (
    <ul className="blockers">
      {workload.blockers.map((b) => (
        <li key={b}>{b}</li>
      ))}
    </ul>
  );
}

export default function RidersPage() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [availability, setAvailability] = useState('');
  const [zone, setZone] = useState('');
  const [editing, setEditing] = useState(undefined); // undefined = closed, null = new rider, object = edit

  useEffect(() => {
    const handle = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(handle);
  }, [search]);

  const summary = useDashboardSummary();
  const riders = useRiders({ q: query, availability, zone });
  const counts = summary.data?.riders.byAvailability;
  const filtered = Boolean(query || availability || zone);
  const items = riders.data?.items ?? [];

  const clear = () => {
    setSearch('');
    setQuery('');
    setAvailability('');
    setZone('');
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Riders</h1>
          <p className="page-subtitle">
            {counts
              ? `${counts.AVAILABLE} available, ${counts.ON_BREAK} on break, ${counts.OFF_DUTY} off duty`
              : 'Loading riders…'}
          </p>
        </div>
        <button type="button" className="button button--primary" onClick={() => setEditing(null)}>
          Add rider
        </button>
      </div>

      <section className="panel">
        <form className="filters" role="search" onSubmit={(e) => e.preventDefault()}>
          <label className="filters__search">
            <span className="visually-hidden">Search by name or mobile</span>
            <input className="input" type="search" placeholder="Search name or mobile" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <label>
            <span className="visually-hidden">Availability</span>
            <select className="input" value={availability} onChange={(e) => setAvailability(e.target.value)}>
              <option value="">Any availability</option>
              {AVAILABILITY_ORDER.map((a) => (
                <option key={a} value={a}>
                  {AVAILABILITY_LABELS[a]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="visually-hidden">Zone</span>
            <select className="input" value={zone} onChange={(e) => setZone(e.target.value)}>
              <option value="">All zones</option>
              {ZONE_ORDER.map((z) => (
                <option key={z} value={z}>
                  {ZONE_LABELS[z]}
                </option>
              ))}
            </select>
          </label>
          {filtered && (
            <button type="button" className="button button--quiet" onClick={clear}>
              Clear filters
            </button>
          )}
        </form>

        {riders.isError && !riders.data ? (
          <ErrorState error={riders.error} onRetry={riders.refetch} title="Riders could not be loaded" />
        ) : riders.data && items.length === 0 ? (
          filtered ? (
            <EmptyState title="No riders match these filters" action={<button type="button" className="button" onClick={clear}>Clear filters</button>} />
          ) : (
            <EmptyState title="No riders yet" action={<button type="button" className="button button--primary" onClick={() => setEditing(null)}>Add the first rider</button>}>
              Riders you add can sign in with their mobile number.
            </EmptyState>
          )
        ) : (
          <div className="table-wrap">
            <table className="table table--stack table--riders">
              <thead>
                <tr>
                  <th scope="col">Rider</th>
                  <th scope="col">Zones</th>
                  <th scope="col">Now in</th>
                  <th scope="col">Availability</th>
                  <th scope="col">Load reserved</th>
                  <th scope="col">Jobs</th>
                  <th scope="col">Can take work?</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody aria-busy={riders.isFetching}>
                {riders.isPending ? (
                  <SkeletonRows columns={8} />
                ) : (
                  items.map((rider) => (
                    <tr key={rider.id}>
                      <td className="c-person">
                        <span className="person">
                          <span className="person__name">{rider.name}</span>
                          <span className="person__meta">{formatMobile(rider.mobile)}</span>
                        </span>
                      </td>
                      <td className="c-zones">
                        <ZoneList zones={rider.zones} />
                      </td>
                      <td className="c-now">{ZONE_LABELS[rider.currentZone]}</td>
                      <td className="c-avail">
                        <AvailabilitySelect rider={rider} />
                      </td>
                      <td className="c-load">
                        <LoadBar used={rider.reservedLoad} total={rider.capacity} label={`${rider.name}: load reserved`} />
                      </td>
                      <td className="num-left c-jobs">
                        {rider.activeJobs} of {rider.maxActiveJobs}
                      </td>
                      <td className="c-work">
                        <WorkStatus workload={rider.workload} />
                      </td>
                      <td className="actions c-actions">
                        <button type="button" className="button button--quiet button--small" onClick={() => setEditing(rider)}>
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <RiderFormModal open={editing !== undefined} rider={editing ?? null} onClose={() => setEditing(undefined)} />
    </>
  );
}
