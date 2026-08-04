import {
  Prisma,
  UazapiInstanceLogEvent,
  UazapiInstanceStatus,
} from '../../generated/prisma/client.js'

const STATUS_MAP: Record<string, UazapiInstanceStatus> = {
  connected: UazapiInstanceStatus.connected,
  connecting: UazapiInstanceStatus.connecting,
  disconnected: UazapiInstanceStatus.disconnected,
  hibernated: UazapiInstanceStatus.hibernated,
}

export const parseStatus = (raw: unknown): UazapiInstanceStatus | null => {
  if (typeof raw !== 'string') return null
  return STATUS_MAP[raw.toLowerCase()] ?? null
}

export const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v : undefined

export const bool = (v: unknown): boolean | undefined =>
  typeof v === 'boolean' ? v : undefined

export const parseDate = (v: unknown): Date | undefined => {
  if (typeof v !== 'string') return undefined
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? undefined : d
}

export const eventForTransition = (
  previous: UazapiInstanceStatus,
  next: UazapiInstanceStatus,
): UazapiInstanceLogEvent => {
  if (previous === next) return UazapiInstanceLogEvent.status_changed
  if (next === UazapiInstanceStatus.connected)
    return UazapiInstanceLogEvent.connected
  if (next === UazapiInstanceStatus.disconnected)
    return UazapiInstanceLogEvent.disconnected
  return UazapiInstanceLogEvent.status_changed
}

export const applyInstanceSnapshot = (
  data: Record<string, unknown>,
  receivedAt: Date,
): Prisma.UazapiInstanceUpdateInput => {
  const updateData: Prisma.UazapiInstanceUpdateInput = {
    lastStatusAt: receivedAt,
  }

  const nextStatus = parseStatus(data.status)
  if (nextStatus) updateData.status = nextStatus

  const profileName = str(data.profileName)
  const profilePicUrl = str(data.profilePicUrl)
  const isBusiness = bool(data.isBusiness)
  const plataform = str(data.plataform)
  const ownerJid = str(data.owner) ?? str(data.ownerJid)
  const systemName = str(data.systemName)
  const qrcode = str(data.qrcode)
  const paircode = str(data.paircode)
  const lastDisconnectReason = str(data.lastDisconnectReason)
  const lastDisconnectAt = parseDate(data.lastDisconnect)

  if (profileName !== undefined) updateData.profileName = profileName
  if (profilePicUrl !== undefined) updateData.profilePicUrl = profilePicUrl
  if (isBusiness !== undefined) updateData.isBusiness = isBusiness
  if (plataform !== undefined) updateData.plataform = plataform
  if (ownerJid !== undefined) updateData.ownerJid = ownerJid
  if (systemName !== undefined) updateData.systemName = systemName
  if (qrcode !== undefined) updateData.qrcode = qrcode
  if (paircode !== undefined) updateData.paircode = paircode

  if (nextStatus === UazapiInstanceStatus.connected) {
    updateData.qrcode = null
    updateData.paircode = null
  }

  if (nextStatus === UazapiInstanceStatus.disconnected) {
    updateData.lastDisconnectAt = lastDisconnectAt ?? receivedAt
    if (lastDisconnectReason !== undefined)
      updateData.lastDisconnectReason = lastDisconnectReason
  }

  return updateData
}
