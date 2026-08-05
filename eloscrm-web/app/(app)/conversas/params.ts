/**
 * A conversa aberta mora na URL (`/conversas?c=<id>`), não no estado do componente: é o que permite
 * mandar alguém direto para uma conversa de qualquer lugar do app, recarregar a página sem perder o
 * lugar e usar o botão voltar do navegador.
 *
 * O nome do parâmetro fica aqui porque quem escreve (a tela) e quem lê (todo link de fora) são
 * arquivos diferentes — divergir o nome quebraria o link sem erro de compilação.
 */
export const CONVERSA_PARAM = "c";

export const conversaHref = (conversationId: string) =>
  `/conversas?${CONVERSA_PARAM}=${encodeURIComponent(conversationId)}`;
