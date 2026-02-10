const API_URL = '';

export const apiCall = (endpoint: string, options: RequestInit = {}) => {
  return fetch(`${API_URL}/api${endpoint}`, {
    credentials: 'include',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
};
