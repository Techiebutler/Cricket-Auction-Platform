import axios from "axios";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

export const api = axios.create({
  baseURL: API_URL,
});

api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    // Only auto-redirect on 401 if a token exists (expired session).
    // Don't redirect during login/godmode/magic-code — those 401s are expected
    // and handled locally by each form.
    const authEndpoints = ["/auth/login", "/auth/godmode", "/auth/verify-magic-code", "/auth/send-magic-code"];
    const url: string = err.config?.url ?? "";
    const isAuthCall = authEndpoints.some((e) => url.includes(e));

    if (
      err.response?.status === 401 &&
      typeof window !== "undefined" &&
      !isAuthCall &&
      localStorage.getItem("token")
    ) {
      localStorage.removeItem("token");
      window.location.href = "/auth/login";
    }
    return Promise.reject(err);
  }
);

export default api;
