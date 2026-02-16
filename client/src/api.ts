const API_URL = import.meta.env.VITE_API_URL || '';

export const apiCall = (endpoint: string, options?: RequestInit) => {
  const url = `${API_URL}/api${endpoint}`;

  return fetch(url, {
    credentials: "include", // ✅ send HttpOnly cookie
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
};
