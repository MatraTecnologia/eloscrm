import type { AxiosInstance } from 'axios'

import { request, type RequestOptions, type UazapiClientConfig } from './client.js'
import type {
  ConnectInstanceParams,
  ConnectInstanceResponse,
  DeleteInstanceResponse,
  DisconnectInstanceResponse,
  InstanceStatusResponse,
  ResetInstanceResponse,
  Result,
  UazapiInstance,
  UpdateInstanceNameParams,
  WaMessagesLimitsResponse,
} from './types.js'

export const createInstanceApi = (http: AxiosInstance, config: UazapiClientConfig) => ({
  connect: (
    params: ConnectInstanceParams = {},
    options?: RequestOptions,
  ): Promise<Result<ConnectInstanceResponse>> =>
    request<ConnectInstanceResponse, ConnectInstanceParams>(http, config, {
      method: 'POST',
      path: '/instance/connect',
      auth: 'token',
      body: params,
      options,
    }),

  disconnect: (options?: RequestOptions): Promise<Result<DisconnectInstanceResponse>> =>
    request<DisconnectInstanceResponse>(http, config, {
      method: 'POST',
      path: '/instance/disconnect',
      auth: 'token',
      options,
    }),

  reset: (options?: RequestOptions): Promise<Result<ResetInstanceResponse>> =>
    request<ResetInstanceResponse>(http, config, {
      method: 'POST',
      path: '/instance/reset',
      auth: 'token',
      options,
    }),

  status: (options?: RequestOptions): Promise<Result<InstanceStatusResponse>> =>
    request<InstanceStatusResponse>(http, config, {
      method: 'GET',
      path: '/instance/status',
      auth: 'token',
      options,
    }),

  waMessagesLimits: (options?: RequestOptions): Promise<Result<WaMessagesLimitsResponse>> =>
    request<WaMessagesLimitsResponse>(http, config, {
      method: 'GET',
      path: '/instance/wa_messages_limits',
      auth: 'token',
      options,
    }),

  updateName: (
    params: UpdateInstanceNameParams,
    options?: RequestOptions,
  ): Promise<Result<UazapiInstance>> =>
    request<UazapiInstance, UpdateInstanceNameParams>(http, config, {
      method: 'POST',
      path: '/instance/updateInstanceName',
      auth: 'token',
      body: params,
      options,
    }),

  delete: (options?: RequestOptions): Promise<Result<DeleteInstanceResponse>> =>
    request<DeleteInstanceResponse>(http, config, {
      method: 'DELETE',
      path: '/instance',
      auth: 'token',
      options,
    }),
})

export type UazapiInstanceApi = ReturnType<typeof createInstanceApi>
