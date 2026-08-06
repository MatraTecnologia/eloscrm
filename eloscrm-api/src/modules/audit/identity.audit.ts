import { AuditAction, AuditEntity, AuditSource } from "../../generated/prisma/client.js";
import type { Actor } from "../../lib/actor.js";
import { recordAudit, type AuditInput } from "../../lib/audit.js";
import { maskEmail } from "../../lib/audit-snapshot.js";
import { prisma } from "../../lib/prisma.js";

/**
 * Ponte entre os hooks do Better Auth e a auditoria.
 *
 * Os hooks não recebem `FastifyRequest`, então `ip`/`userAgent` só existem onde o próprio Better Auth
 * já os guarda (a linha de `session`). É a razão de o ator ser montado aqui em vez de sair de
 * `actorOf`.
 */
const actorFrom = (user: { id: string; name?: string | null; email?: string | null }): Actor => ({
  id: user.id,
  name: user.name || user.email || "Usuário",
  email: user.email ?? undefined,
  source: AuditSource.USER,
});

/**
 * Auditar identidade **não pode derrubar a autenticação**.
 *
 * Exceção deliberada à regra de "falha de auditoria aborta a operação" (D5 do plano): aqui o
 * `recordAudit` roda dentro de hook do Better Auth, e erro propagado ali tranca login, criação de
 * organização e convite. Perder um evento é menos grave que ninguém conseguir entrar — então a falha
 * vira log e a operação segue.
 */
const safeRecord = async (input: AuditInput) => {
  try {
    await recordAudit(input);
  } catch {
    // sem logger aqui: `lib/auth.ts` é montado antes do Fastify e não tem request.log. O evento
    // perdido aparece como lacuna na trilha, e a operação de auth continua de pé.
  }
};

/** Login. A sessão já nasce com `activeOrganizationId` resolvido no `create.before`. */
export const auditSignIn = async (session: {
  userId: string;
  activeOrganizationId?: string | null;
  id: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}) => {
  // sem organização ativa não há tenant a que atribuir o evento — usuário recém-criado, antes de
  // entrar em qualquer imobiliária, simplesmente não gera linha
  if (!session.activeOrganizationId) return;
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, name: true, email: true },
  });
  if (!user) return;

  await safeRecord({
    orgId: session.activeOrganizationId,
    entityType: AuditEntity.SESSION,
    entityId: session.id,
    entityLabel: user.name,
    action: AuditAction.SIGNED_IN,
    actor: {
      ...actorFrom(user),
      ip: session.ipAddress ?? undefined,
      userAgent: session.userAgent ?? undefined,
    },
  });
};

/** Logout. O hook de delete entrega a linha da sessão antes de ela sumir. */
export const auditSignOut = async (session: {
  userId: string;
  activeOrganizationId?: string | null;
  id: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}) => {
  if (!session.activeOrganizationId) return;
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, name: true, email: true },
  });
  if (!user) return;

  await safeRecord({
    orgId: session.activeOrganizationId,
    entityType: AuditEntity.SESSION,
    entityId: session.id,
    entityLabel: user.name,
    action: AuditAction.SIGNED_OUT,
    actor: {
      ...actorFrom(user),
      ip: session.ipAddress ?? undefined,
      userAgent: session.userAgent ?? undefined,
    },
  });
};

type HookUser = { id: string; name?: string | null; email?: string | null };
type HookOrg = { id: string; name: string };

export const auditOrganizationCreated = (organization: HookOrg, user: HookUser) =>
  safeRecord({
    orgId: organization.id,
    entityType: AuditEntity.ORGANIZATION,
    entityId: organization.id,
    entityLabel: organization.name,
    action: AuditAction.CREATED,
    actor: actorFrom(user),
  });

export const auditOrganizationUpdated = (organization: HookOrg | null, user: HookUser) => {
  // o adaptador pode não devolver a organização atualizada; sem id não há evento a que dar tenant
  if (!organization) return Promise.resolve();
  return safeRecord({
    orgId: organization.id,
    entityType: AuditEntity.ORGANIZATION,
    entityId: organization.id,
    entityLabel: organization.name,
    action: AuditAction.UPDATED,
    actor: actorFrom(user),
  });
};

export const auditMemberAdded = (
  member: { id: string; role: string; userId: string },
  user: HookUser,
  organization: HookOrg,
) =>
  safeRecord({
    orgId: organization.id,
    entityType: AuditEntity.MEMBER,
    entityId: member.id,
    // quem entrou, não quem convidou: o evento é sobre o membro
    entityLabel: user.name || user.email || member.userId,
    action: AuditAction.MEMBER_ADDED,
    actor: actorFrom(user),
    context: { role: member.role, email: maskEmail(user.email) },
  });

export const auditMemberRemoved = (
  member: { id: string; role: string; userId: string },
  user: HookUser,
  organization: HookOrg,
) =>
  safeRecord({
    orgId: organization.id,
    entityType: AuditEntity.MEMBER,
    entityId: member.id,
    entityLabel: user.name || user.email || member.userId,
    action: AuditAction.MEMBER_REMOVED,
    actor: actorFrom(user),
    context: { role: member.role, email: maskEmail(user.email) },
  });

export const auditMemberRoleChanged = (
  member: { id: string; role: string; userId: string },
  previousRole: string,
  user: HookUser,
  organization: HookOrg,
) =>
  safeRecord({
    orgId: organization.id,
    entityType: AuditEntity.MEMBER,
    entityId: member.id,
    entityLabel: user.name || user.email || member.userId,
    action: AuditAction.ROLE_CHANGED,
    actor: actorFrom(user),
    changes: { role: { from: previousRole, to: member.role } },
  });

export const auditInvitationCreated = (
  invitation: { id: string; email: string; role?: string | null },
  inviter: HookUser,
  organization: HookOrg,
) =>
  safeRecord({
    orgId: organization.id,
    entityType: AuditEntity.INVITATION,
    entityId: invitation.id,
    // e-mail mascarado até no rótulo: convite pendente é dado de alguém que ainda não é usuário
    entityLabel: maskEmail(invitation.email),
    action: AuditAction.INVITED,
    actor: actorFrom(inviter),
    context: { role: invitation.role ?? null },
  });
