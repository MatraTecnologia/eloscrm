// Classifica a falha de um envio de campanha. Só o que é do destinatário vira "Falhou"; o que é da
// conexão, da conta ou do template pausaria a fila inteira destinatário por destinatário, sem ninguém
// receber, e no 131048 insistir ainda piora a restrição do número.
export const RECIPIENT_CHANGED = "CAMPAIGN_RECIPIENT_CHANGED";
// Mudança que exige revisão. A de template ou arquivo não tem retomada: a mensagem aprovada não existe mais.
export const REVIEW_CODES = new Set(["CAMPAIGN_CHANGED", "CAMPAIGN_TEMPLATE_CHANGED"]);

const globalCodes = new Set(["CAMPAIGN_CONNECTION", "WHATSAPP_CONNECTION_UNAVAILABLE", "WHATSAPP_TOKEN_EXPIRED", "OFFICIAL_CONNECTION_DISABLED", "OFFICIAL_TEMPLATE_CHANGED", "OFFICIAL_TEMPLATE_UNAVAILABLE", "OFFICIAL_TEMPLATE_UNSUPPORTED", "FORBIDDEN", "NOT_FOUND"]);
// Códigos da Graph API que dizem respeito ao número, à conta ou ao template, não à pessoa.
const providerReasons: Record<number, string> = {
  0: "A Meta recusou a autenticação da conexão", 3: "O app não tem permissão para enviar por este número", 10: "O app não tem permissão para enviar por este número",
  190: "O token da conexão oficial expirou ou foi revogado; reconecte o número", 368: "A Meta bloqueou temporariamente o número por violação de política",
  80007: "Limite de envios da conta atingido; continue mais tarde", 130429: "Limite de envios por segundo atingido; continue mais tarde",
  131031: "A conta do WhatsApp Business está bloqueada", 131042: "Há um problema com a forma de pagamento da conta na Meta",
  131048: "A Meta restringiu o número por excesso de denúncias ou bloqueios; aguarde antes de continuar", 131057: "A conta do WhatsApp Business está em manutenção",
  132000: "Os parâmetros não correspondem ao template aprovado", 132001: "O template não existe mais neste idioma", 132007: "O template viola a política da Meta",
  132015: "O template foi pausado pela Meta por baixa qualidade", 132016: "O template foi desativado pela Meta", 133010: "O número oficial não está registrado na Meta",
};
const internalReasons: Record<string, string> = {
  CAMPAIGN_CONNECTION: "O número oficial está desconectado", WHATSAPP_CONNECTION_UNAVAILABLE: "O número oficial está indisponível", WHATSAPP_TOKEN_EXPIRED: "O token da conexão oficial expirou; reconecte o número",
  OFFICIAL_CONNECTION_DISABLED: "A conexão oficial está desativada", OFFICIAL_TEMPLATE_CHANGED: "O template perdeu a aprovação ou mudou na Meta", OFFICIAL_TEMPLATE_UNAVAILABLE: "O template não está aprovado na Meta (pausado, desativado ou removido)",
  OFFICIAL_TEMPLATE_UNSUPPORTED: "O template usa componentes que o CRM não envia",
  FORBIDDEN: "Quem criou a campanha não é mais gestor desta imobiliária", NOT_FOUND: "O número, o funil ou o template da campanha não existe mais",
};

export const globalFailure = (code: string | null, providerCode: number | null): string | null => {
  if (providerCode !== null) return providerReasons[providerCode] ?? null;
  return code && globalCodes.has(code) ? internalReasons[code]! : null;
};
// Antes da submissão a Graph só é consultada sobre o template e o arquivo, nunca sobre a pessoa:
// qualquer recusa ali vale para a campanha inteira.
export const preSubmissionFailure = (providerCode: number | null) =>
  `A Meta não concluiu a conferência do template ou do arquivo${providerCode === null ? "" : ` (código ${providerCode})`}; continue mais tarde`;
