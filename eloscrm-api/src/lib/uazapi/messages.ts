import type { AxiosInstance } from 'axios'

import { request, type RequestOptions, type UazapiClientConfig } from './client.js'
import type {
  DownloadMessageParams,
  DownloadMessageResponse,
  FindMessagesParams,
  FindMessagesResponse,
  ReactToMessageParams,
  ReactToMessageResponse,
  Result,
} from './types.js'

export const createMessagesApi = (http: AxiosInstance, config: UazapiClientConfig) => ({
  download: (
    params: DownloadMessageParams,
    options?: RequestOptions,
  ): Promise<Result<DownloadMessageResponse>> =>
    request<DownloadMessageResponse, DownloadMessageParams>(http, config, {
      method: 'POST',
      path: '/message/download',
      auth: 'token',
      body: params,
      options,
    }),

  /** `text` vazio remove a reação — é assim que a uazapi modela o "desreagir". */
  react: (
    params: ReactToMessageParams,
    options?: RequestOptions,
  ): Promise<Result<ReactToMessageResponse>> =>
    request<ReactToMessageResponse, ReactToMessageParams>(http, config, {
      method: 'POST',
      path: '/message/react',
      auth: 'token',
      body: params,
      options,
    }),

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
