import { formatBrPhone } from "./phone.js";

/**
 * O lead foi batizado pela automação, não por uma pessoa.
 *
 * Quem escreve primeiro é quem dá o nome: se a conversa partiu da corretora, o chat ainda não existe
 * do lado do provedor e o envelope não traz nome nenhum — sobra o telefone. Esta é a única condição
 * em que renomear sozinho é seguro, e por isso ela vale para os três caminhos que fazem isso (a
 * ingestão, a tela de correção e o backfill). Se cada um decidisse por conta própria, o mesmo lead
 * seria "corrigível" num lugar e intocável no outro.
 */
export const isAutoNamed = (client: { name: string; phone: string | null }) =>
  client.name === formatBrPhone(client.phone);

/**
 * O nome que a conversa sabe.
 *
 * `contactName` vem da agenda do celular e é escolha de gente; `waName` é o nome que a própria
 * pessoa pôs no perfil. Nessa ordem. **Nunca o `senderName` da mensagem**: em mensagem enviada pela
 * corretora ele é o perfil da instância, e batizaria o lead com o nome da própria imobiliária.
 */
export const suggestedNameOf = (conversation: {
  contactName: string | null;
  waName: string | null;
}) => (conversation.contactName ?? conversation.waName)?.trim() || null;
