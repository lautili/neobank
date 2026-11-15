import axios from "axios";

export const SESSION_EVENT = "neobank:session-expired";
const TOKEN_KEY = "neobank.token";
const USER_KEY = "neobank.user";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:3000/api",
  timeout: 15000,
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      clearStoredSession();
      window.dispatchEvent(new Event(SESSION_EVENT));
    }
    return Promise.reject(error);
  },
);

export function readStoredSession() {
  const token = sessionStorage.getItem(TOKEN_KEY);
  const serializedUser = sessionStorage.getItem(USER_KEY);
  if (!token || !serializedUser) {
    if (token || serializedUser) clearStoredSession();
    return null;
  }

  try {
    const user = JSON.parse(serializedUser);
    if (!user || typeof user !== "object" || Array.isArray(user)) {
      clearStoredSession();
      return null;
    }
    return { token, user };
  } catch {
    clearStoredSession();
    return null;
  }
}

export function storeSession(token, user) {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch (error) {
    clearStoredSession();
    throw new Error("No se pudo guardar la sesión en esta pestaña.", {
      cause: error,
    });
  }
}

export function clearStoredSession() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
}

export function getApiError(error) {
  if (axios.isAxiosError(error)) {
    return (
      error.response?.data?.error ||
      (error.request
        ? "No pudimos conectar con NeoBank. Revisá tu conexión e intentá de nuevo."
        : "No se pudo completar la solicitud.")
    );
  }
  return error instanceof Error
    ? error.message
    : "Ocurrió un error inesperado.";
}
