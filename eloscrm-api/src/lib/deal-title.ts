/**
 * Título dos cards que ninguém digitou.
 *
 * A automação da ingestão e o "Adicionar ao funil" da tela de conversas usam o mesmo texto — e é
 * essa forma fixa que permite reconhecer depois que o título ainda é derivado do nome do lead, e
 * portanto pode acompanhá-lo quando o nome muda. Título escrito por gente não casa com o padrão e
 * não é tocado.
 */
export const autoDealTitle = (clientName: string) => `Atendimento — ${clientName}`;
