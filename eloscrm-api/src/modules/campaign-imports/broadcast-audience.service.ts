import { BroadcastRecipientStatus } from "../../generated/prisma/client.js";
import { httpError } from "../../lib/http-error.js";
import type { ImportedAudience } from "./imports.schema.js";
import { renderTemplate, templateVarsOf } from "../broadcasts/template.js";

export const importBroadcastRecipients = (audience: ImportedAudience, template: string) => {
  if (new RegExp("\\{\\{\\s*(titulo|valor|imovel|corretor)\\s*\\}\\}", "i").test(template)) throw httpError(422, "BROADCAST_MESSAGE_INVALID", "Listas importadas permitem somente as variáveis de nome");
  const seen = new Set<string>();
  return audience.recipients.map((recipient, index) => {
    const number = recipient.phone!;
    const duplicate = seen.has(number); seen.add(number);
    const text = renderTemplate(template, templateVarsOf({ client: { name: recipient.name }, title: "", value: null, property: null, ownerName: null }));
    if (text.length > 2000 || /\{\{|\}\}/.test(text) || (!recipient.name && new RegExp("\\{\\{\\s*nome(?:_completo)?\\s*\\}\\}", "i").test(template))) throw httpError(422, "BROADCAST_MESSAGE_INVALID", "Confira os nomes, as variáveis e o limite de 2000 caracteres da mensagem");
    return { dealId: duplicate ? `import:${number}:duplicate:${index}` : `import:${number}`, clientId: "", clientName: recipient.name || number, number, text,
      status: duplicate ? BroadcastRecipientStatus.SKIPPED : BroadcastRecipientStatus.PENDING,
      ...(duplicate ? { error: "Telefone repetido neste disparo", errorCode: "DUPLICATE_DESTINATION", errorStage: "validation" } : {}) };
  });
};
