/**
 * Simulated service zones and travel times (no GPS integration needed for this exercise).
 * Travel time between two zones is a fixed number of minutes; the matrix is symmetric.
 */
export const ZONES = ['CENTRAL', 'NORTH', 'SOUTH', 'EAST', 'WEST'];

export const ZONE_LABELS = {
  CENTRAL: 'Central',
  NORTH: 'North',
  SOUTH: 'South',
  EAST: 'East',
  WEST: 'West',
};

const TRAVEL_MINUTES = {
  CENTRAL: { CENTRAL: 8, NORTH: 15, SOUTH: 15, EAST: 12, WEST: 12 },
  NORTH: { CENTRAL: 15, NORTH: 8, SOUTH: 30, EAST: 20, WEST: 20 },
  SOUTH: { CENTRAL: 15, NORTH: 30, SOUTH: 8, EAST: 20, WEST: 22 },
  EAST: { CENTRAL: 12, NORTH: 20, SOUTH: 20, EAST: 8, WEST: 25 },
  WEST: { CENTRAL: 12, NORTH: 20, SOUTH: 22, EAST: 25, WEST: 8 },
};

/** Minutes to travel from one zone to another, e.g. travelMinutes('NORTH', 'SOUTH') === 30. */
export function travelMinutes(from, to) {
  return TRAVEL_MINUTES[from][to];
}

export function travelMatrix() {
  return TRAVEL_MINUTES;
}
