import { Errors } from './errors.js';

/**
 * Validates `data` against a Zod schema and returns the parsed (cleaned, normalised) value.
 * Throws a 400 VALIDATION_ERROR listing every problem, so the client can fix them all at once.
 *
 * Usage in a route:  const input = parse(CreateRiderSchema, req.body);
 */
export function parse(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw Errors.validation(
      result.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    );
  }
  return result.data;
}
