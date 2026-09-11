// Thin fetch wrapper for the RuSmartOpt API.
// credentials:'include' sends the httpOnly session cookie; the custom header
// is required by the backend's CSRF check on state-changing requests (see
// src/middleware/auth.ts requireCsrfHeader) — a cross-site <form> POST cannot
// set it, but this wrapper always does.
//
// API_BASE defaults to '' (relative, same-origin) because this file is now
// served BY the Express app itself (see src/app.ts's static serving) at
// whatever domain the backend runs on — dev and prod alike, one process, one
// origin, no cross-origin CORS dance for the SPA's own requests. Only set
// window.RSO_API_BASE explicitly if you're deliberately running the SPA on a
// different origin than the API it talks to (e.g. serving this file via a
// separate static host for some reason) — not the normal path anymore.
const API_BASE = window.RSO_API_BASE || '';

async function apiRequest(method, path, body) {
  const res = await fetch(API_BASE + path, {
    method,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'rso-frontend',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body, e.g. 204 */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Ошибка запроса (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const api = {
  get: (path) => apiRequest('GET', path),
  post: (path, body) => apiRequest('POST', path, body),
  patch: (path, body) => apiRequest('PATCH', path, body),
  delete: (path) => apiRequest('DELETE', path),
};
