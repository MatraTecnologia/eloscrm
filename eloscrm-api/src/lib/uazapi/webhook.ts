import type { AxiosInstance } from 'axios'

import {
  request,
  requestWithHeaders,
  type RequestOptions,
  type UazapiClientConfig,
} from './client.js'
import type {
  Result,
  UazapiWebhook,
  UpsertWebhookParams,
  WebhookErrorEntry,
  WebhookErrorsResponse,
} from './types.js'

export const createWebhookApi = (
  http: AxiosInstance,
  config: UazapiClientConfig,
) => ({
  get: (options?: RequestOptions): Promise<Result<UazapiWebhook[]>> =>
    request<UazapiWebhook[]>(http, config, {
      method: 'GET',
      path: '/webhook',
      auth: 'token',
      options,
    }),

  upsert: (
    params: UpsertWebhookParams,
    options?: RequestOptions,
  ): Promise<Result<UazapiWebhook[]>> =>
    request<UazapiWebhook[], UpsertWebhookParams>(http, config, {
      method: 'POST',
      path: '/webhook',
      auth: 'token',
      body: params,
      options,
    }),

  delete: (
    id: string,
    options?: RequestOptions,
  ): Promise<Result<UazapiWebhook[]>> =>
    request<UazapiWebhook[], { action: 'delete'; id: string }>(http, config, {
      method: 'POST',
      path: '/webhook',
      auth: 'token',
      body: { action: 'delete', id },
      options,
    }),

  errors: async (
    options?: RequestOptions,
  ): Promise<Result<WebhookErrorsResponse>> => {
    const result = await requestWithHeaders<WebhookErrorEntry[]>(http, config, {
      method: 'GET',
      path: '/webhook/errors',
      auth: 'token',
      options,
    })
    if (!result.success) return result
    return {
      success: true,
      data: {
        errors: result.data.data,
        captureStartedAt:
          result.data.headers['x-webhook-error-capture-started-at'],
      },
    }
  },
})

export type UazapiWebhookApi = ReturnType<typeof createWebhookApi>
