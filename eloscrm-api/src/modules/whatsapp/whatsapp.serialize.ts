import type { UazapiInstance } from "../../generated/prisma/client.js";

/**
 * Nada que autentique sai da API: `tokenEnc` é o token cifrado, `tokenHash` permitiria confirmar um
 * palpite de token e `webhookSecret` daria a quem o tivesse o poder de forjar eventos de conexão.
 * `tokenLast4` fica — serve para o gestor conferir qual instância é qual no painel da uazapi.
 */
export const serializeInstance = (instance: UazapiInstance) => {
  const { tokenEnc: _tokenEnc, tokenHash: _tokenHash, webhookSecret: _secret, ...rest } = instance;
  return rest;
};

export type SerializedInstance = ReturnType<typeof serializeInstance>;
