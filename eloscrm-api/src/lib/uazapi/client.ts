import axios, {
  AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
} from 'axios'

import type { Result, UazapiErrorPayload } from './types.js'

export interface UazapiTraceEntry {
  direction: 'request' | 'response' | 'error'
  method?: string
  path?: string
  status?: number
  body?: unknown
}

export interface UazapiClientConfig {
  baseURL: string
  adminToken?: string
  token?: string
  timeoutMs?: number
  headers?: Record<string, string>
  onTrace?: (entry: UazapiTraceEntry) => void
}

export interface RequestOptions {
  token?: string
  adminToken?: string
  signal?: AbortSignal
  headers?: Record<string, string>
}

const DEFAULT_TIMEOUT_MS = 30_000

const normalizeBaseURL = (baseURL: string): string =>
  baseURL.replace(/\/+$/, '')

export const createHttp = (config: UazapiClientConfig): AxiosInstance => {
  if (!config.baseURL?.trim()) {
    throw new Error('uazapi: baseURL é obrigatório')
  }

  const http = axios.create({
    baseURL: normalizeBaseURL(config.baseURL),
    timeout: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...config.headers,
    },
  })

  const trace = config.onTrace
  if (trace) {
    http.interceptors.request.use(req => {
      trace({
        direction: 'request',
        method: req.method?.toUpperCase(),
        path: req.url,
        body: req.data,
      })
      return req
    })
    http.interceptors.response.use(
      res => {
        trace({
          direction: 'response',
          method: res.config.method?.toUpperCase(),
          path: res.config.url,
          status: res.status,
          body: res.data,
        })
        return res
      },
      (error: unknown) => {
        const err = error instanceof AxiosError ? error : null
        trace({
          direction: 'error',
          method: err?.config?.method?.toUpperCase(),
          path: err?.config?.url,
          status: err?.response?.status ?? 0,
          body: err?.response?.data ?? { message: (error as Error)?.message },
        })
        return Promise.reject(error)
      },
    )
  }

  return http
}

const buildAuthHeaders = (
  auth: 'token' | 'admintoken',
  cfg: UazapiClientConfig,
  opts: RequestOptions | undefined,
): Record<string, string> => {
  if (auth === 'admintoken') {
    const adminToken = opts?.adminToken ?? cfg.adminToken
    if (!adminToken) {
      throw new Error('uazapi: admintoken não informado para este endpoint')
    }
    return { admintoken: adminToken }
  }

  const token = opts?.token ?? cfg.token
  if (!token) {
    throw new Error(
      'uazapi: token de instância não informado para este endpoint',
    )
  }
  return { token }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const normalizeError = (error: unknown): UazapiErrorPayload => {
  if (error instanceof AxiosError) {
    const status = error.response?.status ?? 0
    const body = error.response?.data
    const code = error.code

    if (!error.response) {
      return {
        status,
        error: error.message || 'network error',
        error_source: code === 'ECONNABORTED' ? 'timeout' : 'network',
        raw: { code },
      }
    }

    if (isObject(body)) {
      const payload: UazapiErrorPayload = {
        status,
        error:
          (typeof body.error === 'string' && body.error) ||
          (typeof body.message === 'string' && body.message) ||
          error.message,
        raw: body,
      }
      if (typeof body.error_source === 'string') {
        payload.error_source =
          body.error_source as UazapiErrorPayload['error_source']
      }
      if (typeof body.error_key === 'string') payload.error_key = body.error_key
      if (typeof body.provider === 'string') payload.provider = body.provider
      if (typeof body.provider_code === 'number')
        payload.provider_code = body.provider_code
      if (typeof body.provider_message === 'string')
        payload.provider_message = body.provider_message
      if (typeof body.provider_message_ptbr === 'string')
        payload.provider_message_ptbr = body.provider_message_ptbr
      if (typeof body.message === 'string') payload.message = body.message
      if (typeof body.message_ptbr === 'string')
        payload.message_ptbr = body.message_ptbr
      if (typeof body.diagnostics_endpoint === 'string')
        payload.diagnostics_endpoint = body.diagnostics_endpoint
      if (isObject(body.details)) {
        payload.details = body.details as UazapiErrorPayload['details']
      }
      return payload
    }

    return {
      status,
      error: typeof body === 'string' ? body : error.message,
      error_source: 'api',
      raw: body,
    }
  }

  return {
    status: 0,
    error: error instanceof Error ? error.message : String(error),
    error_source: 'unknown',
    raw: error,
  }
}

export interface DoRequestArgs<TBody> {
  method: 'GET' | 'POST' | 'DELETE' | 'PUT' | 'PATCH'
  path: string
  auth: 'token' | 'admintoken'
  body?: TBody
  query?: Record<string, string | number | boolean | undefined>
  options?: RequestOptions
}

const buildRequestConfig = <TBody>(
  config: UazapiClientConfig,
  args: DoRequestArgs<TBody>,
): AxiosRequestConfig => {
  const headers = buildAuthHeaders(args.auth, config, args.options)
  const reqConfig: AxiosRequestConfig = {
    method: args.method,
    url: args.path,
    headers: { ...headers, ...args.options?.headers },
    signal: args.options?.signal,
  }
  if (args.body !== undefined) reqConfig.data = args.body
  if (args.query) {
    const params: Record<string, string | number | boolean> = {}
    for (const [key, value] of Object.entries(args.query)) {
      if (value !== undefined) params[key] = value
    }
    reqConfig.params = params
  }
  return reqConfig
}

export const request = async <TResponse, TBody = unknown>(
  http: AxiosInstance,
  config: UazapiClientConfig,
  args: DoRequestArgs<TBody>,
): Promise<Result<TResponse>> => {
  try {
    const response = await http.request<TResponse>(
      buildRequestConfig(config, args),
    )
    return { success: true, data: response.data }
  } catch (error) {
    return { success: false, error: normalizeError(error) }
  }
}

export interface RequestWithHeadersResult<T> {
  data: T
  headers: Record<string, string>
}

export const requestWithHeaders = async <TResponse, TBody = unknown>(
  http: AxiosInstance,
  config: UazapiClientConfig,
  args: DoRequestArgs<TBody>,
): Promise<Result<RequestWithHeadersResult<TResponse>>> => {
  try {
    const response = await http.request<TResponse>(
      buildRequestConfig(config, args),
    )
    const normalizedHeaders: Record<string, string> = {}
    for (const [key, value] of Object.entries(response.headers ?? {})) {
      if (typeof value === 'string')
        normalizedHeaders[key.toLowerCase()] = value
    }
    return {
      success: true,
      data: { data: response.data, headers: normalizedHeaders },
    }
  } catch (error) {
    return { success: false, error: normalizeError(error) }
  }
}
