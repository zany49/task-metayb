/**
 * Every expected failure is thrown as an AppError. The error handler turns it into
 * the standard response shape: { error: { code, message, details? } }.
 * `code` is stable and machine-readable (the frontend can switch on it); `message` is for humans.
 */
export class AppError extends Error {
  /**
   * @param {number} status   HTTP status code
   * @param {string} code     machine-readable error code, e.g. "MOBILE_ALREADY_REGISTERED"
   * @param {string} message  human-readable message
   * @param {unknown} [details] extra data, e.g. the list of validation problems
   */
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const Errors = {
  validation: (details) => new AppError(400, 'VALIDATION_ERROR', 'Request validation failed', details),

  badRequest: (code, message, details) => new AppError(400, code, message, details),

  unauthorized: (message = 'Authentication required', code = 'UNAUTHENTICATED') =>
    new AppError(401, code, message),

  forbidden: (message = 'You do not have permission to perform this action', code = 'FORBIDDEN') =>
    new AppError(403, code, message),

  notFound: (resource) => new AppError(404, 'NOT_FOUND', `${resource} not found`),

  conflict: (code, message, details) => new AppError(409, code, message, details),

  /** The request is well-formed but breaks a business rule (e.g. the rider is not eligible). */
  unprocessable: (code, message, details) => new AppError(422, code, message, details),

  tooManyRequests: (code, message) => new AppError(429, code, message),
};
