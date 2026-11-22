/**
 * One error envelope for the whole API — see `.project/CONTRACT.md` §4:
 *
 *   { "error": { "code": "STRING_CODE", "message": "human readable" } }
 *
 * Every route answers with `sendError()` on failure, so the client only ever
 * has to read one shape.
 */

export const ERROR_STATUS = {
  VALIDATION: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  INVALID_ID: 404,
  ACTIVE_REQUEST_EXISTS: 409,
  INVALID_TRANSITION: 409,
  ALREADY_PAID: 409,
  SERVER_ERROR: 500,
};

/**
 * Send the shared error envelope.
 * @param {import("express").Response} res
 * @param {keyof typeof ERROR_STATUS} code
 * @param {string} message short, human-readable, safe to show in a toast
 */
export function sendError(res, code, message) {
  const status = ERROR_STATUS[code] ?? 500;
  return res.status(status).json({ error: { code, message } });
}
