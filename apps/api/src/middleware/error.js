import { HttpError } from '../lib/errors.js';
import { logger } from '../logger.js';

export function notFoundHandler(req, _res, next) {
  next(new HttpError(404, 'not_found', `No route for ${req.method} ${req.path}`));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  let status = 500;
  let code = 'internal_error';
  let message = 'Something went wrong. Please try again.';
  let details;

  if (err instanceof HttpError) {
    ({ status, code, message, details } = err);
  } else if (err?.type === 'entity.parse.failed') {
    status = 400;
    code = 'invalid_json';
    message = 'Request body is not valid JSON';
  } else if (err?.type === 'entity.too.large' || err?.code === 'LIMIT_FILE_SIZE') {
    status = 413;
    code = 'too_large';
    message = 'The file or request is too large';
  } else if (err?.name === 'MulterError') {
    status = 400;
    code = 'upload_error';
    message = err.message;
  } else if (err?.code === '23505') {
    status = 409;
    code = 'conflict';
    message = 'That already exists';
  } else if (err?.code === '23503') {
    status = 400;
    code = 'bad_reference';
    message = 'A referenced item does not exist';
  } else if (err?.code === '22P02') {
    status = 400;
    code = 'bad_request';
    message = 'Invalid identifier';
  }

  if (status >= 500) {
    (req.log ?? logger).error({ err, path: req.path, method: req.method }, 'Unhandled error');
  }
  if (res.headersSent) return;
  res.status(status).json({ error: { code, message, ...(details ? { details } : {}) } });
}
