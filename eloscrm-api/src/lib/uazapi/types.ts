export type InstanceStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'hibernated'

export type WebhookEvent =
  | 'connection'
  | 'history'
  | 'messages'
  | 'messages_update'
  | 'newsletter_messages'
  | 'call'
  | 'contacts'
  | 'presence'
  | 'groups'
  | 'labels'
  | 'chats'
  | 'chat_labels'
  | 'blocks'
  | 'sender'

export type WebhookExcludeFilter =
  | 'wasSentByApi'
  | 'wasNotSentByApi'
  | 'fromMeYes'
  | 'fromMeNo'
  | 'isGroupYes'
  | 'isGroupNo'

export type WebhookAction = 'add' | 'update' | 'delete'

export type ConnectBrowser = 'auto' | 'safari' | 'firefox' | 'edge' | 'chrome'

export type MediaType =
  | 'image'
  | 'video'
  | 'videoplay'
  | 'document'
  | 'audio'
  | 'myaudio'
  | 'ptt'
  | 'ptv'
  | 'sticker'

export type PresenceType = 'composing' | 'recording' | 'paused'

export type MessageStatus =
  | 'Queued'
  | 'Canceled'
  | 'Failed'
  | 'Sent'
  | 'Delivered'
  | 'Read'
  | (string & {})

export interface UazapiInstance {
  id: string
  token: string
  status: InstanceStatus | (string & {})
  paircode?: string
  qrcode?: string
  name: string
  profileName?: string
  profilePicUrl?: string
  isBusiness?: boolean
  plataform?: string
  systemName?: string
  owner?: string
  current_presence?: 'available' | 'unavailable'
  lastDisconnect?: string
  lastDisconnectReason?: string
  adminField01?: string
  adminField02?: string
  openai_apikey?: string
  chatbot_enabled?: boolean
  chatbot_ignoreGroups?: boolean
  chatbot_stopConversation?: string
  chatbot_stopMinutes?: number
  chatbot_stopWhenYouSendMsg?: number
  fieldsMap?: Record<string, unknown>
  currentTime?: string
  created?: string
  updated?: string
}

export interface UazapiWebhook {
  id: string
  enabled: boolean
  url: string
  events: WebhookEvent[]
  excludeMessages?: WebhookExcludeFilter[]
  addUrlEvents?: boolean
  addUrlTypesMessages?: boolean
}

export interface UazapiMessage {
  id: string
  messageid?: string
  chatid?: string
  sender?: string
  senderName?: string
  isGroup?: boolean
  fromMe?: boolean
  messageType?: string
  source?: string
  messageTimestamp?: number
  status?: MessageStatus
  text?: string
  quoted?: string
  edited?: string
  reaction?: string
  vote?: string
  convertOptions?: string
  buttonOrListid?: string
  owner?: string
  error?: string
  content?: Record<string, unknown> | string
  wasSentByApi?: boolean
  sendFunction?: string
  sendPayload?: Record<string, unknown> | string
  fileURL?: string
  send_folder_id?: string
  track_source?: string
  track_id?: string
  sender_pn?: string
  sender_lid?: string
}

export interface UazapiJid {
  agent?: number
  device?: number
  server?: string
  user?: string
}

export interface CreateInstanceParams {
  name: string
  adminField01?: string
  adminField02?: string
}

export interface CreateInstanceResponse {
  connected: boolean
  info: string
  instance: UazapiInstance
  loggedIn: boolean
  name: string
  response: string
  token: string
}

export interface UpdateAdminFieldsParams {
  id: string
  adminField01?: string
  adminField02?: string
}

export interface ConnectInstanceParams {
  phone?: string
  browser?: ConnectBrowser
  systemName?: string
  proxy_managed_country?: string
  proxy_managed_state?: string
  proxy_managed_city?: string
}

export interface ConnectInstanceResponse {
  connected: boolean
  instance: UazapiInstance
  jid: UazapiJid | null
  loggedIn: boolean
}

export interface DisconnectInstanceResponse {
  info: string
  instance: UazapiInstance
  response: string
}

export interface ResetInstanceResponse {
  instanceId: string
  queuedRecoveryAttempted: boolean
  resetting: boolean
  response: string
}

export interface InstanceStatusResponse {
  instance: UazapiInstance
  status: {
    connected: boolean
    jid: UazapiJid | null
    loggedIn: boolean
  }
}

export interface DeleteInstanceResponse {
  info: string
  response: string
}

export interface UpdateInstanceNameParams {
  name: string
}

export interface WaMessagesLimitsResponse {
  can_send_new_messages: boolean | null
  diagnostics_endpoint: string
  error_key?: string
  message: string
  message_ptbr: string
  new_chat_message_capping?: {
    available: boolean
    cycle_end?: string
    cycle_start?: string
    lookup_error?: string
    mv_status?: string
    ote_status?: string
    server_sent_at?: string
    status?: 'NONE' | 'CAPPED' | (string & {})
    total_quota?: number
    used_quota?: number
  }
  provider: string
  provider_message?: string
  provider_message_ptbr?: string
  reachable: boolean
  reachout_timelock?: {
    active: boolean
    available: boolean
    enforcement_type?: string
    lookup_error?: string
    until?: string
  }
}

export interface UpsertWebhookParams {
  url: string
  enabled?: boolean
  events?: WebhookEvent[]
  excludeMessages?: WebhookExcludeFilter[]
  addUrlEvents?: boolean
  addUrlTypesMessages?: boolean
  action?: WebhookAction
  id?: string
}

export interface WebhookErrorEntry {
  attempts: number
  created: string
  error: string
  event: string
  message_type?: string
  payload: Record<string, unknown>
  status_code?: number
  type: string
  url: string
}

export interface WebhookErrorsResponse {
  errors: WebhookErrorEntry[]
  captureStartedAt?: string
}

export interface CommonSendOptions {
  delay?: number
  readchat?: boolean
  readmessages?: boolean
  replyid?: string
  viewOnce?: boolean
  mentions?: string
  forward?: boolean
  track_source?: string
  track_id?: string
  async?: boolean
}

export interface SendTextParams extends CommonSendOptions {
  number: string
  text: string
  linkPreview?: boolean
  linkPreviewTitle?: string
  linkPreviewDescription?: string
  linkPreviewImage?: string
  linkPreviewLarge?: boolean
}

export interface SendMediaParams extends CommonSendOptions {
  number: string
  type: MediaType
  file: string
  text?: string
  docName?: string
  mimetype?: string
  thumbnail?: string
}

export interface SendPresenceParams {
  number: string
  presence: PresenceType
  delay?: number
}

export interface SendTextResponse extends UazapiMessage {
  response?: {
    message: string
    status: string
  }
}

export interface SendMediaResponse extends UazapiMessage {
  response?: {
    fileUrl?: string
    message: string
    status: string
  }
}

export interface SendPresenceResponse {
  response: string
}

export type UazapiErrorSource =
  | 'whatsapp_server'
  | 'api'
  | 'network'
  | 'timeout'
  | 'unknown'

export interface UazapiErrorPayload {
  status: number
  error: string
  error_source?: UazapiErrorSource
  error_key?: string
  provider?: string
  provider_code?: number
  provider_message?: string
  provider_message_ptbr?: string
  message?: string
  message_ptbr?: string
  diagnostics_endpoint?: string
  details?: {
    new_chat_message_capping?: Record<string, unknown>
    reachout_timelock?: Record<string, unknown>
  }
  raw?: unknown
}

export interface FindMessagesParams {
  id?: string
  chatid?: string
  track_source?: string
  track_id?: string
  limit?: number
  offset?: number
}

export interface FindMessagesResponse {
  hasMore: boolean
  limit: number
  offset: number
  nextOffset: number
  returnedMessages: number
  messages: UazapiMessage[]
}

export type ProxyMode = 'custom' | 'internal' | 'none'

export type ProxyEffectiveMode = 'custom' | 'internal' | 'direct'

export type ProxyEffectiveDetail = 'managed_pool' | 'internal_route' | 'relay'

export interface ListProxyCitiesParams {
  country?: string
  state?: string
  search?: string
}

export interface ProxyCity {
  label: string
  value: string
  raw_city?: string
  state?: string
  state_label?: string
}

export interface ListProxyCitiesResponse {
  cities: ProxyCity[]
  country: string
  state?: string
}

export interface ProxyFallbackState {
  active: boolean
  reason: string
  since: number
}

export interface ProxyConfig {
  mode: ProxyMode
  effective_mode: ProxyEffectiveMode
  effective_detail?: ProxyEffectiveDetail
  fallback: ProxyFallbackState
  proxy_url: string
  proxy_fallback: string
  managed: boolean
  last_test_at: number
  last_test_error: string
  validation_error: boolean
}

export interface UpdateProxyParams {
  mode: ProxyMode
  proxy_url?: string
  proxy_fallback?: string
  confirm_no_proxy?: boolean
  rotate_now?: boolean
}

export interface UpdateProxyResponse {
  details: string
  proxy: ProxyConfig
  restart_requested: boolean
  rotated?: boolean
}

export interface CheckChatParams {
  numbers: string[]
}

export interface CheckChatEntry {
  query: string
  isInWhatsapp?: boolean
  jid?: string
  lid?: string
  verifiedName?: string
  groupName?: string
  error?: string
}

export interface ChatDetailsParams {
  number: string
  preview?: boolean
}

export interface ChatDetailsResponse {
  id?: string
  owner?: string
  name?: string
  phone?: string
  image?: string
  imagePreview?: string
  common_groups?: string
  wa_fastid?: string
  wa_chatid?: string
  wa_name?: string
  wa_contactName?: string
  wa_archived?: boolean
  wa_isBlocked?: boolean
  wa_isGroup?: boolean
  wa_isGroup_admin?: boolean
  wa_isGroup_announce?: boolean
  wa_isGroup_community?: boolean
  wa_isGroup_member?: boolean
  wa_muteEndTime?: number
  wa_isPinned?: boolean
  wa_unreadCount?: number
  lead_name?: string
  lead_fullName?: string
  lead_email?: string
  lead_status?: string
  chatbot_summary?: string
  chatbot_lastTrigger_id?: string
  chatbot_disableUntil?: number
}

export type ContactScope = 'address_book' | 'outside_address_book' | 'all'

export interface ListContactsQuery {
  contactScope?: ContactScope
}

export interface UazapiContact {
  jid: string
  contact_name?: string
  contact_FirstName?: string
}

export interface ListContactsPaginatedParams {
  contactScope?: ContactScope
  limit?: number
  offset?: number
}

export interface ListContactsPaginatedResponse {
  contacts: UazapiContact[]
  pagination: {
    limit: number
    offset: number
    totalRecords: number
  }
  totalDeviceContacts: number
}

export interface UazapiGroupParticipant {
  JID?: string
  LID?: string
  PhoneNumber?: string
  IsAdmin?: boolean
  IsSuperAdmin?: boolean
  DisplayName?: string
  Error?: number
  AddRequest?: {
    Code?: string
    Expiration?: string
  }
}

export type GroupMemberAddMode = 'admin_add' | 'all_member_add'

export type GroupAddressingMode = 'pn' | 'lid'

export interface UazapiGroup {
  JID?: string
  OwnerJID?: string
  OwnerPN?: string
  Name?: string
  NameSetAt?: string
  NameSetBy?: string
  NameSetByPN?: string
  Topic?: string
  TopicID?: string
  TopicSetAt?: string
  TopicSetBy?: string
  TopicSetByPN?: string
  TopicDeleted?: boolean
  IsLocked?: boolean
  IsAnnounce?: boolean
  AnnounceVersionID?: string
  IsEphemeral?: boolean
  DisappearingTimer?: number
  IsIncognito?: boolean
  IsParent?: boolean
  IsJoinApprovalRequired?: boolean
  LinkedParentJID?: string
  IsDefaultSubGroup?: boolean
  DefaultMembershipApprovalMode?: string
  GroupCreated?: string
  CreatorCountryCode?: string
  ParticipantVersionID?: string
  Participants?: UazapiGroupParticipant[]
  MemberAddMode?: GroupMemberAddMode
  AddressingMode?: GroupAddressingMode
  OwnerCanSendMessage?: boolean
  OwnerIsAdmin?: boolean
  DefaultSubGroupId?: string
  invite_link?: string
  request_participants?: string
}

export interface GetGroupInfoParams {
  groupjid: string
  force?: boolean
  getInviteLink?: boolean
  getRequestsParticipants?: boolean
}

export interface ListGroupsQuery {
  force?: boolean
  noparticipants?: boolean
}

export interface ListGroupsResponse {
  groups: UazapiGroup[]
}

export interface ListGroupsPaginatedParams {
  force?: boolean
  noParticipants?: boolean
  search?: string
  limit?: number
  offset?: number
}

export interface ListGroupsPaginatedResponse {
  groups: UazapiGroup[]
  pagination: {
    limit: number
    offset: number
    totalRecords: number
  }
}

export interface UpsertGlobalWebhookParams {
  url: string
  events: WebhookEvent[]
  excludeMessages?: WebhookExcludeFilter[]
  addUrlEvents?: boolean
  addUrlTypesMessages?: boolean
}

export type Ok<T> = { success: true; data: T }
export type Err = { success: false; error: UazapiErrorPayload }
export type Result<T> = Ok<T> | Err
