/** True for a MongoDB duplicate-key error (a unique index rejected the write). */
export function isDuplicateKeyError(err) {
  return typeof err === 'object' && err !== null && err.code === 11000;
}

/** Escapes user input before it is used inside a RegExp (prevents regex injection). */
export function escapeRegex(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Removes keys whose value is undefined, so they are not sent in a $set. */
export function withoutUndefined(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined));
}
