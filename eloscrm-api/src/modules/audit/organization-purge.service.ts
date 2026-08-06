import { prisma } from "../../lib/prisma.js";
import { R2_PRIVATE_BUCKET, deleteFiles } from "../../lib/storage.js";
import { deleteRemoteInstance } from "../whatsapp/whatsapp.service.js";

/**
 * O que o cascade do Postgres **não** alcança quando a imobiliária é excluída.
 *
 * Decisão do produto: apagar a organização apaga tudo que é dela — arquivos, mensagens, conversas e a
 * própria auditoria (as 13 relações de `Organization` são `onDelete: Cascade`). Só que o banco não sabe
 * do bucket nem do provedor: sem esta função o objeto no R2 continua pago e acessível por chave, e a
 * instância segue conectada ao WhatsApp do cliente.
 *
 * Roda **antes** do delete, de propósito: depois dele não há mais chave de objeto nem token de
 * instância para usar.
 */
export const purgeOrganizationAssets = async (orgId: string) => {
  const [anexos, midias] = await Promise.all([
    prisma.attachment.findMany({ where: { organizationId: orgId }, select: { key: true } }),
    prisma.whatsappMessage.findMany({
      where: { organizationId: orgId, mediaKey: { not: null } },
      select: { mediaKey: true },
    }),
  ]);

  const keys = [
    ...anexos.map((anexo) => anexo.key),
    ...midias.flatMap((midia) => (midia.mediaKey ? [midia.mediaKey] : [])),
  ];
  // deleteFiles já lida com lote de 1000 e com lista vazia — sem mídia nenhuma o storage não é chamado
  const failedObjects = await deleteFiles(R2_PRIVATE_BUCKET, keys);

  const instance = await prisma.uazapiInstance.findUnique({ where: { organizationId: orgId } });
  if (instance) await deleteRemoteInstance(instance);

  return { objects: keys.length, failedObjects, instanceRemoved: !!instance };
};

/**
 * Quantas purgas de organização falharam, e por quê.
 *
 * Falha aqui **não** pode impedir a exclusão: o titular pediu para sair, e travar isso é pior do que
 * deixar objeto órfão no bucket. Mas silêncio também não serve — o contador aparece em `/health` e a
 * mensagem diz o que sobrou para expurgo manual.
 */
export const organizationPurgeFailures = { count: 0, lastMessage: null as string | null };

export const purgeOrganizationAssetsSafely = async (orgId: string) => {
  try {
    return await purgeOrganizationAssets(orgId);
  } catch (error) {
    organizationPurgeFailures.count += 1;
    organizationPurgeFailures.lastMessage = error instanceof Error ? error.message : String(error);
    process.emitWarning(
      `purga de assets da organização ${orgId} falhou: ${organizationPurgeFailures.lastMessage}`,
    );
    return null;
  }
};
