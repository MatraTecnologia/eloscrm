import type { AxiosInstance } from 'axios'

import {
  request,
  type RequestOptions,
  type UazapiClientConfig,
} from './client.js'
import type {
  GetGroupInfoParams,
  ListGroupsPaginatedParams,
  ListGroupsPaginatedResponse,
  ListGroupsQuery,
  ListGroupsResponse,
  Result,
  UazapiGroup,
} from './types.js'

export const createGroupsApi = (
  http: AxiosInstance,
  config: UazapiClientConfig,
) => ({
  info: (
    params: GetGroupInfoParams,
    options?: RequestOptions,
  ): Promise<Result<UazapiGroup>> =>
    request<UazapiGroup, GetGroupInfoParams>(http, config, {
      method: 'POST',
      path: '/group/info',
      auth: 'token',
      body: params,
      options,
    }),

  list: (
    query: ListGroupsQuery = {},
    options?: RequestOptions,
  ): Promise<Result<ListGroupsResponse>> =>
    request<ListGroupsResponse>(http, config, {
      method: 'GET',
      path: '/group/list',
      auth: 'token',
      query: { ...query },
      options,
    }),

  listPaginated: (
    params: ListGroupsPaginatedParams = {},
    options?: RequestOptions,
  ): Promise<Result<ListGroupsPaginatedResponse>> =>
    request<ListGroupsPaginatedResponse, ListGroupsPaginatedParams>(
      http,
      config,
      {
        method: 'POST',
        path: '/group/list',
        auth: 'token',
        body: params,
        options,
      },
    ),
})

export type UazapiGroupsApi = ReturnType<typeof createGroupsApi>
