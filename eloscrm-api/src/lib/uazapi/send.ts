import type { AxiosInstance } from 'axios'

import { request, type RequestOptions, type UazapiClientConfig } from './client.js'
import type {
  Result,
  SendMediaParams,
  SendMediaResponse,
  SendPresenceParams,
  SendPresenceResponse,
  SendTextParams,
  SendTextResponse,
} from './types.js'

export const createSendApi = (http: AxiosInstance, config: UazapiClientConfig) => ({
  text: (params: SendTextParams, options?: RequestOptions): Promise<Result<SendTextResponse>> =>
    request<SendTextResponse, SendTextParams>(http, config, {
      method: 'POST',
      path: '/send/text',
      auth: 'token',
      body: params,
      options,
    }),

  media: (params: SendMediaParams, options?: RequestOptions): Promise<Result<SendMediaResponse>> =>
    request<SendMediaResponse, SendMediaParams>(http, config, {
      method: 'POST',
      path: '/send/media',
      auth: 'token',
      body: params,
      options,
    }),

  presence: (
    params: SendPresenceParams,
    options?: RequestOptions,
  ): Promise<Result<SendPresenceResponse>> =>
    request<SendPresenceResponse, SendPresenceParams>(http, config, {
      method: 'POST',
      path: '/message/presence',
      auth: 'token',
      body: params,
      options,
    }),
})

export type UazapiSendApi = ReturnType<typeof createSendApi>
