# Plano de migração: integração oficial do WhatsApp para o Matra Meta Hub

Convenções de citação:
- `hub:N` = linha N da documentação completa do hub (`llms-full.txt`); `oa` = `openapi.json` do hub. Snapshot de 2026-11-10 de https://metahub.matratecnologia.com/llms-full.txt, sha256 `4ccb29dc2f5bc23069c02a8fa27451ccc6dd7c347eedb2074ac79d9a831b9a97`; as linhas valem só para essa versão.
- Caminhos da API são relativos a `eloscrm-api/`; os do web começam com `eloscrm-web/`.
- Tudo foi lido sem acesso a rede, banco ou `.env`. Afirmações marcadas **a confirmar com o hub** não se provam lendo arquivos.
- Valores marcados **(parâmetro)** são escolhas de desenho a calibrar no piloto, não fatos medidos.

---

## 1. Objetivo e escopo

### 1.1 Objetivo
Trocar a integração direta do app com a WhatsApp Cloud API (Graph API, Embedded Signup próprio, webhook próprio da Meta) pelo Matra Meta Hub como intermediário, sem mudar o contrato que o web e os módulos de domínio usam para conversas, contatos, leads, disparos, templates e custos.

### 1.2 Dentro do escopo
- Onboarding (Embedded Signup e Coexistence), token, assinatura da WABA: passam para o hub.
- Recebimento de mensagens, ecos, recibos, histórico, contatos e troca de identidade: chegam pelo webhook do hub.
- Envio manual, envio de template e disparos: saem pela API de mensagens do hub.
- Templates (sync, criação, exclusão, status), mídia recebida e enviada, custos.
- Migração das conexões que já estão em produção, com convivência e rollback.

### 1.3 Fora do escopo
- Lead Ads pelo hub (fase separada, §8 F11).
- Tipos de envio que o app não oferece hoje (reação, localização, interativos, sticker) e read receipt / "digitando" (Q6).
- A integração uazapi não muda. Os pontos em que ela encosta na oficial estão em §1.4 e precisam continuar funcionando.

### 1.4 Pontos de contato com a uazapi
| Ponto | Onde | O que o plano garante |
|---|---|---|
| Exceção de envio manual pela uazapi na conversa oficial | `src/modules/whatsapp-inbox/uazapi-policy.repo.ts:15-21` (`legacyEligibility`, consulta em :18) e :32-38 (`resolveManualRoute`, checagem de `status`, `disabledAt`, `isOnBusinessApp`, `tokenExpiresAt` em :37 e `displayPhoneNumber` em :38) | Durante a convivência, `status`, `tokenExpiresAt` e `displayPhoneNumber` da linha `direct` **não** são sobrescritos pelo hub (§2.4 D5). Depois da virada, passam a espelhar o hub. `legacyEligibility` não olha `tokenEnc` (:18), então zerar o token no corte não afeta a exceção. `sameSenderNumber` remove `+`, espaço, parênteses, ponto e hífen (:6), o que cobre um `displayPhoneNumber` formatado. |
| Escopo de identidade `business:<portfolio>` | `resolveManualRoute` lê identidades por `business:${connection.businessPortfolioId}` (`uazapi-policy.repo.ts:39`) | `businessPortfolioId` nunca é sobrescrito automaticamente (§10 R10). |
| Lock por portfólio | `withConnectionLock` em `src/modules/whatsapp-official/identity.repo.ts`, usado também por `src/modules/campaign-imports/imports.repo.ts:4,9` | Os handlers do hub usam o mesmo lock. Nenhuma mudança de assinatura. |
| `eventHash` | importado de `src/modules/whatsapp-official/webhook.schema.ts` por `src/modules/broadcasts/broadcasts.service.ts:16` (uso em :92) | Mover para `src/lib/` antes de apagar qualquer arquivo de `whatsapp-official/` (F10). |
| Desativação separada | `src/modules/whatsapp-maintenance/lifecycle.repo.ts:24` (`UAZAPI_DISCONNECT_SEPARATE`) | Sem mudança. |
| Tabelas compartilhadas | `Conversation`, `WhatsappMessage` (`origin: "uazapi"` em `src/modules/whatsapp-inbox/uazapi-manual.repo.ts:15`), `ChannelConnection` (`ChannelProvider` `cloud_api`/`uazapi`, `prisma/schema.prisma:689-692`) | Só colunas aditivas e nulas; nenhum valor de enum novo (§2.4 D2). |
| Eco da mensagem enviada pela uazapi | O eco Coexistence entra por `ingestMessage(..., "business_app")` (`src/modules/whatsapp-official/webhook-processing.service.ts:35-36`) | O eco pelo hub traz o mesmo item cru (hub:1295) e entra pelo mesmo `ingestMessage`. O comportamento atual de dedup se mantém. |

---

## 2. Arquitetura alvo

### 2.1 O que sai do app no fim da migração
- Embedded Signup próprio: `src/modules/whatsapp-onboarding/`, `src/routes/v1/whatsapp/onboarding/index.ts`, `eloscrm-web/components/whatsapp-official/official-signup.tsx` e o SDK do Facebook no browser. O doc da Meta salvo no repo dá o ES v2 como descontinuado em 15/10/2026 (`docs/whatsapp-embedded-signup-implementation.md:7`); o código usa `sessionInfoVersion: "3"` (`official-signup.tsx:119`). Não verifiquei se o onboarding próprio ainda funciona.
- Cliente Graph: `src/lib/whatsapp-official/graph.ts` (sobra um `unsubscribeWaba` temporário, §7.3), `media-download.ts`, `webhook-auth.ts` e, quando nenhum `tokenEnc` restar, `crypto.ts`.
- Webhook próprio: `src/routes/webhooks/whatsapp-official/index.ts` e o journal `OfficialWebhookEvent` (fica em leitura e retenção até zerar).
- Analytics da Graph: `src/modules/whatsapp-costs/analytics.service.ts:17-20`.
- Jobs `scheduleOnboardingRecovery` (`src/server.ts:24`) e `scheduleOfficialWebhookRecovery` (`src/server.ts:22`).
- Envs `META_WHATSAPP_*` (`src/env.ts:53-58`); a chave de criptografia do token sai por último.

### 2.2 O que o hub passa a fazer
- Embedded Signup e Coexistence, inclusive o pedido de sync de histórico e contatos (hub:475, hub:602-607).
- Token da Meta, assinatura da WABA e registro do número.
- Envio com fila e vazão por número (hub:404), conciliação de `uncertain` e idempotência por `Idempotency-Key` (hub:687, hub:734-747).
- Upload de mídia: o arquivo não fica no hub e o `mediaId` vale 29 dias (hub:815, hub:831).
- Mídia recebida: o hub baixa da Meta, entrega por URL assinada de 5 minutos e guarda por 30 dias (hub:846-857).
- Cache de templates por WABA com `version` (hub:867, hub:881).
- Saúde da conta e eventos de conta (hub:609, hub:1198-1215), que hoje o app ignora (`webhook-processing.service.ts:59`).
- Volume mensal (`/consumption`) e franquia (`/usage`) (hub:1425-1491).

### 2.3 O que fica no app
- `ChannelConnection` como âncora das FKs compostas `(connectionId, organizationId)` com `Restrict` (`prisma/schema.prisma:739`).
- Conversas, `WhatsappMessage`, `MessagingContact`/`ContactIdentity`, janela de 24 h calculada localmente, automação de lead, `OfficialSendCommand`, campanhas, templates locais (ids locais), `OfficialUpload`, R2 e tabela de tarifas.

### 2.4 Decisões de desenho

**D1. Os parsers atuais recebem o item cru de `envelope.meta`.**
- O hub declara o `meta` estável e "sem alteração" em `whatsapp.message.received`, `whatsapp.message.echo` e `whatsapp.message.status` com `source:"meta"` (hub:1221). Em `received`/`echo` o formato é `{ message, contact }` (hub:1244, hub:1295). Para o status, a doc diz só "o status" (hub:1221), sem exemplo: **o formato exato é bloqueante** (§4.1 H1).
- Com o item cru, o contrato de `message-parser.ts`, `ingest.repo.ts`, `receipts.repo.ts` e `assessMessage` continua o mesmo. As correções pontuais nesses arquivos são três: `played` como no-op (`receipts.repo.ts:9`), `category` com hífen e `free_group_customer_service` (`src/modules/whatsapp-costs/message-cost.repo.ts:11,33`). Valem para as duas vias.
- Que o item que a Meta entrega ao app do hub seja byte a byte igual ao que entrega ao app próprio é **hipótese**: a doc não diz a versão da Graph (hub:1289 mostra que o formato muda por versão) e os envios do hub levam `biz_opaque_callback_data` (hub:747). Por isso a dedup de recibo passa a ser semântica (D6), e não depende de o hash coincidir.
- Do `data` normalizado saem só: `data.message.media.id` (id do hub; o id que vem no `meta` é da Meta e o app não baixa, hub:1221), `data.message.from.name` como fallback de nome quando `meta.contact` vier `null` (hub:1244; hoje o nome sai só de `contacts[].profile.name` em `message-parser.ts` `profileFor`, e alimenta `waName`/`automationSuggestedName`, `ingest.repo.ts:18,43`), e os campos de correlação do hub.
- Precisam de adaptador próprio: `history.received` (o `meta` dele é só diagnóstico, hub:1221), `contacts.synced`, `identity.updated`, `template.*`, `connection.*`, `media.updated` e `status source:"hub"`.

**D2. Nenhum valor novo em enum existente.**
- O Prisma de uma imagem antiga falha ao ler um valor de enum desconhecido. Não testei; o plano parte desse pressuposto.
- Ficam intocados `ChannelProvider` (`prisma/schema.prisma:689-692`), `OfficialSendStatus` (:1119-1126), `WhatsappMessageStatus` (:949-955), `WhatsappMessageOrigin` (:923-928), `OfficialWebhookStatus` (:865-872) e `OfficialSyncStatus` (:753-763).
- A rota por conexão é `String` (`officialRoute`: `"direct"` | `"hub"`). O provider continua `cloud_api` e as mensagens do hub continuam `origin: "cloud_api"`, valor de que dependem a automação de lead (`src/modules/lead-automation/inbound-automation.repo.ts:16`), o custo (`message-cost.repo.ts:5`) e a promoção de histórico para ao vivo (`ingest.repo.ts:27`).

**D3. Journal próprio para eventos do hub (`HubWebhookEvent`).**
- No `OfficialWebhookEvent`, a imagem antiga marcaria o evento `unsupported` (`webhook-processing.service.ts:59`), e `wabaId` é NOT NULL (`prisma/schema.prisma:881`) enquanto os eventos de template chegam com `connectionId: null` (hub:1219).

**D4. Rota gravada por conexão e por comando.**
- `OfficialSendCommand.route` é lido de `officialRoute` dentro de `createCommand`, sob o lock da conexão (`src/modules/whatsapp-outbound/outbound.repo.ts:50-51`). Um comando termina sempre no transporte em que nasceu.

**D5. Um escritor por conexão (e por WABA para templates).**
- Enquanto `officialRoute = "direct"`, os handlers do hub escrevem **só** colunas `hub*` (`hubConnectionId`, `hubStatus`, `hubErrorCode`, `hubTokenExpiresAt`, `hubHealth`, `qualityRating`, `hubEventAt`, `hubTemplateId`, `hubVersion`). `status`, `tokenExpiresAt`, `displayPhoneNumber`, `verifiedName`, `isOnBusinessApp`, `OfficialSyncRequest` e o `status`/`definition` de template ficam com o caminho direto.
  - Motivo: `connection.created` nasce `pending` (hub:612), `onboarding_incomplete` vira `error` em 2 h (hub:598), e qualquer um desses no `status` local derruba o envio direto (`outbound.repo.ts:51,92`), a mídia (`src/modules/whatsapp-official/media.repo.ts:25-27`), a exceção uazapi (`uazapi-policy.repo.ts:18,37`) e ativa `dueConnections` (`src/modules/whatsapp-onboarding/sync-request.repo.ts:29`), que chamaria `graph.subscribeWaba` com o token antigo (`sync-request.service.ts:30`). O `tokenExpiresAt` do hub é do token do app do hub, não do token local.
- Depois da virada, o caminho direto vira no-op para aquela conexão: o handler de template direto não chama `syncTemplates` nem `applyStatus` quando todas as conexões da WABA na org estão em `hub`. Hoje um template desconhecido dispara `syncTemplates` (`src/modules/whatsapp-templates/template-status.service.ts:19-21`), e `saveTemplates` marca toda a WABA `MISSING` (`outbound.repo.ts:21`).
- A virada de rota é **por WABA**: só vira quando todas as conexões `cloud_api` daquela `wabaId` na org têm `hubStatus = active`. Templates são da WABA (`prisma/schema.prisma:1263`), e a inscrição `subscribed_apps` também (hub:627).
- Uma conexão que nasce pelo hub (`officialRoute = "hub"` desde a criação) espelha tudo desde o primeiro evento.

**D6. Dedup de recibo semântica, nas duas vias.**
- Hoje `dedupKey = eventHash({ connectionId, receipt: raw })` (`src/modules/whatsapp-official/receipts.repo.ts:42`), o item cru inteiro. Se as duas vias trouxerem itens diferentes para o mesmo evento, o recibo duplica e `failedReceipts` (`src/modules/whatsapp-campaigns/campaigns.repo.ts:118`) duplica códigos.
- `ingestReceipt` passa a conferir `(connectionId, externalMessageId, status, occurredAt)` antes do `createMany`. A regra entra nas duas vias porque qualquer uma pode chegar primeiro.

**D7. Release N0 (expand) é a versão mínima de rollback.**
- A imagem antiga não conhece `route` e trataria comando do hub como direto: `recover` devolve todo `pending` manual para execução pela Graph (`outbound.repo.ts:136`) e passa todo `sending` vencido para `uncertain` (:135); o worker de campanha liquida qualquer comando fora de `pending`/`preparing` como `unknown` (`src/modules/whatsapp-campaigns/dispatch.service.ts:20-24`).
- Por isso a primeira release (N0) só acrescenta schema, filtros `route = "direct"` no código direto e o receptor do hub gravando no journal. Nenhum código grava `route = "hub"` antes de N0 estar estável, e nenhum rollback desce abaixo de N0. Registrar no `AGENTS.md` como "versão mínima de rollback".

### 2.5 Mapeamentos de identidade

| Hub | App | Regra |
|---|---|---|
| Workspace (`externalId`) | `Organization` | `externalId = organization.id` (cabe em `[A-Za-z0-9._:-]{1,128}`, hub:440-446). `POST /v1/workspaces` é idempotente por `externalId` (hub:448). Grava `Organization.hubWorkspaceId`. |
| Conexão `kind:"whatsapp"` | `ChannelConnection` (`provider: cloud_api`) | `hubConnectionId @unique`. Casa com a linha da **mesma org** por `phoneNumberId` + `wabaId` (hub:625), em **qualquer** `connection.*` cujo id ainda não exista localmente, porque a reconexão emite `connection.updated` e não `created` (hub:612). Antes de ligar, exige `whatsapp.businessId === businessPortfolioId`; divergente, não liga e marca `hubErrorCode = BUSINESS_CHANGED`. |
| Tenant do evento | `organizationId` + `connectionId` | `organizationId` por `hubWorkspaceId = workspace.id`, conferido com `externalId`. `connectionId` só é gravado se `connection.organizationId` for a org do workspace; senão `unresolved`. |
| `whatsapp.businessId` | `businessPortfolioId` | Mesmo escopo do BSUID (hub:600). Pode mudar sem evento (hub:600): o refresh diário só alerta, nunca sobrescreve (§10 R10). |
| `isOnBizApp`, `displayPhoneNumber`, `verifiedName`, `tokenExpiresAt` | `isOnBusinessApp`, `displayPhoneNumber`, `verifiedName`, `tokenExpiresAt` | Espelhados só depois da virada (D5). Antes, `tokenExpiresAt` do hub vai para `hubTokenExpiresAt`. O `displayPhoneNumber` pode vir formatado (exemplo em hub:569; o `oa` só diz `string`). `tokenExpiresAt: null` = sem prazo (hub:608), e todos os gates já tratam `null` assim. |
| `status` `active`/`pending`/`error`/`disconnected` | `status` `connected`/`pending`/`disconnected`/`disconnected` | Só depois da virada. `hubStatus`/`hubErrorCode` sempre. `disabled` continua só local. |

---

## 3. Mapeamento capacidade → hub

Legenda: **C** = coberto; **CA** = coberto com adaptação no app; **H** = depende de item a implementar no hub (§4).

### 3.1 Conexão e ciclo de vida

| Capacidade atual | Hub | Mudança no app | Status |
|---|---|---|---|
| Disponibilidade do onboarding (`GET /v1/whatsapp/onboarding/config`, gate de envs em `src/modules/whatsapp-onboarding/onboarding.service.ts:15-16`) | Chave do app configurada; `503 META_WEBHOOK_NOT_READY` na sessão (hub:515) | `GET /v1/whatsapp/hub/config` → `{available}`; o web troca `useOfficialConfig` (`eloscrm-web/lib/queries/whatsapp-official.ts:12-17`) | CA |
| Conferência da assinatura (`checkSubscriptions`, `onboarding.service.ts:31,36-43`) | O hub assina a WABA | Remover | C |
| Embedded Signup próprio (`onboarding.service.ts:29-120`) | `POST /v1/workspaces` + `POST /v1/workspaces/:id/connect-sessions {kind:"whatsapp", returnUrl, requireCoexistence:true}` → `{url}` (hub:483-506) | `POST /v1/whatsapp/hub/connect-sessions {connectionId?}` (gestor, Origin pinado e rate limit como em `src/routes/v1/whatsapp/onboarding/index.ts:11-24`). A `url` não vai para log. O web redireciona. | CA |
| Retorno do popup (`official-signup.tsx:16,78-86`) | `returnUrl?status=connected&connectionId=…` \| `cancelled` \| `error&code=…`, lista de códigos aberta (hub:519-534); a fonte da verdade é o evento (hub:536) | A página `eloscrm-web/app/(app)/integracoes/whatsapp/page.tsx` abre na aba oficial quando houver `status` na query, sem depender de `?tab=` no `returnUrl` (a allowlist compara `origin + pathname` e normaliza a URL, hub:479; não diz se a query própria sobrevive). Código desconhecido = erro genérico. | CA |
| Somente Coexistence (`onboarding.service.ts:78-80`) | `requireCoexistence: true` (default `false`, hub:493-495) | Manter `true` (Q3) | C |
| Número/WABA em outra org (`src/modules/whatsapp-onboarding/onboarding.repo.ts:38-41`, `phoneNumberId @unique` em `prisma/schema.prisma:712`) | `PHONE_ALREADY_CONNECTED`/`WABA_ALREADY_CONNECTED` entre workspaces (hub:538) | Colisão com linha `direct` de outra org: evento `failed WHATSAPP_NUMBER_UNAVAILABLE`, alerta, sem efeito | CA |
| `pending → connected` (`sync-request.service.ts:23-45`) | `connection.created` (pending) → `connection.updated` (active) (hub:1193-1198) | `applyHubConnection` com a regra D5 | CA |
| Sync Coexistence (`OfficialSyncRequest`) | `connection.sync[] {type, status, progress, errorCode}` (hub:602-607) | Só em conexão nascida pelo hub (D5). `requested → accepted` (não `pending`: `pending` é "vá pedir" para `dueConnections`, `sync-request.repo.ts:30`, e `recoverStale` o expira, :25); `accepted → accepted`; `completed → complete`; `failed + declined_by_business → declined`; `failed + sync_window_expired → expired`; `failed + sync_uncertain → uncertain`; outros `failed → failed`. `smb_app_state_sync` fica `accepted` para sempre (hub:604) e a UI trata isso como final para contatos. Estado terminal (`complete`, `declined`) nunca é sobrescrito; `deadlineAt` (NOT NULL, `prisma/schema.prisma:801`) = ativação + 24 h (hub:602). Um `failed` em conexão migrada vai só para `hubHealth` (hub:633). | CA |
| Saúde e qualidade (hoje ignoradas) | `health`, `qualityRating`, `accountEvent` (hub:609, hub:1198-1213) | `hubHealth`, `qualityRating`; exibição opcional | C |
| Token expirando | `connection.token_expiring` (hub:1215); `error token_expired` | Espelhar depois da virada; `credentialExpired` (`src/modules/whatsapp-inbox/inbox.service.ts:26`) continua | C |
| Desconexão remota (hoje não tratada) | `connection.disconnected {reason, accountEvent}` (hub:1202) | Só `status = disconnected` (depois da virada). **Não** reaproveita `disableConnection`, que cancela campanhas `draft`/`needs_review`/`running` (`src/modules/whatsapp-maintenance/lifecycle.repo.ts:32`); as campanhas pausam pelo gate global (`WHATSAPP_CONNECTION_UNAVAILABLE`, `src/modules/whatsapp-campaigns/failures.ts:8`) e voltam com `ACCOUNT_RECONNECTED` (hub:1204-1213) | CA |
| Desativar local (`lifecycle.repo.ts:20-41`) | `DELETE /v1/connections/:id` apaga a credencial e perde mensagens do intervalo (hub:614-618) | Disable continua local, sem `DELETE`. Com `hubConnectionId` e `route = direct` (convivência), o disable responde `409 HUB_MIGRATION_IN_PROGRESS`, porque zera `tokenEnc` (:38) e mataria o rollback. Em conexão `hub`, eventos de status de **comandos existentes** continuam sendo aplicados com a conexão `disabled` (hoje `src/modules/whatsapp-official/webhook.service.ts:31` barra tudo); só conteúdo novo é descartado. O reconcile consulta `GET …/messages/:id` dos `uncertain` criados pelo disable (:31). Uma sessão do hub aberta para conexão `disabled` limpa `disabledAt` no `active`, como o onboarding faz hoje (`onboarding.repo.ts:50`). | CA / H (cancelamento) |
| Orientação "Desconectar conta" (`eloscrm-web/components/whatsapp-official/lifecycle-controls.tsx:25`) | Nunca desconectar no app do celular, offboard ou deregister (hub:630) | Trocar o texto antes de qualquer migração | CA |
| Multi-conexão por org (`prisma/schema.prisma:740`) | N conexões por workspace | Sem mudança | C |
| Moeda e fuso da WABA (`onboarding.service.ts:86`) | Ausentes no recurso de conexão (`oa`, `additionalProperties:false`); fuso em `/usage` (hub:1441) com padrão `America/Sao_Paulo` indistinguível; moeda só em `/consumption.currency`, que pode ser `null` (hub:1490) | Migrada: mantém o valor gravado. Nova: §4.1 H3 | H |
| Purga de organização (`src/lib/auth.ts:132-133`) | Conexão continua `active` no hub e prende o número (hub:612) | Purga chama `DELETE /v1/connections/:id` e `POST /v1/workspaces/:id/deactivate`, idempotente, com nova tentativa | CA |

### 3.2 Recebimento

| Capacidade | Hub | Mudança | Status |
|---|---|---|---|
| Autenticação (`src/lib/whatsapp-official/webhook-auth.ts:16-22`) | `x-hub-signature: sha256=HMAC(secret, "${ts}.${raw}")`, ±5 min (hub:1054, hub:1075) | Receptor novo (§5.2) | CA |
| Dedup de entrega (`src/modules/whatsapp-official/webhook.repo.ts:37`) | `id` do envelope (hub:1097) | `HubWebhookEvent.hubEventId @unique` | CA |
| Tipos suportados (`message-parser.ts:33-54`) | `received` com `meta.message` cru (hub:1221, hub:1244) | `ingestMessage(conn, meta.message, contacts(meta.contact), "cloud_api", receivedAt, {hubMediaId, fallbackName})`; `meta.contact` aceito como objeto ou array; `null` → nome de `data.message.from.name` | CA / H1 |
| interactive, button, order, revoke, edit (hoje `unsupported`) | Normalizados em `data` (hub:1245) | Paridade: continuam `unsupported` | C |
| Eco do app Business | `whatsapp.message.echo`, `meta` cru (hub:1293-1298) | `ingestMessage(..., "business_app")`; dedup por wamid e remoção do eco em `accept` (`outbound.repo.ts:115-130`) já existem | C |
| Histórico de 180 dias (`webhook-processing.service.ts:37-54`) | `history.received` normalizado, `meta` não contratual (hub:1300-1318) | Adaptador hub → item do parser: converte `timestamp` ISO para epoch em segundos (`messageSchema` exige dígitos, `message-parser.ts:8`); passa `direction` explícita e monta `from`/`from_user_id` ou `to`/`to_user_id` a partir de `thread` (hub:1310). Com `thread.waId: null` (hub:647), usa `thread.userId` e **não** força alias `wa_id` (hoje o parser força `wa_id = threadId`, `message-parser.ts:28-32`). Aceita bloco com `phase/chunkOrder/progress` nulos (mídia dos últimos 14 dias, um evento por mensagem, hub:1317), que enriquece o `media_placeholder` sem tocar `OfficialSyncRequest.progress`. | CA |
| Recusa de histórico (erro `2593109`, `webhook-processing.service.ts:40`) | `sync[].errorCode = declined_by_business` (hub:606) | Via `applyHubConnection` | CA |
| Contatos do app (`src/modules/whatsapp-official/sync.repo.ts:10-22`) | `whatsapp.contacts.synced` (hub:1320-1322) | Adaptador: `phone → wa_id`, `userId → bsuid`, `fullName → displayName`. Contato só com `userId` (sem telefone) entra por `bsuid`: hoje `ingestContactSync` exige `phone_number` (:13-14) e geraria `failed` em loop | CA |
| Troca de BSUID (`sync.repo.ts:24-65`) | `identity.updated kind:user_changed_user_id` (hub:1324-1335) | Reaproveita `ingestIdentityUpdate`; `timestamp` ISO → epoch (`eventDate` em :30) | CA |
| Troca de número (não existe hoje) | `kind:user_changed_number`, `previous` sem `waId` (hub:1329), `current.waId` (hub:1330) | Novo: acha o contato por `previous.userId`, fecha o `wa_id` atual dele (`validUntil`) e abre `current.waId`, com auditoria `WEBHOOK_RECONCILED` | CA |
| Recibos (`receipts.repo.ts:8-48`) | `status source:"meta"` com `meta` cru (hub:1221, hub:1272-1291) | `ingestReceipt(conn, <item cru>, receivedAt)` conforme o formato confirmado em H1. `played` (hub:1272) → no-op `processed` nas duas vias (hoje o enum de :9 falha o item). Dedup semântica (D6). | CA / H1 |
| Recibo antes da mensagem | Status com `messageId: null` (hub:1288) | Correlação por wamid, como já faz (`ingest.repo.ts:71`) | C |
| Mídia recebida (`src/modules/whatsapp-official/media.service.ts:16-45`, `src/lib/whatsapp-official/media-download.ts:6-55`) | `data.message.media.id` + `media.updated` (pode chegar antes) + `GET /v1/media/:id` → URL assinada de 5 min; `409 MEDIA_NOT_READY`, `410 MEDIA_UNAVAILABLE` (hub:846-857) | `WhatsappMessage.hubMediaId`; no caminho do hub `officialMediaId` fica nulo, então o worker antigo nunca pega a mensagem (`media.repo.ts:10,25`). `mediaStatus: "pending"` (`ingest.repo.ts:44`), o enriquecimento do placeholder (:49-52) e `hasMedia` (:72,75) passam a considerar `hubMediaId`. Worker novo: `409` **não** conta tentativa (hoje o claim incrementa e exige `< 3`, `media.repo.ts:10,12`, e `expireExhaustedMedia` marca `failed`, :29); `media.updated` com mídia pronta zera `mediaAttempts`. Download sem `Authorization`, host em allowlist (H2), IP fixado, `redirect: "error"`, teto de bytes, sha256 conferido com `media.sha256`; `url` e resposta nunca em log. Mesma chave no R2. | CA / H2 |
| Retry pelo front (`src/routes/v1/whatsapp/official-media/index.ts:17-22`) | idem | `resetMedia` (`media.repo.ts:23`) aceita `hubMediaId`; `410` → `failed` com texto próprio | CA |
| Janela de 24 h (`ingest.repo.ts:66-67`) | `data.window.expiresAt` | Cálculo local mantido; `window` só diagnóstico | C |
| Grupo | `groupId`, `window: null` (hub:1249) | Comportamento atual | C |
| Mensagem anterior à conexão | Descartada pelo hub (hub:1223) | Nenhuma | C |
| Ordem fora de sequência (hub:1098) | `createdAt` do envelope | Handlers idempotentes e monotônicos (§5.2). Evento `unresolved` (ex.: `received` antes do `connection.*` que liga a conexão) é resolvido de novo na varredura, como `dueEvents` já faz (`webhook.repo.ts:49-67`) | CA |

### 3.3 Envio

| Capacidade | Hub | Mudança | Status |
|---|---|---|---|
| Texto (`src/modules/whatsapp-outbound/outbound.service.ts:34`) | `{type:"text", text:{body, previewUrl:false}}` (hub:664-677) | `buildHubBody` em `src/modules/whatsapp-outbound/hub-payload.ts` | CA |
| Mídia (`src/modules/whatsapp-outbound/media.service.ts:10-12`) | `{mediaId, caption?, filename?}`, `mediaId` do hub e da mesma conexão (hub:677) | Upload preguiçoso uma vez por `OfficialUpload` (`hubMediaId`, `hubMediaExpiresAt`), reaproveitado entre destinatários; renovar perto de expirar (margem: parâmetro). Limite de 30 uploads/min e 2 simultâneos por app, compartilhado por todas as orgs (hub:398, hub:400). `429 MEDIA_UPLOAD_BUSY` e `502 META_UNAVAILABLE` (hub:840-842) devolvem o comando a `pending` com nova tentativa; hoje um erro antes de `markSending` vira `failed` | CA |
| Template (`src/modules/whatsapp-outbound/template.ts:4-40`) | `{templateId, parameters}` (id do hub) ou `{name, language, parameters}` (hub:675); `parameters` com `header`, `body[]`, `buttons[{index, type, value}]` (hub:778-782) | Mapeador a partir do payload local. Envia por `templateId` quando há `hubTemplateId`, senão por `name`+`language`. Serialização canônica gravada em `hubRequest`: `parameters` omitido e `{}` contam como corpos diferentes (hub:778) | CA |
| Reply (`outbound.service.ts:28-30`) | `replyTo: <wamid>` (hub:677) | Mapear | CA |
| Destinatário (BSUID ou telefone, `outbound.service.ts:30`) | `to:{userId}` ou `to:{phone}`; com os dois vale o telefone (hub:677). `AUTHENTICATION` exige telefone (`400 RECIPIENT_PHONE_REQUIRED`, hub:706) | Mandar um só, preservando a preferência atual por BSUID | CA |
| Idempotência (`outbound.service.ts:65-86`) | `Idempotency-Key` única por app; mesmo corpo → `200`; corpo diferente → `409 IDEMPOTENCY_KEY_REUSED`; vale 30 dias (hub:660, hub:687). O header não está no `oa` | Chave `${orgId}:${command.id}`. Todo reenvio com corpo corrigido roda a chave (campanha já roda por tentativa, `dispatch.service.ts:30`) | CA |
| Envio síncrono com wamid (`outbound.service.ts:138-140`) | `202 {message}`; o wamid chega em `status source:"hub" accepted` (hub:660, hub:1256-1270) | `executeSend` (rota hub) termina em `sending` com `hubMessageId`. A liquidação vai para `acceptByHub`/`failByHub` (novos, sem lease, idempotentes, monotônicos): `accept` e `finishFailure` exigem o `leaseToken` (`outbound.repo.ts:108,116`), que o webhook não tem. Evento sem comando correspondente (202 perdido, ou evento antes de gravar `hubMessageId`) fica `pending` com nova tentativa. `sentAt` da bolha e `lastMessageAt` vêm do `timestamp` do evento, não de `new Date()` (`outbound.repo.ts:125,128`) | CA |
| Falha de rede ou 5xx no POST | Mesma chave e mesmo corpo é seguro (hub:687) | Reenvio automático só com `now − submittedAt` abaixo de 2 min (parâmetro) e depois de rodar de novo o `finalCheck` (conexão, campanha `running`, janela, identidade). Fora disso, `GET …/messages?idempotencyKey=<chave>` (hub:773): achou → grava `hubMessageId`/estado; não achou → `failed` "não chegou ao hub". Comando `hub` com mais de 24 h (parâmetro, sempre bem abaixo dos 30 dias da chave) sem `hubMessageId` nunca é reenviado. | CA |
| `recover` (`outbound.repo.ts:133-137`) | `GET …/messages/:id` (hub:774) | Filtra `route`. Para `hub`: `sending` sem `hubMessageId` → regra acima; com `hubMessageId` e sem evento há mais de 2 min (parâmetro) → `GET` e conciliação | CA |
| `uncertain` com wamid (`outbound.service.ts:151-161`, `knownResponses` em `outbound.repo.ts:139`) | Conciliação do hub: `accepted` com `meta.reconciled` (hub:747, hub:1270) | `acceptByHub` aceita `uncertain → accepted`; `knownResponses` filtra `route = "direct"` | C |
| `abandoned` | `status abandoned`; `accepted` com `overridesAdminResolution` vence (hub:740-747, hub:1098) | `uncertain` com `safeError: HUB_ABANDONED`; o `accepted` posterior vence | CA |
| Classificação de `uncertain` | O hub classifica `131000`/`131016`/`133004` como `uncertain` (hub:740); hoje uma resposta HTTP com esses códigos vira `failed` | Mudança de invariante documentada (§10 R4); Q7 decide se `unknown` vindo de `uncertain` do hub entra na trava de 7 dias (`campaigns.repo.ts:14`) | CA |
| Recusas síncronas | `code` decide (hub:656) | Tabela em §3.4 | CA |
| Gate de conexão (`outbound.repo.ts:51,92`, `src/modules/channel-connections/channel-connections.service.ts:43-57`, `src/modules/whatsapp-campaigns/preview.service.ts:22`) | conexão `active` | `getOfficialChannel(orgId, id)`: com `route = hub`, exige `status connected` + `hubConnectionId`; `hubErrorCode = token_expired` → `WHATSAPP_TOKEN_EXPIRED`; senão `WHATSAPP_CONNECTION_UNAVAILABLE`. `tokenEnc: {not: null}` passa a depender da rota. Substitui `getOfficialCredentials` nos 9 chamadores (§5.3) | CA |
| Janela no envio (`outbound.service.ts:23`) | `422 OUTSIDE_SERVICE_WINDOW`; `failed outside_service_window` (hub:707, hub:753) | Checagem local mantida; códigos do hub → `OFFICIAL_WINDOW_CLOSED` | C |
| Revalidação do template (`outbound.service.ts:114-119`) | `GET …/templates/:templateId` (cache; 404 em hub:872) | `definition` reconstruída no formato Meta e comparada por `templateHash`. `GET` só quando o `hubVersion` local for menor que o de um evento, ou no início/retomada de campanha: 600 req/min por chave para as rotas em geral, compartilhado por todas as orgs (hub:396). O envio tem balde próprio de 4 000/min (hub:397) | CA |
| "Aceita pela Meta" (`eloscrm-web/.../official-composer.tsx:73-75`, `inbox-thread.tsx:14,68`) | `accepted` = a Meta aceitou, `wamid` preenchido (hub:738); `held_for_quality_assessment` é pacing da Meta dentro do `accepted` (hub:743) | Texto atual continua correto. `pacing` pode ser exibido à parte | C |
| Envio manual uazapi na conversa oficial | n/a | §1.4 | C |

### 3.4 Disparos e campanhas

| Capacidade | Hub | Mudança | Status |
|---|---|---|---|
| Preview, público, parâmetros, custo estimado, trava de 7 dias (`preview.service.ts:19-115`, `campaigns.repo.ts:12-14`) | local | Nenhuma | C |
| Gate por destinatário (`src/modules/whatsapp-campaigns/gate.service.ts:9-43`) | local | Nenhuma além do hash do template | C |
| Envio inline no worker (`dispatch.service.ts:30-31`) | `202` + evento | Hoje o worker liquida `sending` como `unknown` na hora (`dispatch.service.ts:39`). Para `route = hub`: depois do `executeSend` que termina em `sending`, o worker **não** liquida; estende a lease do destinatário (função nova `extendLease` em `campaigns.repo.ts`; lease atual de 180 s em :110; extensão: parâmetro) e o destinatário continua `preparing`, segurando o slot da conexão (`campaigns.repo.ts:101`). `checkCampaign` não é chamado de novo para esse destinatário. | CA |
| Liquidação (`campaigns.repo.ts:73-79`, `holdForRetry` :83-91) | `failed {error:{code, metaCode}}` (hub:1270) | `applyHubSendStatus` em `src/modules/whatsapp-campaigns/settle.service.ts`: lê o destinatário pelo `campaignRecipientId` do comando e liquida com o `leaseToken` lido na linha (`settle`/`holdForRetry` exigem `status: "preparing"` e o token). `failed` global pausa a fila (`globalFailure`). Evento que chega depois da lease promove `unknown → sent`/`failed`. No reentry (`dispatch.service.ts:20-24`), comando `sending` com `route = hub` e `hubMessageId` faz `GET …/messages/:id` antes de liquidar | CA |
| Classificação por código (`failures.ts:10-18`, `providerErrorCode` é `Int`, decisão numérica em :27) | `errorCode` string + `metaCode` (hub:751-767) | `providerErrorCode = metaCode ?? parse("meta:<n>") ?? mapa`. Mapa: `credential_invalid→190`, `permission_denied→10`, `payment_method_required→131042`, `template_paused→132015`, `template_not_found_at_meta→132001`, `outside_service_window→131047`, `user_opted_out→131050`, `bsuid_not_supported→131062`, `marketing_disabled_on_cloud_api→131063`; `rate_limited→130429` é convenção local (hub:764 não dá código). `meta:unknown` → genérico. Internos: `connection_inactive`/`credential_unavailable` → `WHATSAPP_CONNECTION_UNAVAILABLE`; `template_not_approved` → `CAMPAIGN_TEMPLATE_CHANGED`; `media_expired` → novo upload e chave nova. Em `uncertain`, `error` vem `null` e o código só em `metaErrorCode` do `GET` (hub:1270). Rótulos do web (`eloscrm-web/.../campaign-error-labels.ts:5-27`) continuam numéricos | CA |
| Recusas síncronas no POST | Por `code` (hub:656, hub:693-708) | `409 CONNECTION_NOT_ACTIVE` → global (pausa); `422 TEMPLATE_NOT_APPROVED`, `400 TEMPLATE_PARAMETERS_MISMATCH`, `400 TEMPLATE_COMPONENT_UNSUPPORTED`, `404 TEMPLATE_NOT_FOUND` → `needs_review`; `422 OUTSIDE_SERVICE_WINDOW` → `OFFICIAL_WINDOW_CLOSED`; `410 MEDIA_EXPIRED`, `404 MEDIA_NOT_FOUND` → novo upload e chave nova; `400 MEDIA_KIND_MISMATCH` → `needs_review`; `400 RECIPIENT_PHONE_REQUIRED` → falha do destinatário; `429` → reagendar pelo `Retry-After` sem falha (hub:402; não está no `oa`). Todas são `preSubmissionFailure` (`failures.ts:32`) | CA |
| Encerrar (`campaigns.repo.ts:45-58`) | Sem rota de cancelamento (`oa`) | Sem cancelamento, o que estiver na fila `pending` do hub (vazão do número ou retry por limite da Meta, hub:736, hub:404) ainda sai depois de "Encerrar". Com 1 em voo por conexão, é no máximo 1 mensagem de campanha. O pacing da Meta (hub:743) fica fora do alcance de qualquer cancelamento | H (desejável) |
| Recibos e relatório (`campaigns.service.ts:12-28`, `failedReceipts` em `campaigns.repo.ts:118`) | `meta` cru com `errors[]` | Sem mudança (D1, D6) | C |
| Campanha no momento da virada | n/a | A virada exige nenhuma campanha `running`, `paused` ou `needs_review` na WABA, **ou** a conferência de hash de cada template pelas duas fontes sem divergência. O snapshot vem de `readTemplates` (`src/lib/whatsapp-official/graph.ts:43`) e qualquer diferença nos `components` do hub (hub:911, hub:913) leva a `CAMPAIGN_TEMPLATE_CHANGED` com "encerre e crie outra" (`campaigns.service.ts:73`) | CA |

### 3.5 Templates

| Capacidade | Hub | Mudança | Status |
|---|---|---|---|
| Sync (`outbound.service.ts:88-94` → `saveTemplates`, `outbound.repo.ts:19-35`) | `GET …/templates` paginado (cache) + `POST …/templates/sync` `202 queued\|recent`, fim só visível por `syncedAt` (hub:871-889) | `syncTemplates` (rota hub) lê a listagem inteira e também dispara `POST …/sync`, devolvendo `syncRequested: true`. Só marca `MISSING` com `syncedAt` da listagem não nulo e posterior à ativação, depois de paginar tudo. Os chamadores (`campaigns.service.ts:54,67`, `src/routes/v1/whatsapp/outbound/index.ts:43`) mantêm o contrato síncrono | CA |
| `definition` formato Graph (`prisma/schema.prisma:1256`), validada por `templateSchema` com `id: /^\d+$/` (`src/modules/whatsapp-outbound/outbound.schema.ts:14`) | `components` cru, `parameterFormat` camelCase (hub:877, hub:911); sem id Meta e sem `wabaId` (`oa`) | `definition = {id, name, language, category, status, parameter_format, components, rejected_reason}`. `outbound.schema.ts:14` passa a aceitar `^\d+$` **ou** `^hub:[A-Za-z0-9._-]+$`; sem isso, todo template novo quebra em `prepare`/`executeSend` com `ZodError` | CA |
| Chave `(organizationId, wabaId, externalId)` (`prisma/schema.prisma:1263`) | idem | Colunas `hubTemplateId`, `hubVersion`. Casamento no **primeiro contato** (sync ou evento): `hubTemplateId`, depois `(wabaId, name, language)` (índice em :1264). Template novo sem linha local: `externalId = "hub:<id>"`. Enquanto a WABA estiver `direct`, o hub só preenche `hubTemplateId`/`hubVersion` (D5) | CA |
| Status por webhook (`template-status.service.ts:17-34`) | `template.status_updated {template, event, reason, otherInfo, disableDate}`, `connectionId: null` (hub:1219, hub:1341-1343); ordenar por `version`, sem `version` = 0 (hub:1349) | `applyHubTemplate`: acha por `(org, hubTemplateId)`, depois `(wabaId, name, language)`; desconhecido → upsert com o `template` do evento, sem sync. Para descobrir a WABA, `GET …/templates/:id` em cada conexão hub da org (404 nas outras, hub:872); a WABA não fica em dois workspaces (hub:538). `DELETED → MISSING`, `REINSTATED → APPROVED` | CA |
| Edição, categoria, qualidade (não tratadas) | `template.updated {change}` (hub:1345-1347) | Atualiza `definition`/`category`; `components` → campanha vai a `needs_review` pelo hash | C |
| Criação MARKETING/UTILITY com header TEXT (`src/modules/whatsapp-templates/templates.schema.ts:3-16`, `templates.service.ts:23-29`) | `POST …/templates` (hub:891; `oa`) | Builder `{name, language, category, parameterFormat:"POSITIONAL", header?, body{text, examples}, footer?}`; sai o regex de `templates.service.ts:29`. `TEMPLATE_NAME_TAKEN` → 409; `META_UNAVAILABLE` → conferir a lista antes de repetir (hub:895-907) | CA |
| Header de mídia na criação | Recusado (hub:898) | O CRM não cria hoje: sem impacto | C |
| Botão de telefone | A prosa (hub:891) não enumera tipos; o `oa` aceita `QUICK_REPLY`, `URL`, `PHONE_NUMBER`, `COPY_CODE` | Hoje a criação não oferece; testar no dev antes de oferecer | C |
| Exclusão (`templates.service.ts:33-42`) | `DELETE …/templates/:templateId`, só aquele idioma (hub:871-875) | Usa `hubTemplateId` | CA |
| Motivo e recomendação de rejeição (`template-status.service.ts:13-14,29-31`) | Só `rejectedReason` + `otherInfo{title, description}` (hub:877, hub:1343) | `otherInfo.description` → `rejectionDetail`; recomendação some até H-D2 | H (desejável) |

### 3.6 Custos

| Capacidade | Hub | Mudança | Status |
|---|---|---|---|
| Custo por mensagem (`message-cost.repo.ts:4-45`) | `pricing` cru no `meta` do status (hub:1285-1291) | Nenhuma além das correções abaixo | C |
| `category` com hífen (`authentication-international`, hub:1415) | idem | `toUpperCase` também troca `-` por `_` (`message-cost.repo.ts:11`); o bug já existe no caminho direto | CA |
| `free_group_customer_service` (hub:1416) | idem | Na lista de gratuitos (`message-cost.repo.ts:33`) e no enum de `src/modules/whatsapp-costs/costs.schema.ts:6,13` | CA |
| `billable` obsoleto (hub:1418) | "decida por `type`" | Gratuidade derivada de `type` quando `billable` faltar (hoje depende de `billable`, `message-cost.repo.ts:13,30,33`) | CA |
| Moeda (`ChannelConnection.currency`) | `/consumption.currency`, pode ser `null` (hub:1490) | §4.1 H3 | H |
| "Reportado pela Meta" (`analytics.service.ts:20`, `CostAnalyticsSnapshot`) | `/consumption?month=` só com volume, mensal (hub:1464-1491; `oa` só tem `month`) | Rota hub: `/costs/sync` calcula `Σ volume × OfficialRate` das linhas `type: "REGULAR"` (hub:1491). `CostAnalyticsSnapshot` ganha `source` (`meta_cost` \| `computed`): hoje a chave `(org, wabaId, start, end)` (`prisma/schema.prisma:1565`) misturaria valor reportado e calculado. Textos "waba" → "número" (`costs.service.ts:75,111,115`, `eloscrm-web/lib/cost-types.ts:7,16`, `cost-dashboard.tsx:49,60`) | CA / H (desejável) |
| Franquia de 1.000/mês | `GET …/usage`, `whatsapp.usage.free_tier` (hub:1425-1458) | Opcional: aviso na aba de custos | C |

### 3.7 Manutenção e jobs

| Capacidade | Hub | Mudança | Status |
|---|---|---|---|
| Journal + replay (`src/routes/v1/whatsapp/events/index.ts:12-17`) | `GET /v1/events` (só `status` e `type`), `POST /v1/events/:deliveryId/redeliver` (hub:1137-1159) | Listagem e replay cobrem os dois journals (parâmetro `source`) | CA |
| Retenção (`src/modules/whatsapp-maintenance/retention.repo.ts:6-16`) | O hub retém 30 dias (hub:1117) | `HubWebhookEvent` no expurgo, incluindo `unsupported`, `failed` esgotado e `unresolved` sem org (hoje só `processed` com org, :7,12). `hubRequest` entra no expurgo de comandos (:13) | CA |
| Exclusão de atendimento (`src/modules/whatsapp-inbox/inbox.repo.ts:115-129`) | n/a | Limpa também `hubRequest` (:124) e `hubMediaId` (:129); `hubMediaId` permite baixar a mídia no hub por 30 dias (hub:857) | CA |
| Recuperação após indisponibilidade nossa | 8 tentativas em cerca de 22 h, depois `failed` (hub:1103-1115) | Runbook: `GET /v1/events?status=failed` → `redeliver` por `deliveryId` | CA / H (desejável) |
| Jobs (`src/server.ts:19-36`) | n/a | Novos: `scheduleHubWebhookRecovery`, `scheduleHubSendReconcile`, `scheduleHubConnectionRefresh` (diário, `GET /v1/connections`). Só iniciam com `NODE_ENV === "production"` ou `HUB_JOBS_ENABLED`. Mais tarde saem `scheduleOnboardingRecovery` e `scheduleOfficialWebhookRecovery` | CA |

### 3.8 Identidade do contato

| Capacidade | Hub | Mudança | Status |
|---|---|---|---|
| Escopo `business:<portfolio>` (`identity.repo.ts:14,20`) | `businessId` (hub:645-647) | Nenhuma | C |
| Aliases bsuid/parent_bsuid/wa_id (`message-parser.ts:17-22`) | Crus no `meta` | Nenhuma | C |
| `username` | `from.username`, telefone pode faltar (hub:647) | Sem `ContactIdentityKind` para isso (`prisma/schema.prisma:829-836`); ignorar (D2) | C |
| Nono dígito e `campaign_import` (`identity.repo.ts:22`, `src/lib/phone.ts:79-84`) | n/a | Nenhuma | C |

---

## 4. Itens a implementar no hub

### 4.1 Bloqueantes para o corte

**H1. Contrato do `meta` em `whatsapp.message.status` `source:"meta"` e versão da Graph.**
- Proposta: documentar com exemplo se o `meta` do status é o item cru (`{id, status, timestamp, recipient_id, pricing, errors, …}`) ou embrulhado (como `{message, contact}` em `received`/`echo`, hub:1244, hub:1295). Documentar a versão da Graph em que a Meta entrega os webhooks ao app do hub.
- Por quê: `receiptSchema` exige `id`, `status` e `timestamp` numérico no nível de cima (`receipts.repo.ts:8-10`); o D1 inteiro depende disso. Hoje a doc diz só "o status" (hub:1221).
- Verificação: payload real capturado no app de dev em F0.

**H2. Host estável da URL de mídia.**
- Proposta: documentar o host fixo da `url` assinada de `GET /v1/media/:id`, ou expor `GET /v1/media/:id/content` em streaming com o mesmo `Authorization`.
- Por quê: o downloader tem allowlist de host, fixa IP e recusa redirect (`media-download.ts:6-55`); sem host conhecido, não há proteção contra SSRF.

**H3. Moeda da WABA no recurso de conexão (bloqueante só para conexões novas).**
- Proposta: `whatsapp.currency` (ISO 4217) no recurso de conexão, lido na ativação e no refresh.
- Por quê: sem moeda, `addRate`/`importRates` e a conferência respondem 422 e a apuração fica `missing_currency` (`costs.service.ts:20,81,103`; `message-cost.repo.ts:29-30`). Hoje a moeda só existe em `/consumption.currency`, que pode vir `null` (hub:1490). Conexões migradas mantêm o valor gravado.
- Até lá: fuso por `/usage` (hub:1441); moeda pela `consumption` quando houver, senão a UI pede ao gestor.

**H4. Importar conexão existente sem refazer o fluxo (só se Q1 = mesmo app Meta).**
- Proposta: rota administrativa interna `POST /admin/connections/import {workspaceId, wabaId, phoneNumberId, accessToken}`, sem a chave do app; o hub valida por `debug_token`, cria como `active` e não refaz o sync.
- Com app diferente (cenário B), o item não existe.

### 4.2 Desejáveis

| Id | Proposta | Por quê | Degradação sem ele |
|---|---|---|---|
| H-D1 | `template.metaTemplateId` e `template.wabaId` no objeto de template e nos eventos `template.*` | Casar evento com template sem varrer conexões (hub:1219) e manter `externalId` homogêneo | Varredura por `GET` em cada conexão hub da org; `externalId = "hub:<id>"` em template novo |
| H-D2 | `template.rejection: {reason, recommendation}` (do `rejection_info` da Meta) | O app grava e mostra `rejectionRecommendation` (`template-status.service.ts:14,31`) | A recomendação some (Q5) |
| H-D3 | `POST /v1/connections/:id/messages/:messageId/cancel`: `200` com `state: "canceled"` só em `pending`; `409 MESSAGE_NOT_CANCELABLE` depois; emite `status source:"hub" canceled` | Fila `pending` do hub (hub:736, hub:404) | Depois de "Encerrar" ou do disable, sai no máximo o que já estava na fila do hub |
| H-D4 | `GET …/consumption?start&end&granularity=day` (até 31 dias), com `items[{date, category, type, country, tier, volume}]` | O dashboard usa período livre de até 31 dias, diário (`costs.schema.ts:4`; `cost-dashboard.tsx:46`) | Dashboard mensal (Q4) |
| H-D5 | `meta.messages[]` cru em `history.received` como contrato estável | Reaproveitar o parser cru como no D1 | Adaptador hub → item (§3.2) |
| H-D6 | `GET /v1/events` com `connectionId`, `createdAfter`, `createdBefore`; `POST /v1/events/redeliver` em lote | Hoje é um POST por `deliveryId` (hub:1137) e não há leitura de mensagens recebidas (hub:769-774) | Recuperação manual por entrega |
| H-D7 | Documentar que um `4xx` síncrono não consome a `Idempotency-Key` | Repetir com corpo corrigido sem `409 IDEMPOTENCY_KEY_REUSED` (hub:687) | O app roda a chave em todo reenvio com corpo corrigido |
| H-D8 | `clientReference` no `POST …/messages`, ecoado no objeto e em todos os `status` | Correlação direta com `OfficialSendCommand` | `202` já traz `message.id` (hub:660); 202 perdido → `GET …?idempotencyKey=` (hub:773); status com `messageId: null` → wamid (hub:1288) |
| H-D9 | Evento `whatsapp.templates.synced {wabaId, syncedAt, count}` | Fim do sync sem polling de `syncedAt` (hub:885) | Polling |
| H-D10 | `POST …/messages/:id/resolve {outcome:"not_sent"}` | Hoje só a equipe Matra encerra `uncertain` (hub:740-741) | Espera pelo `abandoned` |
| H-D11 | `whatsapp.messagingLimitTier` no recurso de conexão e evento de mudança de `qualityRating` | Diagnóstico na aba; nome em análise já aparece em `health.issues` (hub:587, hub:609) | Sem limite e sem aviso de qualidade |
| H-D12 | Marcar se o `timezone` de `/usage` é real ou o padrão `America/Sao_Paulo` (hub:1441) | Distinguir dado da Meta de default | Fuso pode estar errado em silêncio |
| H-D13 | `Idempotency-Key` e `429` no `oa` do `POST …/messages` | O `oa` só declara `connectionId` e as respostas `200, 202, 400, 404, 409, 410, 422` | Cliente escrito à mão a partir da prosa |
| H-D14 | Documentar se o `returnUrl` preserva a própria query | hub:479 só fala de `origin + pathname` | A página não depende de query no `returnUrl` |
| H-D15 | Janela com dois segredos `whsec_` válidos durante a rotação, e duas chaves `mh_live_` ativas por um tempo | A rotação existe (hub:1133) e a revogação da chave é imediata (hub:363) | O app aceita `HUB_WEBHOOK_SECRET_PREVIOUS`; a troca de chave exige deploy coordenado |

### 4.3 Operacional (não é API)
- Cadastrar com a equipe Matra o endpoint de produção, o segredo `whsec_` e a allowlist de `returnUrl` `https://<WEB_ORIGIN>/integracoes/whatsapp` (hub:65-66, hub:479).
- Segundo app consumidor para dev, com chave, túnel e `returnUrl` próprios (hub:64, hub:380-389). Não há ambiente de teste do hub e a URL é a mesma (hub:362, hub:24).
- Confirmar que o Embedded Signup do hub está na versão atual da Meta.
- Perguntar se, na migração de um número Coexistence de outro app, o cliente precisa fazer algo no celular (hub:624 diz só "nada é criado do zero").

---

## 5. Mudanças no app por módulo

### 5.1 Arquivos novos
- `src/lib/meta-hub/client.ts`: `fetch` com `redirect: "error"`, timeout e Bearer; `HubError(status, code, retryAfter, uncertain)` sem a `message` traduzida; `ensureWorkspace`, `createConnectSession`, `getConnection`, `listConnections`, `sendMessage(connId, key, body)`, `getMessage`, `findMessageByKey`, `uploadMedia`, `getMedia`, `listTemplates`, `getTemplate`, `createTemplate`, `deleteTemplate`, `requestTemplateSync`, `getConsumption`, `getUsage`, `deleteConnection`, `deactivateWorkspace`. Recusa chave fora do formato `mh_live_` antes de qualquer rede. Escrito a partir da prosa, não só do `oa` (H-D13).
- `src/lib/meta-hub/media-download.ts`: fora do cliente autenticado, sem `Authorization` (§3.2).
- `src/lib/meta-hub/webhook-auth.ts`: §5.2.
- `src/routes/webhooks/meta-hub/index.ts`; `src/routes/v1/whatsapp/hub/index.ts` (`GET /config`, `POST /connect-sessions`); rota de virada `POST /v1/whatsapp/maintenance/wabas/:wabaId/route`.
- `src/modules/meta-hub/{webhook.repo,webhook.service,dispatch.service,connection.service,history-adapter,contacts-adapter}.ts`.
- `src/modules/whatsapp-outbound/hub-payload.ts`, `src/modules/whatsapp-outbound/hub-status.service.ts` (`acceptByHub`, `failByHub`).
- `src/modules/whatsapp-campaigns/settle.service.ts` (`applyHubSendStatus`).

### 5.2 Receptor do webhook do hub
- Rota `POST /webhooks/meta-hub`, sem guards (receptor externo). Ligado sempre que `HUB_WEBHOOK_SECRET` existir, independente de `HUB_ENABLED`: desligado, o hub esgota as tentativas em cerca de 22 h (hub:1103-1115).
- Corpo: parser `parseAs: "buffer"` encapsulado (`src/routes/webhooks/whatsapp-official/index.ts:10-11`), `bodyLimit` de 16 MB (parâmetro, por causa dos lotes de histórico), `logLevel: "silent"`, rate limit por IP copiado de :12-20.
- Autenticação: valida antes do HMAC que `x-hub-timestamp` é inteiro e `x-hub-signature` é string única com prefixo `sha256=`; `|agora − ts| ≤ 300 s`; `HMAC_SHA256(secret, "${ts}.${raw}")` em hex; `timingSafeEqual` após conferir o comprimento, contra `HUB_WEBHOOK_SECRET` e `HUB_WEBHOOK_SECRET_PREVIOUS` (hub:1051-1091). Falha → `401`. Nunca logar corpo nem assinatura.
- Captura: schema tolerante `{id, type, createdAt, workspace:{id, externalId}, connectionId|null, data, meta|null}` com `looseObject`; resolução de tenant como em §2.5; `createMany({skipDuplicates:true})` por `hubEventId`.
- ACK: gravou → `200` (limite de 10 s, hub:1095); falha de gravação → `503`; nunca 3xx (hub:1096). Nenhum domínio inline antes do ACK. Com Redis, dispara o processamento sem esperar.
- Fila: BullMQ `meta-hub-webhook`, `jobId = row.id`; varredura no padrão de `webhook.service.ts:48-59`; sem `REDIS_URL`, `enqueue` executa inline (`src/lib/queue.ts:54-64`).
- Ordenação (não há fila sequencial, hub:1098):
  - `connection.*`: aplica só se `envelopeAt > hubEventAt`.
  - `template.*`: só se `version > hubVersion` (sem `version` = 0, hub:1349).
  - Eventos `source:"hub"` emitem só `accepted`, `failed`, `uncertain`, `abandoned` (hub:1256): `accepted` vence `failed`/`uncertain`; `accepted` com `overridesAdminResolution` vence `abandoned` em qualquer ordem (hub:1098, hub:1270). A ordem `pending < sending < accepted` vale só para o estado lido por `202`/`GET` (hub:736-737).
  - Mensagem e recibo: regras atuais (`ingest.repo.ts:61-71`, `receipts.repo.ts:11`).
- Despacho por `type`:

| type | Handler |
|---|---|
| `whatsapp.message.received` | `ingestMessage(conn, meta.message, contacts(meta.contact), "cloud_api", receivedAt, {hubMediaId: data.message.media?.id, fallbackName: data.message.from?.name})` |
| `whatsapp.message.echo` | `ingestMessage(..., "business_app", ...)` |
| `whatsapp.message.status` `source:"meta"` | `ingestReceipt(conn, <item cru conforme H1>, receivedAt)`; `played` → no-op `processed` |
| `whatsapp.message.status` `source:"hub"` | `acceptByHub`/`failByHub` + `applyHubSendStatus` |
| `whatsapp.media.updated` | Reenfileira a mídia da mensagem com `hubMediaId = data.id` e zera `mediaAttempts`; sem mensagem → `processed` |
| `whatsapp.history.received` | `history-adapter` → `ingestMessage(..., "history", ...)` |
| `whatsapp.contacts.synced`, `whatsapp.identity.updated` | `contacts-adapter` → `sync.repo.ts` |
| `whatsapp.template.*` | `applyHubTemplate` |
| `connection.*` com `kind:"whatsapp"` | `applyHubConnection` (D5) |
| `whatsapp.usage.free_tier` | `hubHealth.freeTier` (opcional) |
| `leadgen.*`, `kind:"lead_ads"`, `type` desconhecido | `unsupported` com 2xx (hub:1189) |

- Conexão `disabled`: conteúdo novo vira `failed OFFICIAL_CONNECTION_DISABLED`; `connection.*` e status de comandos existentes são aplicados (§3.1).
- `ingestMessage` ganha o parâmetro opcional `{hubMediaId, fallbackName}`; com `hubMediaId`, grava-o e força `officialMediaId: null`. Grava `WhatsappMessage.hubSeenAt` em toda passagem pelo caminho do hub, inclusive quando cai na dedup.

### 5.3 Módulos existentes

| Módulo | Arquivos | Mudança |
|---|---|---|
| `channel-connections` | `src/modules/channel-connections/channel-connections.service.ts:43-57`, `channel-connections.repo.ts:4-9` | `getOfficialChannel` por rota; `publicConnectionSelect` expõe `officialRoute`, `hubStatus`, `hubErrorCode`, `qualityRating` sem segredos |
| Chamadores de `getOfficialCredentials` (9) | `src/modules/whatsapp-outbound/outbound.service.ts:17,90`; `src/modules/whatsapp-templates/templates.service.ts:22,35`; `src/modules/whatsapp-outbound/media.service.ts:28`; `src/modules/whatsapp-costs/analytics.service.ts:17`; `src/modules/whatsapp-campaigns/campaigns.service.ts:66`; `src/modules/whatsapp-official/media.service.ts:24,57` | Trocar por `getOfficialChannel` com ramificação por rota. Hoje funcionam porque `tokenEnc` existe; quebrariam no corte, quando ele vira `null` |
| `whatsapp-outbound` | `outbound.repo.ts:19-35,50-51,85,92,98,107-139`, `outbound.service.ts:14-161`, `outbound.schema.ts:14`, `template.ts`, `media.service.ts` | `route` gravado em `createCommand`; filtros `route = "direct"` em `recover` e `knownResponses` (N0); ramo hub em `executeSend`; `templateSchema.id` aceita `hub:`; upload preguiçoso |
| `whatsapp-official` | `ingest.repo.ts:27-75`, `receipts.repo.ts:8-48`, `message-parser.ts`, `media.service.ts`, `media.repo.ts:7-29`, `sync.repo.ts`, `webhook.service.ts:31` | Parâmetros opcionais no ingest, `played`, dedup semântica (D6), mídia por `hubMediaId`, adaptadores, aplicação de status com conexão `disabled` |
| `whatsapp-campaigns` | `dispatch.service.ts:20-39`, `campaigns.repo.ts:73-112`, `failures.ts`, `campaigns.service.ts:54-73` | N0: reentry ignora comando `route = hub` em vez de liquidar `unknown`. Depois: não liquidar `sending` hub, `extendLease`, liquidação por evento, mapa de códigos |
| `whatsapp-templates` | `template-status.service.ts:17-34`, `templates.service.ts:22-42`, `templates.repo.ts` | N0: handler direto não sincroniza quando todas as conexões da WABA estão em `hub`. Depois: `applyHubTemplate`, CRUD pelo hub |
| `whatsapp-onboarding` | `sync-request.repo.ts:22-32`, `sync-request.service.ts:23-45` | N0: `dueConnections` exclui conexões com `officialRoute = "hub"`. Removido em F10 |
| `whatsapp-maintenance` | `lifecycle.repo.ts:20-41`, `retention.repo.ts:6-16`, `src/routes/v1/whatsapp/events/index.ts` | Disable bloqueado na convivência; virada por WABA sob os locks `whatsapp-connection` e `campaign-dispatch` (:21,25); retenção e replay dos dois journals |
| `whatsapp-inbox` | `inbox.repo.ts:124,129` | Exclusão limpa `hubRequest` e `hubMediaId` |
| `whatsapp-costs` | `message-cost.repo.ts:11,13,30,33`, `costs.schema.ts:6,13`, `analytics.service.ts`, `costs.service.ts:75,111,115` | Correções de categoria e gratuidade; cálculo por `consumption`; `CostAnalyticsSnapshot.source` |
| Purga de organização | `src/lib/auth.ts:132-133` | `DELETE` das conexões e `deactivate` do workspace no hub |
| `env` e boot | `src/env.ts`, `src/server.ts:19-36`, `.env.example`, `test/setup.ts` | `HUB_API_URL` (default `https://api.metahub.matratecnologia.com/v1`, hub:24), `HUB_API_KEY`, `HUB_WEBHOOK_SECRET`, `HUB_WEBHOOK_SECRET_PREVIOUS`, `HUB_ENABLED`, `HUB_JOBS_ENABLED`, `HUB_ONBOARDING_DEFAULT` |
| Web | `eloscrm-web/lib/types.ts:685-704`, `lib/queries/whatsapp-official.ts:12-17`, `components/whatsapp-official/{hub-connect.tsx (novo), official-signup.tsx, official-tab.tsx, lifecycle-controls.tsx:25, template-manager.tsx}`, `app/(app)/integracoes/whatsapp/page.tsx`, `lib/cost-types.ts:7,16`, `cost-dashboard.tsx:49,60` | Tipos espelhados, botão "Conectar/Migrar pelo hub", leitura do retorno, rótulos de `hubStatus`, sync "solicitado", textos de custo por número |
| Docs | `docs/whatsapp-official-integration.md:9`, `docs/2026-10-05-whatsapp-omnichannel-base-plan.md:3,113`, invariantes 19 e 20 da doc atual da integração, `AGENTS.md` | Atualizar o que hoje nega o hub, a mudança dos invariantes e a versão mínima de rollback |

---

## 6. Modelo de dados (aditivo)

Tudo aditivo: colunas nulas ou com default, nenhum valor novo de enum, tabela nova. Ordem por ambiente: `db push` em dev, depois em teste, depois em produção, **antes** de subir a imagem (`AGENTS.md:80-99`). Se pedir `--accept-data-loss`, parar.

```prisma
model Organization {
  hubWorkspaceId String? @unique
}

model ChannelConnection {
  officialRoute     String    @default("direct") // "direct" | "hub"; uazapi ignora
  hubConnectionId   String?   @unique
  hubStatus         String?   // pending|active|error|disconnected, texto do hub
  hubErrorCode      String?
  hubTokenExpiresAt DateTime? // token do app do hub; não confundir com tokenExpiresAt
  hubHealth         Json?
  qualityRating     String?
  hubEventAt        DateTime? // createdAt do último envelope connection.* aplicado
  hubCheckedAt      DateTime?
}

model OfficialSendCommand {
  route        String    @default("direct") // fixado em createCommand
  hubMessageId String?   @unique
  hubRequest   Json?     // corpo exato enviado; entra na retenção e na exclusão
  hubState     String?
  hubErrorCode String?
  submittedAt  DateTime?
  @@index([route, status, submittedAt])
}

model WhatsappMessage {
  hubMediaId String?   // officialMediaId fica NULL no caminho do hub
  hubSeenAt  DateTime? // a via do hub viu esta mensagem
  @@index([hubMediaId])
}

model OfficialDeliveryReceipt {
  hubSeenAt DateTime?
}

model OfficialUpload {
  hubMediaId        String?
  hubMediaExpiresAt DateTime?
}

model OfficialTemplate {
  hubTemplateId String?
  hubVersion    Int?
  @@unique([organizationId, hubTemplateId])
}

model CostAnalyticsSnapshot {
  source String @default("meta_cost") // "meta_cost" | "computed"
}

model HubWebhookEvent {
  id              String    @id @default(cuid())
  hubEventId      String    @unique // envelope.id
  type            String
  envelopeAt      DateTime
  hubWorkspaceId  String
  hubConnectionId String?
  organizationId  String?
  organization    Organization? @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  connectionId    String?
  connection      ChannelConnection? @relation(fields: [connectionId, organizationId], references: [id, organizationId], onDelete: Restrict)
  payload         Json
  status          OfficialWebhookStatus @default(pending) // só valores existentes
  attempts        Int       @default(0)
  leaseToken      String?
  leaseExpiresAt  DateTime?
  nextAttemptAt   DateTime  @default(now())
  lastErrorCode   String?
  itemResults     Json?
  receivedAt      DateTime  @default(now())
  processedAt     DateTime?
  payloadPurgedAt DateTime?
  @@index([status, nextAttemptAt])
  @@index([organizationId, receivedAt])
  @@index([hubConnectionId, envelopeAt])
}
```

- `CostAnalyticsSnapshot.source` precisa entrar na chave única (`prisma/schema.prisma:1565`) para não colidir valor reportado com calculado. Trocar a chave não é aditivo: fica para uma fase própria, ou a linha calculada usa uma chave separada até lá (decisão em F7).
- Índices em tabela grande (`WhatsappMessage.hubMediaId`): criar antes com `CREATE INDEX CONCURRENTLY` e o nome que o Prisma geraria, para o `db push` responder "in sync" sem lock de escrita na ingestão.
- Checagem objetiva antes da imagem: `SELECT table_name, column_name FROM information_schema.columns WHERE table_name IN (…)`, só leitura, conferindo cada coluna nova. Sem o push, quebra também o caminho direto e a uazapi, porque a imagem lê essas tabelas sem `select` (ex.: `onboarding.repo.ts:42`, `receipts.repo.ts:15`). Depois do push, replay dos eventos `failed` dos dois journals.
- Fica como legado nesta migração: `OfficialOnboarding` (sem linhas novas), `OfficialWebhookEvent` (drena e sofre retenção), `tokenEnc` (zerado só no ponto sem volta), `OfficialSyncRequest` (alimentado por `connection.sync[]` em conexões nascidas pelo hub).
- Leituras retrocompatíveis desde o primeiro commit (memória `deploy-continuo-retrocompat.md`): `OfficialSendCommand.payload` lido pela `route` do comando; `OfficialTemplate.definition` no formato Meta, com `id` numérico ou `hub:`; `WhatsappMessage.recipientIdentity` nos dois formatos atuais.
- Remoção de colunas e tabelas não é aditiva: fase F10, com `db push` próprio.

---

## 7. Migração das conexões existentes, corte e rollback

### 7.1 Exige reconexão? (Q1)

**Cenário B, app Meta diferente (o que a doc do hub descreve, hub:622-633).**
- O token atual é do app próprio e não se transfere.
- O cliente abre uma sessão do hub e, no fluxo da Meta, escolhe a WABA e o número que já existem; nada é criado do zero (hub:624). Se algo precisa ser feito no celular é pergunta ao hub (§4.3), a ensaiar no piloto.
- Durante a sobreposição, a Meta pode entregar o webhook aos dois apps (hub:627); dedup pelo wamid e envio por um caminho só.
- O histórico pode não ser reimportado (hub:633); para número migrado, o histórico já está no app.
- Conta com mais de um número Coexistence → `META_PHONE_AMBIGUOUS` (hub:632): acionar a Matra.

**Cenário A, mesmo app Meta.**
- O callback do webhook é um por app: a virada seria global, todas as orgs juntas.
- Exige H4, importar todas as conexões, trocar o callback e virar as rotas em lote. Sem convivência por conexão, sem reconexão do cliente.
- O passo de desassinar a WABA (§7.3) **não existe**: desassinaria o próprio hub.

O restante desta seção descreve o cenário B.

### 7.2 Runbook por número (cenário B)
1. **Pré-requisitos.** N0 e a imagem com o caminho hub 100% no ar (§8); texto de `lifecycle-controls.tsx:25` já trocado; conexão local `connected` com token válido e `tokenExpiresAt` além do fim previsto da convivência.
2. **Gestor abre a sessão.** "Migrar para o hub" chama `POST /v1/whatsapp/hub/connect-sessions {connectionId}`: garante o workspace, abre a sessão com `requireCoexistence: true` e grava `hubStatus: "pending"` na linha.
3. **Qualquer `connection.*` com id ainda desconhecido.** Casa por org do workspace + `phoneNumberId` + `wabaId` e confere `businessId`. Grava `hubConnectionId` e só colunas `hub*` (D5). Outra org → `failed WHATSAPP_NUMBER_UNAVAILABLE` com alerta.
4. **`connection.updated` `active`.** `hubStatus = active`. Começa a convivência: as duas vias ingerem. Mensagem deduplica por `@@unique([connectionId, providerMessageId])` (`prisma/schema.prisma:1109`); recibo pela regra semântica (D6); as duas ingestões rodam sob `withConnectionLock`. A mídia fica com quem ingeriu primeiro (`officialMediaId` ou `hubMediaId`); as duas funcionam.
5. **Convivência.** Por no mínimo 7 dias (parâmetro). Medir com SELECTs só de leitura:
   - mensagens `origin = 'cloud_api'` da conexão na janela com `hubSeenAt IS NULL` (alvo: 0);
   - recibos com `hubSeenAt IS NULL`;
   - recibos duplicados por `(externalMessageId, status)`;
   - `HubWebhookEvent` `failed`.

### 7.3 Virada e corte (por WABA)
1. **Virar a rota.** `POST /v1/whatsapp/maintenance/wabas/:wabaId/route {route:"hub"}`, só com `HUB_ENABLED`. Sob os advisory locks `whatsapp-connection:<org>:<conn>` e `campaign-dispatch:<org>:<conn>` de cada conexão da WABA (`lifecycle.repo.ts:21,25`), na mesma transação, exige:
   - todas as conexões `cloud_api` da WABA na org com `hubStatus = active`;
   - nenhum comando `direct` em `pending`/`preparing`/`sending`;
   - nenhuma campanha `running`/`paused`/`needs_review`, ou conferência de hash dos templates pelas duas fontes sem divergência (§3.4);
   - templates casados (`hubTemplateId` preenchido) por `(wabaId, name, language)`.

   A partir daí, `status`/`tokenExpiresAt`/`displayPhoneNumber`/`verifiedName`/`isOnBusinessApp` espelham o hub e o caminho direto vira no-op para essa WABA (D5). Auditoria `CONNECTED` com `operation: "hub_route"`.
2. **Ponto sem volta (por WABA).** Depois da janela estável (parâmetro) e com o critério de `hubSeenAt` em zero:
   - conferir que todas as conexões da WABA na org estão em `hub`;
   - `GET {wabaId}/subscribed_apps` com o token antigo lista **dois** apps, e o do hub é diferente de `META_WHATSAPP_APP_ID`;
   - `unsubscribeWaba(token, wabaId, expectedAppId)` (função temporária nova em `graph.ts`; hoje só existe `subscribeWaba`, `graph.ts:35`), que confere o app antes do `DELETE`;
   - zerar `tokenEnc`.

   Qualquer condição falhando → abortar. Nunca offboard, desconectar no celular ou deregister (hub:630).
3. **Legado antes do F10.** Zero comandos `direct` fora de estado terminal; os `uncertain` diretos sem wamid (que `knownResponses` nunca concilia, `outbound.repo.ts:139`, e bloqueiam a exclusão do atendimento, `inbox.repo.ts:115-116`) são encerrados por ação manual auditada. Mídia `pending`/`failed` com `officialMediaId` e sem token passa a usar `hubMediaId` quando existir.

### 7.4 Flags
- `HUB_WEBHOOK_SECRET` presente: receptor ligado.
- `HUB_ENABLED`: envio pelo hub, sessões e virada de rota.
- `HUB_JOBS_ENABLED` (ou `NODE_ENV === "production"`): jobs do hub. A chave de produção fica só no cofre da plataforma de deploy; o `.env` local recebe só a chave do app de dev, porque o `.env` da API aponta para produção (memória `env-da-api-aponta-para-producao.md`) e a URL do hub é a mesma para dev e prod (hub:24, hub:362).
- `HUB_ONBOARDING_DEFAULT` (`hub` \| `direct`): onde nasce uma conexão nova (Q2).
- Por conexão: `officialRoute`. Por comando: `route`.

### 7.5 Rollback
- **Antes do ponto sem volta:** virar a rota da WABA de volta para `direct`; esperar os comandos `hub` em voo chegarem a estado terminal (a imagem com o caminho hub continua aplicando eventos); só então reverter a imagem, e nunca abaixo de N0 (D7).
- **Imagem nova em crash loop:** reverter para N0. N0 não envia nem liquida comandos `hub` (filtros de §8 F1), e o receptor de N0 continua gravando no journal; os comandos ficam parados até a imagem voltar.
- **Depois do retorno:** anotar o horário do rollback e rodar `GET /v1/events?status=failed` → `redeliver` (hub:1137-1159) para o intervalo.
- **Depois do ponto sem volta:** voltar ao direto exige um Embedded Signup próprio, que está vencido (`docs/whatsapp-embedded-signup-implementation.md:7`). Por isso o token e a inscrição antiga ficam até o fim da convivência.

---

## 8. Fases com critério de verificação

Testes rodam com `.env.test` carregado por cima de tudo (`test/setup.ts`); nenhum teste ou script local usa o `.env` de produção.

**F0. Pré-requisitos e decisões**
1. Responder Q1 a Q8. → decisões registradas.
2. Equipe Matra: app de dev (chave, túnel, `returnUrl`) e de produção (endpoint, segredo, allowlist). → `GET /v1/me` com a chave de dev responde 200, rodado pelo usuário.
3. Pedir H1 a H3 (e H4 se Q1 = mesmo app). Capturar no app de dev um `whatsapp.message.status` real. → formato do `meta` documentado e conferido contra `receiptSchema`.
4. Trocar o texto de `lifecycle-controls.tsx:25`. → `pnpm lint && pnpm typecheck` no web.

**F1. Release N0 (expand), sem mudar comportamento**
1. Schema da §6. → `pnpm db:push`, `pnpm db:push:test`, `pnpm typecheck`, `pnpm test` verdes; em produção, checagem por `information_schema` antes da imagem.
2. Filtros `route = "direct"` em `recover` e `knownResponses` (`outbound.repo.ts:133-139`); reentry de campanha ignora comando `hub` (`dispatch.service.ts:20-24`); `dueConnections` exclui `officialRoute = "hub"`; handler de template direto vira no-op para WABA toda em `hub`; `createCommand` grava `route` lido de `officialRoute`. → testes: comando `hub` `pending` não é devolvido por `recover`; `sending` `hub` vencido não vira `uncertain`; destinatário com comando `hub` não é liquidado `unknown`.
3. Envs em `src/env.ts`; `.env.example` vazio; `test/setup.ts` força chave fora do formato `mh_live_`, segredo aleatório e `HUB_API_URL=http://127.0.0.1:9/v1`. → teste que falha se a chave de teste passar na validação do cliente.
4. Receptor `src/routes/webhooks/meta-hub/index.ts` gravando só no journal (sem domínio). → `test/meta-hub-webhook.test.ts`: assinatura válida → 200; inválida → 401; `ts` fora de ±5 min → 401; headers malformados → 401 sem calcular HMAC; segredo anterior aceito; `id` repetido → 1 linha; `type` desconhecido → 2xx `unsupported`; falha de persistência → 503; workspace desconhecido → `unresolved`; workspace da org A com conexão da org B → `unresolved`.
5. N0 em produção e estável. → registrado no `AGENTS.md` como versão mínima de rollback.

**F2. Cliente, journal e conexões**
1. `src/lib/meta-hub/client.ts`. → `test/meta-hub-client.test.ts` com spy de `fetch`: host fixo, header, `429` com `Retry-After`, 5xx/rede = `uncertain`, paginação, `redirect: "error"`.
2. Processamento do journal e `applyHubConnection` (D5). → casos: `created → active → error(token_expired) → disconnected` numa conexão nascida pelo hub; `connection.created pending` sobre linha `direct connected` não muda `status`/`tokenExpiresAt` e `createCommand` continua aceitando; reconexão por `connection.updated` com id desconhecido casa; `businessId` divergente não liga; evento velho não regride; `sync[]` com estado terminal não regride.
3. Listagem/replay dos dois journals e retenção. → `whatsapp-maintenance.test.ts` estendido, incluindo expurgo de `unsupported`, `failed` esgotado e `hubRequest`.

**F3. Onboarding pelo hub**
1. `src/routes/v1/whatsapp/hub/index.ts`. → teste com mock: corpo enviado, `returnUrl`, `requireCoexistence:true`, `url` fora do log, `409 WORKSPACE_DISABLED` mapeado.
2. Web (`hub-connect.tsx`, `page.tsx`, `whatsapp-official.ts`, `official-tab.tsx`; `official-signup.tsx` só com `HUB_ONBOARDING_DEFAULT = direct`). → `pnpm lint && pnpm typecheck && pnpm build` no web e `screenshot` da aba.

**F4. Inbound pelo hub**
1. `received`, `echo`, `status meta` (D1, D6, `played`). → portar os casos de `test/whatsapp-official-webhook.test.ts:53-317` para envelopes assinados (`test/meta-hub-inbound.test.ts`); dual-ingest com **dois payloads diferentes** para o mesmo evento (um com `conversation: null`, outro sem `billable`) gera 1 `WhatsappMessage`, 1 `OfficialDeliveryReceipt` e 1 `MessageCost` sem revisão nova; `meta.contact: null` usa `data.message.from.name`.
2. Mídia pelo hub. → `test/meta-hub-incoming-media.test.ts`: `409` não consome tentativa; `media.updated` antes da mensagem; `media.updated` zera tentativas; `410` → `failed`; sha256 divergente → `failed`; redirect recusado; host fora da allowlist recusado; nenhum `Authorization` no download.
3. Histórico, contatos e identidade. → portar `test/whatsapp-official-webhook.test.ts:168,187,241,272`; casos novos: thread com `waId: null`, `timestamp` ISO, bloco de mídia com `phase` nulo enriquecendo placeholder sem mexer em `progress`, contato só com `userId`, `user_changed_number`.
4. Templates (`applyHubTemplate`). → portar `test/whatsapp-template-status.test.ts:54-115` para `version`; desconhecido faz upsert; com WABA `direct` só grava `hubTemplateId`/`hubVersion`.
5. Automação de lead. → `test/whatsapp-inbound-automation.test.ts` com mensagem do hub: `cloud_api` cria lead; eco e histórico não.

**F5. Outbound pelo hub**
1. `getOfficialChannel` nos 9 chamadores. → testes atuais verdes para `direct`; um teste por chamador numa conexão `hub` sem `tokenEnc`.
2. `hub-payload.ts` e o ramo hub de `executeSend`. → portar os casos de `test/whatsapp-outbound.test.ts:63-259`, reescrevendo as asserções presas ao formato Graph (:131-132 destinatário, :138 reply, :144 timeout vira "reenvio idêntico dentro da janela; fora dela, consulta por chave"); upload `429` devolve a `pending`.
3. `acceptByHub`/`failByHub`, `recover`/reconcile. → `accepted` antes do status; status antes do `accepted` (`messageId: null`); evento antes de `hubMessageId` gravado fica `pending` e aplica na retentativa; `uncertain → accepted` (reconciled); `abandoned → accepted` com `overridesAdminResolution`; eco antes do `accepted` (`test/whatsapp-outbound.test.ts:200`); `sentAt` = `timestamp` do evento; comando com mais de 24 h sem `hubMessageId` não reenvia.
4. Templates CRUD e sync. → portar `test/whatsapp-template-management.test.ts:34-67`; sync parcial não marca `MISSING`; template `hub:<id>` passa em `templateSchema`; campanha `paused` criada com template da Graph retoma sem `CAMPAIGN_TEMPLATE_CHANGED` depois do sync pelo hub.
5. Web (`template-manager.tsx`: sync "solicitado"). → lint, typecheck e build.

**F6. Disparos pelo hub**
1. `dispatch.service.ts`, `campaigns.repo.ts` (`extendLease`), `settle.service.ts`. → portar `test/whatsapp-campaigns.test.ts`, incluindo a pausa por falha global (:473-545) a partir de `failed` assíncrono e de `409` síncrono; `accepted` tardio promove `unknown → sent`; retomada com chave `:<attempts>`.
2. `failures.ts`. → teste unitário da tabela de §3.4, inclusive `meta:<n>` e `meta:unknown`.
3. Header de mídia subido uma vez por campanha. → `test/whatsapp-campaign-components.test.ts` com `uploadMedia` chamado 1 vez para N destinatários.
4. Cancelamento (quando H-D3 existir). → comando `pending` no hub cancelado.

**F7. Custos**
1. Categoria com `_`, `free_group_customer_service`, gratuidade por `type`. → `test/whatsapp-costs.test.ts`.
2. `/costs/sync` pela `consumption` × tarifa, `CostAnalyticsSnapshot.source`, textos por número. → mock de `getConsumption`; ausência de tarifa ou país nunca vira zero.
3. Moeda de conexão nova. → conexão sem moeda → os 422 atuais com texto ajustado.

**F8. Migração em produção**
- Runbook de §7.2/§7.3, começando por uma conexão interna ou piloto. → por WABA: `hubConnectionId` preenchido e `hubStatus = active`; janela de convivência com `hubSeenAt IS NULL` = 0 em mensagens e recibos, zero recibos duplicados, zero `HubWebhookEvent` `failed`; depois da virada, um envio manual e um de template `accepted → delivered` com `MessageCost`.

**F9. Corte**
- Ponto sem volta por WABA (§7.3). Com todas as WABAs no hub: desligar o receptor direto e `scheduleOnboardingRecovery`. → `SELECT count(*) FROM "ChannelConnection" WHERE "tokenEnc" IS NOT NULL` = 0; zero comandos `direct` fora de estado terminal; journal direto sem `pending`/`failed` por 30 dias (parâmetro).

**F10. Limpeza (não aditiva, `db push` próprio)**
- Mover `eventHash` para `src/lib/` (uso da uazapi em `broadcasts.service.ts:16`). Remover os módulos e envs de §2.1, `OfficialOnboarding`, `tokenEnc` e os testes `whatsapp-onboarding.test.ts`, `whatsapp-official-graph.test.ts`, `whatsapp-official-media-download.test.ts`, `whatsapp-official-crypto.test.ts`. Atualizar os docs de §5.3. → `pnpm lint`, `typecheck`, `test`, `build`.

**F11 (separada). Lead Ads pelo hub.** Bloqueio de paridade no hub: `adName`/`campaignName` saem sempre `null` (hub:1392).

---

## 9. Testes

- **Infra:** `test/helpers/hub.ts` com `vi.mock("../src/lib/meta-hub/client.js")`, `signHubEvent(envelope, secret, ts)` e `hubConnectionFixture` (`officialRoute: "hub"`, sem `tokenEnc`, com `hubConnectionId`); fixture de conexão em convivência (`direct` com `hubConnectionId`); `test/helpers/official-connection.ts` estendido. Postgres real, hub mockado, como a suíte atual (`AGENTS.md`, seção de testes).
- **Portados, não descartados:** os casos de domínio presos ao formato Graph em `test/whatsapp-official-webhook.test.ts`, `test/whatsapp-outbound.test.ts`, `test/whatsapp-campaigns.test.ts`, `test/whatsapp-template-status.test.ts`, `test/whatsapp-template-management.test.ts` ganham versão por envelope do hub. Os originais ficam enquanto existir conexão `direct`.
- **Compatibilidade N0:** a imagem N0 não toca comandos `hub` (recover, reentry de campanha, `knownResponses`) e não chama Graph para conexão `hub` (sync-request, template).
- **Convivência:** evento `connection.*` não altera estado operacional de linha `direct`; dual-ingest com payloads diferentes; template do hub não cria duplicata nem `MISSING` em WABA `direct`; disable bloqueado na convivência.
- **Segurança:** assinatura, janela de tempo, headers malformados, rotação de segredo, tenant cruzado, download de mídia sem Bearer e com allowlist, `url` de sessão e de mídia fora do log.
- **LGPD:** retenção e exclusão de atendimento limpam `hubRequest` e `hubMediaId`.
- **Web:** `pnpm lint && pnpm typecheck && pnpm build` e `screenshot` da aba oficial e do dashboard de custos.

---

## 10. Riscos

**R1. Imagem antiga processando trabalho do hub.** Coberto pela release N0 (D7). Risco residual: alguém reverter abaixo de N0; mitigação é o registro no `AGENTS.md` e a ordem de rollback de §7.5.

**R2. Ponto sem volta.** Antes de desassinar e zerar o token, o rollback é virar a rota. Depois, voltar ao direto exige Embedded Signup próprio vencido. O passo é por WABA e confere os dois apps antes do `DELETE` (§7.3).

**R3. Perda de mensagens.** `DELETE` no hub, desconexão no celular ou offboard (hub:614-618, hub:630) estão fora do fluxo. Indisponibilidade nossa acima de cerca de 22 h deixa entregas `failed` no hub (hub:1103-1115): recuperação por `redeliver`. Desligar o receptor causa o mesmo, por isso ele não depende de `HUB_ENABLED`.

**R4. Mudança dos invariantes 19 e 20.** Hoje, timeout depois de submeter vira `uncertain` sem reenvio, e todo envio é revalidado antes. No hub, o reenvio com a mesma chave e o mesmo corpo é seguro enquanto a mensagem existe no hub (hub:687), mas um POST que nunca chegou vira envio novo. Regra: reenvio só dentro da janela curta e depois do `finalCheck`; fora dela, consulta por chave e nunca reenvio. Também muda a classificação de `131000`/`131016`/`133004`, que passam de `failed` a `uncertain` (hub:740). Atualizar a doc dos invariantes.

**R5. Teto de taxa compartilhado.** 600 req/min por chave para as rotas em geral, para todas as orgs (hub:396); upload 30/min e 2 simultâneos por app (hub:398, hub:400). `GET` de template, poll de envio e refresh entram nos 600. Cache por `hubVersion` e poll só como fallback.

**R6. Chave de produção em máquina local.** A URL do hub é a mesma em dev e prod (hub:24, hub:362); só a chave isola. Com a chave de produção no `.env`, um `pnpm dev` rodaria reconcile e recover contra o banco de produção. Mitigação em §7.4.

**R7. Dedup entre vias.** O item cru pode diferir entre o app próprio e o hub (D1). Mitigação: dedup semântica (D6) e medição por `hubSeenAt`.

**R8. Divergência de template na virada.** `components` do hub diferentes do snapshot Graph levam campanhas a revisão (§3.4). Mitigação: conferência de hash antes da virada.

**R9. Histórico não reimportado** em número migrado (hub:633). Aceitável; monitorar `OfficialSyncRequest` `failed` nas conexões novas.

**R10. `businessPortfolioId` mudando sem evento** (hub:600). Mudaria o escopo de identidade e duplicaria contatos (`identity.repo.ts:14,20`). O refresh detecta e marca `hubErrorCode = BUSINESS_CHANGED` com auditoria, sem sobrescrever, como faz hoje o `WHATSAPP_ASSET_CHANGED` (`onboarding.repo.ts:42-44`).

**R11. `db push` esquecido.** Atinge todas as conexões, inclusive direto e uazapi (§6). Mitigação: checagem por `information_schema` como passo obrigatório do deploy.

**R12. Rotação do segredo do webhook.** A doc não diz se o hub assina com os dois segredos na troca (hub:1133). Mitigação: o app aceita o segredo anterior; alerta quando a taxa de 401 subir.

**R13. Envio que sai depois de "Encerrar" ou do disable.** Sem H-D3, o que estiver na fila `pending` do hub sai.

---

## 11. Questões em aberto para decisão do usuário

- **Q1.** O hub usa o mesmo app Meta (`META_WHATSAPP_APP_ID`) que o eloscrm? Define o cenário A ou B (§7.1) e se H4 é bloqueante. **Indício forte de cenário A:** o README do rascunho local do hub (`matra-messaging-hub/README.md`, de 2026-09-30) declara o App ID `881452474733033`, que é o `META_WHATSAPP_APP_ID` do eloscrm em `eloscrm-api/.env.prod:36`. Falta confirmar que o hub publicado usa esse app. Se usar, o callback do webhook da Meta é um só para os dois, a virada é global (§7.1, cenário A) e H4 vira bloqueante.
- **Q2.** Conexões novas nascem pelo hub assim que F3 sai? Recomendo que sim, porque o ES v2 próprio está vencido.
- **Q3.** Manter `requireCoexistence: true`? Números só Cloud API não funcionam com a exceção manual da uazapi, que exige `isOnBusinessApp` (`uazapi-policy.repo.ts:18`).
- **Q4.** O dashboard de custos aceita passar a ser mensal e por número, ou H-D4 entra antes do corte?
- **Q5.** Perder `rejectionRecommendation` é aceitável até H-D2?
- **Q6.** Read receipts e "digitando" (hub:790-797) entram no escopo? Mudam o que o cliente final vê.
- **Q7.** Um destinatário `unknown` que veio de `uncertain` do hub (inclusive `131000`/`131016`/`133004`, hub:740) entra na trava de 7 dias (`campaigns.repo.ts:14`), como hoje, ou fica liberado para reenvio?
- **Q8.** Valores dos parâmetros de desenho: duração mínima da convivência, janela de reenvio automático, teto sem `hubMessageId`, extensão da lease do destinatário de campanha e janela estável antes do ponto sem volta.

> Criado em 2026-11-10 17:35 (-03) · Última modificação: 2026-11-10 17:35 (-03)
