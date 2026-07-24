import axios from "axios";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333";

export const api = axios.create({
  baseURL: `${API_URL}/v1`,
  withCredentials: true,
});

export type ApiError = { code: string; message: string; details?: unknown };

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (typeof window !== "undefined" && error.response?.status === 401) {
      if (!window.location.pathname.startsWith("/login")) {
        window.location.assign("/login");
      }
    }
    const envelope = error.response?.data?.error as ApiError | undefined;
    return Promise.reject(envelope ?? { code: "NETWORK", message: "Falha de conexão com o servidor" });
  },
);
