import {
  AVAILABILITY_LABELS,
  PRIORITY_LABELS,
  STATUS_DESCRIPTIONS,
  STATUS_LABELS,
  zoneLabel,
} from '../lib/labels.js';

export function StatusPill({ status }) {
  return (
    <span className={`pill pill--${status.toLowerCase()}`} title={STATUS_DESCRIPTIONS[status]}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

const PRIORITY_BARS = { LOW: 1, NORMAL: 2, HIGH: 3, URGENT: 4 };

/** Priority as a word plus 1-4 bars, so urgency reads at a glance without relying on colour. */
export function PriorityTag({ priority }) {
  const level = PRIORITY_BARS[priority] ?? 0;
  return (
    <span className={`priority priority--${priority.toLowerCase()}`}>
      <span className="priority__bars" aria-hidden="true">
        {[1, 2, 3, 4].map((bar) => (
          <i key={bar} className={bar <= level ? 'is-on' : undefined} />
        ))}
      </span>
      {PRIORITY_LABELS[priority] ?? priority}
    </span>
  );
}

export function AvailabilityTag({ availability }) {
  return (
    <span className={`availability availability--${availability.toLowerCase()}`}>
      {AVAILABILITY_LABELS[availability] ?? availability}
    </span>
  );
}

/** "Central → North" (or just "East" when pickup and drop are the same zone). */
export function RouteText({ from, to }) {
  if (from === to) return <span className="route-text">{zoneLabel(from)}</span>;
  return (
    <span className="route-text">
      {zoneLabel(from)}
      <span className="route-text__arrow" aria-label="to">
        →
      </span>
      {zoneLabel(to)}
    </span>
  );
}

export function ZoneList({ zones }) {
  return (
    <span className="zone-list">
      {zones.map((zone) => (
        <span key={zone} className="zone">
          {zoneLabel(zone)}
        </span>
      ))}
    </span>
  );
}

/** Filled bar: how much of the rider's capacity is reserved. */
export function LoadBar({ used, total, label }) {
  const percent = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  return (
    <span className="loadbar">
      <span className="loadbar__track" role="meter" aria-valuemin={0} aria-valuemax={total} aria-valuenow={used} aria-label={label}>
        <span className="loadbar__fill" style={{ width: `${percent}%` }} />
      </span>
      <span className="loadbar__text">
        {used} of {total}
      </span>
    </span>
  );
}
