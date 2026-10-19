import { STATUS_DESCRIPTIONS, STATUS_LABELS } from '../lib/labels.js';

/**
 * The job lifecycle drawn as a route line with stops, like a transit map.
 *
 *   overview mode (dashboard): each stop shows how many jobs are there; clicking a stop filters.
 *   job mode (one job):        shows where this job is and which stops it has passed.
 *
 * Manual queue and Cancelled are side tracks off the main line.
 */
const MAIN_LINE = ['NEW', 'READY_FOR_ASSIGNMENT', 'AWAITING_CONFIRMATION', 'ACCEPTED', 'PICKED_UP', 'DELIVERED'];
const SIDE_TRACKS = ['MANUAL_QUEUE', 'CANCELLED'];

function stopState(status, { current, visited }) {
  if (status === current) return 'current';
  if (visited?.has(status)) return 'passed';
  return 'ahead';
}

function Stop({ status, mode, count, state, selected, onSelect, attention }) {
  const label = STATUS_LABELS[status];
  const content = (
    <>
      <span className="route__dot" aria-hidden="true" />
      <span className="route__name">{label}</span>
      {mode === 'overview' && <span className="route__count">{count ?? '–'}</span>}
    </>
  );

  const className = [
    'route__stop',
    state && `route__stop--${state}`,
    selected && 'route__stop--selected',
    attention && 'route__stop--attention',
    mode === 'overview' && count === 0 && 'route__stop--empty',
  ]
    .filter(Boolean)
    .join(' ');

  if (mode === 'overview') {
    return (
      <li className={className}>
        <button
          type="button"
          className="route__target"
          aria-pressed={selected}
          title={STATUS_DESCRIPTIONS[status]}
          aria-label={`${label}: ${count ?? 0} jobs. ${selected ? 'Showing only these. Select again to show all.' : 'Show only these jobs.'}`}
          onClick={() => onSelect(selected ? null : status)}
        >
          {content}
        </button>
      </li>
    );
  }

  return (
    <li className={className} aria-current={state === 'current' ? 'step' : undefined} title={STATUS_DESCRIPTIONS[status]}>
      <span className="route__target">{content}</span>
    </li>
  );
}

/**
 * @param {object} props
 * @param {'overview'|'job'} props.mode
 * @param {Record<string, number>} [props.counts]   overview: jobs per status
 * @param {string|null} [props.selected]            overview: status currently used as a filter
 * @param {(status: string|null) => void} [props.onSelect]
 * @param {string} [props.current]                  job: the job's status
 * @param {Set<string>} [props.visited]             job: statuses the job has been in
 */
export default function RouteLine({ mode, counts, selected, onSelect, current, visited }) {
  const stopProps = (status) => ({
    status,
    mode,
    count: counts?.[status],
    state: mode === 'job' ? stopState(status, { current, visited }) : undefined,
    selected: mode === 'overview' && selected === status,
    onSelect,
    attention: status === 'MANUAL_QUEUE' && (mode === 'overview' ? counts?.MANUAL_QUEUE > 0 : current === 'MANUAL_QUEUE'),
  });

  return (
    <div className={`route route--${mode}`}>
      <ol className="route__main" aria-label="Delivery lifecycle">
        {MAIN_LINE.map((status) => (
          <Stop key={status} {...stopProps(status)} />
        ))}
      </ol>
      <ol className="route__side" aria-label="Side tracks">
        {SIDE_TRACKS.map((status) => (
          <Stop key={status} {...stopProps(status)} />
        ))}
      </ol>
    </div>
  );
}
