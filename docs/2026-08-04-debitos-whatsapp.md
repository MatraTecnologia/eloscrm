# Débitos em aberto da integração de WhatsApp

O que ficou **conscientemente** de fora quando a integração foi para produção em 2026-08-04. Nada
aqui é bug: são decisões adiadas, com o motivo registrado para que a próxima pessoa não precise
redescobrir o problema antes de resolvê-lo.

Estado no momento em que este documento foi escrito: instância, conversas, reply, deleção e
automação de leads no ar. Specs de referência:
[`instância`](../eloscrm-api/docs/superpowers/specs/2026-08-03-whatsapp-uazapi-design.md) ·
[`conversas`](../eloscrm-api/docs/superpowers/specs/2026-08-04-whatsapp-conversas-design.md) ·
[`automação`](../eloscrm-api/docs/superpowers/specs/2026-08-04-automacao-de-leads-design.md)

---

## 1. Envio de mídia pelo CRM

**O que dói.** O corretor **recebe** foto, áudio, documento, gif, figurinha e vídeo — e só consegue
**responder texto**. `conversations.service.sendText` é a única saída. Na prática ele pega o celular
para mandar a planta do apartamento, e o atendimento se parte em duas ferramentas.

**O que já existe.** `send.media` está pronto em `src/lib/uazapi/send.ts`, e o módulo de anexos já
faz upload direto do navegador para o R2 com presigned (`storage.getUploadUrl`). Falta o seletor de
arquivo no compositor e a rota.

**A decisão em aberto.** A spec da uazapi diz que o campo `file` aceita **URL ou base64**
(`docs/uazapi/paths/enviar-mensagem/send_media.yaml`):

| Caminho | A favor | Contra |
|---|---|---|
| base64 no corpo | simples; funciona em dev sem túnel | +33% de tamanho, e um vídeo de 100 MB vira ~133 MB de JSON em memória — o mesmo problema de RAM que o download já resolveu com stream |
| presigned do R2 | não trafega base64; a mídia **já nasce** no nosso storage e dispensa o job de download | a URL precisa ser alcançável pela internet: em dev o SeaweedFS está em `localhost:8333` e a uazapi não chega lá, igual ao webhook |

**Detalhe de implementação que é fácil esquecer:** pelo caminho do R2, a mensagem enviada nasce com
`mediaKey` preenchido e `mediaStatus: ready` — ela **não** passa pela fila de download, ao contrário
de tudo que chega.

---

## 2. Política de retenção de conversa e mídia

**O que dói.** Nada é apagado. `Conversation`, `WhatsappMessage` e os objetos no R2 crescem
indefinidamente. Três forças empurram para resolver, e nenhuma delas avisa antes de virar problema:

**LGPD.** Conteúdo de conversa é dado pessoal: nome, telefone, foto de perfil e o que a pessoa
escreveu ou mandou. Guardar por prazo indeterminado não é defensável, e o titular pode pedir
eliminação a qualquer momento — hoje não existe caminho para atender esse pedido sem ir ao banco à
mão.

**Custo.** O R2 cobra por GB/mês e o teto de mídia é de 100 MB por arquivo
(`MAX_MEDIA_BYTES`, `media.service.ts`). Uma imobiliária ativa acumula rápido, e ninguém revisa isso
até a fatura assustar.

**A mensagem apagada.** "Apagar para todos" hoje **oculta** e mantém o conteúdo no banco
(`deletedAt`) — decisão consciente, tomada com o cliente, e reversível de propósito. A retenção é
onde ela deixa de ser "para sempre": é lá que se define quando o conteúdo escondido some de vez.

**O trabalho seria:** prazos definidos (decisão de negócio, e provavelmente diferentes para texto e
para mídia), um job periódico que apague além do prazo, e um caminho para o pedido de um titular
específico.

**A armadilha:** apagar a linha do banco sem apagar o objeto no R2 deixa lixo invisível e pagante.
O projeto já trata disso em outro lugar — `clients.service.remove` purga os anexos **antes** do
cascade do Postgres, justamente porque o cascade apaga a linha e esquece o arquivo. `deleteFiles`
(`lib/storage.ts`) já apaga em lotes de mil.

---

## 3. Rate limit no receptor de webhook

`/webhooks/uazapi/:instanceId/:secret` não tem `authGuard` de propósito — quem chama é o servidor da
uazapi, sem cookie, e a autenticação é o segredo de 32 bytes na URL. Mas **não há limite de taxa**:
o projeto não tem `@fastify/rate-limit`.

Quem descobrir uma URL válida pode inundar a rota. O dano é limitado (o corpo é validado e o hash do
token conferido quando vem), mas a fila enche e o Postgres sente.

---

## 4. `providerMessageId` no `/message/download`

`media.service.ts` endereça a mídia por `message.providerMessageId ?? message.providerId`. O
`messageid` puro é palpite razoável — a uazapi usa essa forma em `replyid` e em `MessageIDs` —, mas
**não foi confirmado** contra a API real. Se estiver errado, o sintoma é download falhando para
algum tipo específico, com a URL temporária ainda funcionando por dois dias e mascarando o problema.

---

## 5. Rotação do `webhookSecret`

Hoje só removendo e recriando a instância, o que derruba a conexão do número. Um segredo vazado
(pelo log de diagnóstico, por exemplo) não tem caminho de troca sem interrupção.

---

## 6. `UAZAPI_DEBUG_LOG` é ferramenta, não logger

Grava o corpo cru de cada webhook, incluindo **telefone, nome de perfil e nome de contato** — dado
pessoal sob LGPD. Em produção, ligar só pelo tempo de uma apuração e apagar o arquivo depois. Não é
débito de código; é disciplina operacional que se perde com o tempo.

---

> Criado em 2026-08-04 12:36 (-03) · Última modificação: 2026-08-04 12:36 (-03)
