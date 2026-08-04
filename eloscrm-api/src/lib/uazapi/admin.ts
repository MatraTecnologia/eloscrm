import type { AxiosInstance } from 'axios'

import {
  request,
  requestWithHeaders,
  type RequestOptions,
  type UazapiClientConfig,
} from './client.js'
import type {
  CreateInstanceParams,
  CreateInstanceResponse,
  Result,
  UazapiInstance,
  UazapiWebhook,
  UpdateAdminFieldsParams,
  UpsertGlobalWebhookParams,
  WebhookErrorEntry,
  WebhookErrorsResponse,
} from './types.js'

export const createAdminApi = (http: AxiosInstance, config: UazapiClientConfig) => ({
  createInstance: (
    params: CreateInstanceParams,
    options?: RequestOptions,
  ): Promise<Result<CreateInstanceResponse>> =>
    request<CreateInstanceResponse, CreateInstanceParams>(http, config, {
      method: 'POST',
      path: '/instance/create',
      auth: 'admintoken',
      body: params,
      options,
    }),

  listInstances: (options?: RequestOptions): Promise<Result<UazapiInstance[]>> =>
    request<UazapiInstance[]>(http, config, {
      method: 'GET',
      path: '/instance/all',
      auth: 'admintoken',
      options,
    }),

  updateAdminFields: (
    params: UpdateAdminFieldsParams,
    options?: RequestOptions,
  ): Promise<Result<UazapiInstance>> =>
    request<UazapiInstance, UpdateAdminFieldsParams>(http, config, {
      method: 'POST',
      path: '/instance/updateAdminFields',
      auth: 'admintoken',
      body: params,
      options,
    }),

  getGlobalWebhook: (options?: RequestOptions): Promise<Result<UazapiWebhook>> =>
    request<UazapiWebhook>(http, config, {
      method: 'GET',
      path: '/globalwebhook',
      auth: 'admintoken',
      options,
    }),

  upsertGlobalWebhook: (
    params: UpsertGlobalWebhookParams,
    options?: RequestOptions,
  ): Promise<Result<UazapiWebhook>> =>
    request<UazapiWebhook, UpsertGlobalWebhookParams>(http, config, {
      method: 'POST',
      path: '/globalwebhook',
      auth: 'admintoken',
      body: params,
      options,
    }),

  globalWebhookErrors: async (
    options?: RequestOptions,
  ): Promise<Result<WebhookErrorsResponse>> => {
    const result = await requestWithHeaders<WebhookErrorEntry[]>(http, config, {
      method: 'GET',
      path: '/globalwebhook/errors',
      auth: 'admintoken',
      options,
    })
    if (!result.success) return result
    return {
      success: true,
      data: {
        errors: result.data.data,
        captureStartedAt: result.data.headers['x-webhook-error-capture-started-at'],
      },
    }
  },
})

export type UazapiAdminApi = ReturnType<typeof createAdminApi>
