import axios from 'axios';

declare global {
  interface Window {
    ToastBossConfig?: {
      apiBaseUrl?: string;
    };
  }
}

const baseURL =
  window.ToastBossConfig?.apiBaseUrl ??
  import.meta.env.VITE_API_BASE_URL ??
  'https://toastboss-backend.onrender.com/api';

export const apiClient = axios.create({
  baseURL,
  headers: {
    'Content-Type': 'application/json',
  },
});
