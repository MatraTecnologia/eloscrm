import type { AxiosInstance } from 'axios'

import {
  request,
  type RequestOptions,
  type UazapiClientConfig,
} from './client.js'
import type {
  ListProxyCitiesParams,
  ListProxyCitiesResponse,
  ProxyConfig,
  Result,
  UpdateProxyParams,
  UpdateProxyResponse,
} from './types.js'

export const createProxyApi = (
  http: AxiosInstance,
  config: UazapiClientConfig,
) => ({
  listCities: (
    params: ListProxyCitiesParams = {},
    options?: RequestOptions,
  ): Promise<Result<ListProxyCitiesResponse>> =>
    request<ListProxyCitiesResponse>(http, config, {
      method: 'GET',
      path: '/proxy-managed/cities',
      auth: 'token',
      query: { ...params },
      options,
    }),

  get: (options?: RequestOptions): Promise<Result<ProxyConfig>> =>
    request<ProxyConfig>(http, config, {
      method: 'GET',
      path: '/instance/proxy',
      auth: 'token',
      options,
    }),

  update: (
    params: UpdateProxyParams,
    options?: RequestOptions,
  ): Promise<Result<UpdateProxyResponse>> =>
    request<UpdateProxyResponse, UpdateProxyParams>(http, config, {
      method: 'POST',
      path: '/instance/proxy',
      auth: 'token',
      body: params,
      options,
    }),
})

export type UazapiProxyApi = ReturnType<typeof createProxyApi>
