const API_URL = import.meta.env.VITE_API_URL || '';

export const apiCall = (endpoint: string, options: RequestInit = {}) => {
  const url = `${API_URL}/api${endpoint}`;

  const token = localStorage.getItem('authToken');

  // Merge headers safely
  const headers = new Headers(options.headers);

  // Only set JSON content-type when sending a body
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  // Attach auth token if present
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return fetch(url, {
    ...options,
    headers,
  });
};
