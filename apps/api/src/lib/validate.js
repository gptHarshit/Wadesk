import { z } from 'zod';
import { HttpError } from './errors.js';

/** Parse `data` with a zod schema, or throw a 400 with field-level messages. */
export function parse(schema, data) {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const fields = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  const first = Object.entries(fields)[0];
  const message = first ? (first[0] === '_' ? first[1] : `${first[0]}: ${first[1]}`) : 'Invalid input';
  throw new HttpError(400, 'validation_error', message, { fields });
}

export const uuid = z.string().uuid();
export const email = z.string().trim().toLowerCase().email().max(254);
export const password = z.string().min(8, 'Password must be at least 8 characters').max(200);
export const page = z.coerce.number().int().min(1).default(1);
export const limit = (max = 100, def = 25) => z.coerce.number().int().min(1).max(max).default(def);

/** Empty strings from forms become null so they clear the column. */
export const nullableText = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v === undefined ? undefined : v === null || v === '' ? null : v));

export const idParam = z.object({ id: uuid });
