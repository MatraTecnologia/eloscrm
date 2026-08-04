import { env } from '../../env.js'

import { createAdminApi, type UazapiAdminApi } from './admin.js'
import { createHttp, type UazapiClientConfig } from './client.js'
import { createContactsApi, type UazapiContactsApi } from './contacts.js'
import { createGroupsApi, type UazapiGroupsApi } from './groups.js'
import { createInstanceApi, type UazapiInstanceApi } from './instance.js'
import { createMessagesApi, type UazapiMessagesApi } from './messages.js'
import { createProxyApi, type UazapiProxyApi } from './proxy.js'
import { createSendApi, type UazapiSendApi } from './send.js'
import { createWebhookApi, type UazapiWebhookApi } from './webhook.js'

export interface UazapiClient {
  admin: UazapiAdminApi
  instance: UazapiInstanceApi
  webhook: UazapiWebhookApi
  send: UazapiSendApi
  messages: UazapiMessagesApi
  proxy: UazapiProxyApi
  contacts: UazapiContactsApi
  groups: UazapiGroupsApi
  withInstance: (token: string) => UazapiClient
  withAdminToken: (adminToken: string) => UazapiClient
}

export const createUazapiClient = (
  config: UazapiClientConfig,
): UazapiClient => {
  const http = createHttp(config)

  const build = (overrides: Partial<UazapiClientConfig>): UazapiClient => {
    const merged: UazapiClientConfig = { ...config, ...overrides }
    return {
      admin: createAdminApi(http, merged),
      instance: createInstanceApi(http, merged),
      webhook: createWebhookApi(http, merged),
      send: createSendApi(http, merged),
      messages: createMessagesApi(http, merged),
      proxy: createProxyApi(http, merged),
      contacts: createContactsApi(http, merged),
      groups: createGroupsApi(http, merged),
      withInstance: token => build({ ...overrides, token }),
      withAdminToken: adminToken => build({ ...overrides, adminToken }),
    }
  }

  return build({})
}

let _client: UazapiClient | null = null

export const uazapi = (): UazapiClient => {
  if (!_client) {
    if (!env.UAZAPI_BASE_URL) {
      throw new Error('uazapi: UAZAPI_BASE_URL não configurada no env')
    }
    _client = createUazapiClient({
      baseURL: env.UAZAPI_BASE_URL,
      adminToken: env.UAZAPI_ADMIN_TOKEN,
    })
  }
  return _client
}

export type { UazapiClientConfig, RequestOptions } from './client.js'
export type { UazapiAdminApi } from './admin.js'
export type { UazapiInstanceApi } from './instance.js'
export type { UazapiWebhookApi } from './webhook.js'
export type { UazapiSendApi } from './send.js'
export type { UazapiMessagesApi } from './messages.js'
export type { UazapiProxyApi } from './proxy.js'
export type { UazapiContactsApi } from './contacts.js'
export type { UazapiGroupsApi } from './groups.js'
export * from './types.js'
