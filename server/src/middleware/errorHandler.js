import mongoose from 'mongoose';
import { AppError } from '../common/errors.js';
import { isDuplicateKeyError } from '../common/mongo.js';

export function notFoundHandler(req) {
  throw new AppError(404, 'ROUTE_NOT_FOUND', `No route for ${req.method} ${req.path}`);
}

/**
 * The single place where errors become HTTP responses. Every error body has the same shape:
 *   { "error": { "code": "SOME_CODE", "message": "Readable text", "details": ... } }
 *
 * Express 5 forwards errors thrown in async handlers here automatically (no try/catch needed).
 * Express recognises an error handler by its 4 parameters, so `_next` must stay.
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  const send = (status, code, message, details) => {
    res.status(status).json({ error: { code, message, ...(details !== undefined && { details }) } });
  };

  if (err instanceof AppError) return send(err.status, err.code, err.message, err.details);

  // Malformed JSON body / body too large (thrown by express.json())
  if (err?.type === 'entity.parse.failed') return send(400, 'INVALID_JSON', 'Request body is not valid JSON');
  if (err?.type === 'entity.too.large') return send(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');

  // Unique index violation that a service did not translate into a clearer error
  if (isDuplicateKeyError(err)) {
    return send(409, 'DUPLICATE_KEY', 'A record with the same unique value already exists', err.keyValue);
  }

  if (err instanceof mongoose.Error.CastError) return send(400, 'INVALID_ID', `Invalid value for ${err.path}`);
  if (err instanceof mongoose.Error.ValidationError) {
    return send(
      400,
      'VALIDATION_ERROR',
      'Request validation failed',
      Object.values(err.errors).map((e) => ({ path: e.path, message: e.message })),
    );
  }

  console.error('Unhandled error:', err);
  return send(500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.');
}
