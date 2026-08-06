import { AuditEntity } from "../generated/prisma/client.js";

/**
 * Entidades que aceitam comentário e anexo.
 *
 * `AuditEntity` é o discriminador de três tabelas (`AuditEvent`, `Comment`, `Attachment`), e só a
 * primeira usa todos os valores. Sem este recorte, `z.enum(AuditEntity)` nos schemas de comentário e
 * anexo passaria a aceitar `WHATSAPP_INSTANCE` ou `SESSION` — pedido que não faz sentido e que hoje só
 * não vira dado errado por acidente do `else` de `entityExistsInOrg`.
 */
export const ANNOTATABLE_ENTITIES = [
  AuditEntity.CLIENT,
  AuditEntity.DEAL,
  AuditEntity.PROPERTY,
  AuditEntity.ACTIVITY,
] as const;

export type AnnotatableEntity = (typeof ANNOTATABLE_ENTITIES)[number];
