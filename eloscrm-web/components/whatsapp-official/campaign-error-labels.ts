// Código de falha do disparo → o que aconteceu e o que fazer. Quem lê é o gestor, não quem integra
// com a Meta: "Código 131049" sozinho não diz se é para corrigir o número, esperar ou desistir.
type ErrorHint = { label: string; action: string };

const hints: Record<string, ErrorHint> = {
  "131026": { label: "Mensagem não entregável", action: "O número pode não ter WhatsApp, usar uma versão antiga ou não ter aceitado os termos. Confirme o número com o lead." },
  "131049": { label: "Limite de marketing por pessoa", action: "A Meta segurou a mensagem para preservar o engajamento. Não reenvie agora; tente em alguns dias." },
  "131050": { label: "A pessoa parou de receber marketing desta empresa", action: "Não reenvie mensagens de marketing para este contato." },
  "130472": { label: "Número em experimento da Meta", action: "A Meta não entrega marketing a este número durante um experimento. Não é problema do cadastro." },
  "131047": { label: "Fora da janela de 24 horas", action: "Use um template aprovado para falar com esta pessoa." },
  "131056": { label: "Muitas mensagens para o mesmo número", action: "Aguarde alguns minutos antes de tentar de novo." },
  "131021": { label: "Destinatário igual ao número oficial", action: "Corrija o telefone do lead." },
  "131051": { label: "Tipo de mensagem não suportado", action: "Revise o template escolhido." },
  "131053": { label: "Falha no envio da mídia", action: "Confira o arquivo do cabeçalho." },
  "131000": { label: "Erro temporário da Meta", action: "Tente novamente mais tarde." },
  "100": { label: "Parâmetro inválido", action: "Revise os dados personalizados do template." },
  "132000": { label: "Parâmetros diferentes do template aprovado", action: "Sincronize os templates e crie a campanha de novo." },
  "132001": { label: "Template inexistente neste idioma", action: "Sincronize os templates e escolha outro." },
  "132005": { label: "Texto personalizado longo demais", action: "Encurte os dados personalizados deste lead." },
  "132007": { label: "Template viola a política da Meta", action: "Escolha outro template." },
  "132012": { label: "Formato de parâmetro inválido", action: "Revise os dados personalizados do template." },
  "132015": { label: "Template pausado pela Meta", action: "Aguarde a reavaliação do template ou escolha outro." },
  "132016": { label: "Template desativado pela Meta", action: "Escolha outro template." },
  CAMPAIGN_RECIPIENT_CHANGED: { label: "Mudou durante o disparo", action: "O lead saiu dos filtros, mudou de contato ou de dados personalizados, ou já recebeu este template. Não foi enviado." },
  PROVIDER_UNCONFIRMED: { label: "Resultado não confirmado pela Meta", action: "Confira o WhatsApp antes de repetir: a mensagem pode ter saído." },
  PREPARATION_FAILED: { label: "Falha ao preparar o envio", action: "Tente de novo em outra campanha; se repetir, avise o suporte." },
};

// O recibo de entrega pode trazer mais de um código ("131026, 131049"); o primeiro explica a falha.
export const describeCampaignError = (code: string | null): ErrorHint | null => (code ? hints[code.split(",")[0]!.trim()] ?? null : null);
