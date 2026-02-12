const raw = import.meta.env.VITE_API_URL as string | undefined;

// If VITE_API_URL is "", undefined, or accidentally set to something wrong,
// fall back to same-origin.
const API_URL = raw && raw.startsWith('http') ? raw : '';

export const apiCall = (endpoint: string, options: RequestInit = {}) => {
  const url = `${API_URL}/api${endpoint}`;

  const token = localStorage.getItem('authToken');
  const headers = new Headers(options.headers);

  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);

  return fetch(url, { ...options, headers });
};
