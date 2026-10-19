/**
 * Small fetch wrapper used by every API call.
 *  - adds the access token
 *  - turns the server's error shape { error: { code, message, details } } into an ApiError
 *  - reports an expired / invalid session once, so the app can send the user back to sign in
 */
const BASE_URL = import.meta.env.VITE_API_URL || '/api';

/** Error codes that mean "your session is no longer valid". */
const SESSION_ERRORS = new Set(['UNAUTHENTICATED', 'INVALID_TOKEN', 'TOKEN_EXPIRED', 'ACCOUNT_INACTIVE']);

let accessToken = null;
let onSessionExpired = null;

export function setAccessToken(token) {
  accessToken = token;
}

export function setSessionExpiredHandler(handler) {
  onSessionExpired = handler;
}

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function buildUrl(path, query) {
  const url = new URL(`${BASE_URL}${path}`, window.location.origin);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  }
  return url;
}

/**
 * Full response: { data, status, headers }. Use `api()` when only the body matters.
 * @param {string} path e.g. "/jobs"
 * @param {{ method?: string, body?: object, query?: object }} [options]
 */
export async function apiRequest(path, { method = 'GET', body, query } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the RELAY server. Check that the API is running, then try again.');
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const error = data?.error ?? {};
    const apiError = new ApiError(
      response.status,
      error.code ?? 'HTTP_ERROR',
      error.message ?? `The server answered with an error (${response.status}).`,
      error.details,
    );
    if (response.status === 401 && accessToken && SESSION_ERRORS.has(apiError.code)) {
      onSessionExpired?.(apiError);
    }
    throw apiError;
  }

  return { data, status: response.status, headers: response.headers };
}

/** Same as apiRequest, but returns only the response body. */
export async function api(path, options) {
  const { data } = await apiRequest(path, options);
  return data;
}

/**
 * Turns validation details [{ path: "zones.0", message }] into { zones: message },
 * so each form field can show its own error.
 */
export function fieldErrorsFrom(error) {
  if (!(error instanceof ApiError) || !Array.isArray(error.details)) return {};
  const errors = {};
  for (const { path, message } of error.details) {
    const field = String(path).split('.')[0] || 'form';
    errors[field] ??= message;
  }
  return errors;
}
