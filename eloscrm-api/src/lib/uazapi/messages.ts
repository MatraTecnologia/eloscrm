import type { AxiosInstance } from 'axios'

import { request, type RequestOptions, type UazapiClientConfig } from './client.js'
import type { FindMessagesParams, FindMessagesResponse, Result } from './types.js'

export const createMessagesApi = (http: AxiosInstance, config: UazapiClientConfig) => ({
  find: (
    params: FindMessagesParams = {},
    options?: RequestOptions,
  ): Promise<Result<FindMessagesResponse>> =>
    request<FindMessagesResponse, FindMessagesParams>(http, config, {
      method: 'POST',
      path: '/message/find',
      auth: 'token',
      body: params,
      options,
    }),
})

export type UazapiMessagesApi = ReturnType<typeof createMessagesApi>
