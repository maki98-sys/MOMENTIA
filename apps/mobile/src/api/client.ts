import { env } from '../config/env';
import { tokenStore } from '../auth/token-store';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type RequestOptions = Omit<RequestInit, 'headers'> & {
  headers?: Record<string, string>;
  authenticated?: boolean;
};

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new Error('API paths must be absolute paths inside the API origin.');
  }

  const { authenticated = true, headers = {}, ...request } = options;
  const token = authenticated ? await tokenStore.get() : null;
  const response = await fetch(`${env.apiUrl}${path}`, {
    ...request,
    headers: {
      Accept: 'application/json',
      ...(request.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string; code?: string } | null;
    throw new ApiError(payload?.message ?? 'No se pudo completar la solicitud.', response.status, payload?.code);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  health: () => apiRequest<{ status: string }>('/health', { authenticated: false }),
};