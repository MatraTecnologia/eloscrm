import type { AxiosInstance } from 'axios'

import {
  request,
  type RequestOptions,
  type UazapiClientConfig,
} from './client.js'
import type {
  ChatDetailsParams,
  ChatDetailsResponse,
  CheckChatEntry,
  CheckChatParams,
  ListContactsPaginatedParams,
  ListContactsPaginatedResponse,
  ListContactsQuery,
  Result,
  UazapiContact,
} from './types.js'

export const createContactsApi = (
  http: AxiosInstance,
  config: UazapiClientConfig,
) => ({
  check: (
    params: CheckChatParams,
    options?: RequestOptions,
  ): Promise<Result<CheckChatEntry[]>> =>
    request<CheckChatEntry[], CheckChatParams>(http, config, {
      method: 'POST',
      path: '/chat/check',
      auth: 'token',
      body: params,
      options,
    }),

  details: (
    params: ChatDetailsParams,
    options?: RequestOptions,
  ): Promise<Result<ChatDetailsResponse>> =>
    request<ChatDetailsResponse, ChatDetailsParams>(http, config, {
      method: 'POST',
      path: '/chat/details',
      auth: 'token',
      body: params,
      options,
    }),

  list: (
    query: ListContactsQuery = {},
    options?: RequestOptions,
  ): Promise<Result<UazapiContact[]>> =>
    request<UazapiContact[]>(http, config, {
      method: 'GET',
      path: '/contacts',
      auth: 'token',
      query: { ...query },
      options,
    }),

  listPaginated: (
    params: ListContactsPaginatedParams = {},
    options?: RequestOptions,
  ): Promise<Result<ListContactsPaginatedResponse>> =>
    request<ListContactsPaginatedResponse, ListContactsPaginatedParams>(
      http,
      config,
      {
        method: 'POST',
        path: '/contacts/list',
        auth: 'token',
        body: params,
        options,
      },
    ),
})

export type UazapiContactsApi = ReturnType<typeof createContactsApi>
