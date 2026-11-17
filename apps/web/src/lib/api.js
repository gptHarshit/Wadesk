/**
 * API client. The short-lived access token lives in memory only; the refresh
 * token is an httpOnly cookie the browser sends to /api/auth/refresh. When a
 * request comes back 401 we refresh once and retry, so pages never have to
 * think about token expiry.
 */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000').replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'error', details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let accessToken = null;
let refreshing = null;
let onSessionLost = () => {};

export const getAccessToken = () => accessToken;
export const setAccessToken = (token) => {
  accessToken = token || null;
};
export const setSessionLostHandler = (fn) => {
  onSessionLost = fn;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function parse(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function requestRefresh() {
  const res = await fetch(`${API_URL}/api/auth/refresh`, { method: 'POST', credentials: 'include' });
  return res.ok ? parse(res) : null;
}

/**
 * Exchange the refresh cookie for a new session. Calls made at the same time
 * share one request. If another browser tab refreshed a moment ago our cookie
 * was just rotated, so one retry picks up the new one.
 */
export function refreshSession() {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        let session = await requestRefresh();
        if (!session) {
          await sleep(400);
          session = await requestRefresh();
        }
        setAccessToken(session?.accessToken ?? null);
        return session;
      } catch {
        return null;
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

function buildUrl(path, query) {
  const url = new URL(`${API_URL}/api${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return url;
}

/**
 * Call the API. `body` is sent as JSON, `form` as multipart. Returns parsed
 * JSON, or a Blob when `blob: true`. Throws ApiError with the server's message.
 */
export async function api(path, { method = 'GET', body, form, query, blob = false, retry = true } = {}) {
  const headers = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: payload,
      // Needed so the browser stores the refresh cookie whenever the server rotates it.
      credentials: 'include',
    });
  } catch {
    throw new ApiError('Could not reach the server. Check your connection and try again.', { code: 'network' });
  }

  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    const session = await refreshSession();
    if (session) return api(path, { method, body, form, query, blob, retry: false });
    onSessionLost();
    throw new ApiError('Your session has expired. Please sign in again.', { status: 401, code: 'unauthorized' });
  }

  if (!res.ok) {
    const data = await parse(res);
    throw new ApiError(data?.error?.message || `Request failed (${res.status})`, {
      status: res.status,
      code: data?.error?.code,
      details: data?.error?.details,
    });
  }
  return blob ? res.blob() : parse(res);
}
