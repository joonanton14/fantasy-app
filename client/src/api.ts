// API configuration - uses environment variable or defaults to relative path for local development
const API_URL = import.meta.env.VITE_API_URL || '';

export const apiCall = async (endpoint: string, options?: RequestInit) => {
  const url = `${API_URL}/api${endpoint}`;
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
};

export default API_URL;
