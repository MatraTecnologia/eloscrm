# Plano de migração: integração oficial do WhatsApp para o Matra Meta Hub

Convenções de citação:
- `hub:N` = linha N da documentação completa do hub (`llms-full.txt`), snapshot de 2026-11-12 (tarde) de https://metahub.matratecnologia.com/llms-full.txt, sha256 `d94217c392666883e58df366c61e71e10233eff06c7a119228c2b594098a8a95`, 1747 linhas. As linhas valem só para essa versão. `oa` = `openapi.json` do hub no mesmo snapshot (https://metahub.matratecnologia.com/docs/openapi.json, sha256 `7427b1448b02053a03101b8aeabd3c0a8682d2ebfc97e3b9f8a5c3cc923a8428`).
- "Código do hub" marca o que a revisão de 2026-11-12 conferiu no repositório do hub e a doc não diz. Caminhos do hub com linha valem para o commit `3ad43b4`.
- Caminhos da API são relativos a `eloscrm-api/`; os do web começam com `eloscrm-web/`.
- Tudo foi lido sem acesso a banco ou `.env`. Afirmações marcadas **a confirmar** não se provam lendo arquivos.
- Valores marcados **(parâmetro)** são escolhas de desenho a calibrar no piloto.

**Revisão de 2026-11-12.** A versão de 2026-11-10 supunha duas vias (app próprio e hub) e um período de convivência por número. Três fatos mudaram o plano:
- O hub usa o mesmo app da Meta que o elosCRM, e a callback do app aponta para o hub desde 2026-10-23. Fonte: conferência do usuário em 2026-11-12, em que o app `881452474733033` é o `META_APP_ID` do hub e o `META_WHATSAPP_APP_ID` do elosCRM. É o caso "mesmo app da Meta" do guia de migração do hub (hub:634). O webhook próprio não recebe nada desde então, e o onboarding próprio responde `409 OFFICIAL_WEBHOOK_NOT_READY` (`src/modules/whatsapp-onboarding/onboarding.service.ts:41`).
- O elosCRM não tem conexão oficial ativa: a que existia foi desativada.
- O hub entregou em 2026-11-12 a moeda e o fuso na conexão, `metaTemplateId`/`wabaId` no template, `previous.waId` na troca de número e a documentação de H1, H2, H-D7, H-D13, H-D14 e H-D15. Na tarde do mesmo dia, o hub documentou o que muda quando o número ou a conta passa para outro workspace (hub:1701, hub:1702, hub:1704), que `previous.waId` pode vir `null` também em `user_changed_number` (hub:1703), que `currency`/`timezone` mudam sem evento (hub:1694) e tirou `additionalProperties: false` das respostas do `oa` (hub:1699).

Saíram: a convivência, a virada por WABA, o rollback por WABA, a importação de token (H4), a dedup entre vias e as colunas paralelas `hub*` de estado. A migração é uma conexão nova pelo `/connect` do hub, e o código direto vira remoção. Os eventos `orphaned` no hub desde 2026-10-23 não são recuperados (decisão do usuário).

---

## 1. Objetivo e escopo

### 1.1 Objetivo
Trocar a integração direta com a WhatsApp Cloud API pelo hub, sem mudar o contrato que o web e os módulos de domínio usam para conversas, contatos, leads, disparos, templates e custos.

### 1.2 Dentro do escopo
- Onboarding (Embedded Signup e Coexistence), token e assinatura da WABA passam para o hub.
- Recebimento de mensagens, ecos, recibos, histórico, contatos e troca de identidade pelo webhook do hub.
- Envio manual, envio de template e disparos pela API de mensagens do hub.
- Templates, mídia recebida e enviada, custos.
- Remoção do código direto, que já não funciona em produção.

### 1.3 Fora do escopo
- Lead Ads pelo hub (fase separada, §7 F6).
- Tipos de envio que o app não oferece hoje (reação, localização, interativos, sticker) e read receipt / "digitando" (Q6).
- Recuperar mensagens, recibos e histórico do intervalo entre 2026-10-23 e a conexão nova: chegaram ao hub como `orphaned` e o hub descarta o que é anterior à conexão (hub:1234). A exceção é o histórico de 180 dias: se a Meta aceitar o pedido (hub:608, hub:613), ele pode trazer mensagens desse intervalo por `history.received`, porque o hub filtra o histórico pela hora em que o recebeu, não pela data de cada mensagem (código do hub, `apps/api/src/lib/handlers/whatsapp-coexistence.ts:453`, `apps/api/src/lib/whatsapp/routing.ts:94-96`). Nada é pedido para isso, mas o que chegar é ingerido (§3.2).
- A integração uazapi não muda. Os pontos em que ela encosta na oficial estão em §1.4.

### 1.4 Pontos de contato com a uazapi
| Ponto | Onde | O que o plano garante |
|---|---|---|
| Exceção de envio manual pela uazapi na conversa oficial | `src/modules/whatsapp-inbox/uazapi-policy.repo.ts:15-21` (`legacyEligibility`, consulta em :18) e :32-38 (`resolveManualRoute`, checagem de `status`, `disabledAt`, `isOnBusinessApp`, `tokenExpiresAt` em :37 e `displayPhoneNumber` em :38) | A exceção passa a ler a linha da conexão do hub, que espelha `status`, `isOnBusinessApp` (de `whatsapp.isOnBizApp`, hub:607), `displayPhoneNumber` e `tokenExpiresAt` (§2.4). Nenhuma das duas consultas olha `tokenEnc`. `sameSenderNumber` remove `+`, espaço, parênteses, ponto e hífen (:6), o que cobre o `displayPhoneNumber` formatado do hub (hub:571). |
| Escopo de identidade `business:<portfolio>` | `uazapi-policy.repo.ts:39` | `businessPortfolioId` é gravado de `whatsapp.businessId` (hub:604) antes da primeira ingestão: nulo, toda ingestão falha com `422 OFFICIAL_IDENTITY_MISSING` (`identity.repo.ts:14`); `business:null` só aparece nesta consulta da uazapi. Depois disso nunca é sobrescrito sozinho (§9 R6). |
| Lock por portfólio | `withConnectionLock` em `src/modules/whatsapp-official/identity.repo.ts` | Os handlers do hub usam o mesmo lock. |
| `eventHash` | `src/modules/whatsapp-official/webhook.schema.ts:24`, importado por `src/modules/broadcasts/broadcasts.service.ts` | Fica em `webhook.schema.ts`. O módulo `whatsapp-official/` não é apagado: em F5 saem só os arquivos do webhook próprio (§7 F5). |
| Desativação separada | `src/modules/whatsapp-maintenance/lifecycle.repo.ts:24` (`UAZAPI_DISCONNECT_SEPARATE`) | Sem mudança. |
| Tabelas compartilhadas | `Conversation`, `WhatsappMessage`, `ChannelConnection` (`ChannelProvider` em `prisma/schema.prisma:689-692`) | Só colunas aditivas e nulas; nenhum valor de enum novo (§2.4 D2). |
| Eco da mensagem enviada pela uazapi | Eco Coexistence entra por `ingestMessage(..., "business_app")` | O eco pelo hub traz o item cru (hub:1319) e entra pelo mesmo caminho. Um cliente não oficial pode não gerar eco (hub:1321): sem eco, a mensagem da uazapi fica só como a uazapi a gravou, como hoje. |

---

## 2. Arquitetura alvo

### 2.1 O que sai do app
- Embedded Signup próprio: `src/modules/whatsapp-onboarding/`, `src/routes/v1/whatsapp/onboarding/index.ts`, `eloscrm-web/components/whatsapp-official/official-signup.tsx` e o SDK do Facebook no browser. Já não funciona: `start` e `exchange` passam por `checkSubscriptions` e respondem 409 (`onboarding.service.ts:41`).
- Webhook próprio: `src/routes/webhooks/whatsapp-official/index.ts` e, no módulo, `webhook.repo.ts`, `webhook.service.ts` e `webhook-processing.service.ts`. O journal `OfficialWebhookEvent` fica em leitura até F5. A retenção não o esvazia: só zera o `payload` de linhas `processed` (`src/modules/whatsapp-maintenance/retention.repo.ts:7,12`), e nenhum código apaga linhas dele. O expurgo é explícito em F5.3.
- Cliente Graph: `src/lib/whatsapp-official/graph.ts`, `media-download.ts`, `webhook-auth.ts` e `crypto.ts` (o `src/lib/crypto.ts` da uazapi e do Lead Ads fica).
- O que usa o token em `channel-connections`: `saveVerifiedOfficialConnection` e `getOfficialCredentials` (`src/modules/channel-connections/channel-connections.service.ts:19-57`), `findByOfficialNumber` e `findCredential` (`channel-connections.repo.ts:19-26`). O resto do módulo fica.
- Analytics da Graph: `src/modules/whatsapp-costs/analytics.service.ts:17-20`. O custo em dinheiro provavelmente nunca funcionou com esse token: a Meta recusa o custo ao token da conexão (hub:1515), e o hub registra que `COST` responde erro `10` com o token do parceiro (código do hub, `apps/api/AGENTS.md:654`). **A confirmar** em produção antes de apagar.
- Jobs `scheduleOnboardingRecovery` e `scheduleOfficialWebhookRecovery` (`src/server.ts:19-36`).
- Envs `META_WHATSAPP_*` (`src/env.ts:53-58`). O Lead Ads não depende delas.

### 2.2 O que o hub passa a fazer
- Embedded Signup e Coexistence, inclusive o pedido de sync de histórico e contatos (hub:608-613).
- Token da Meta, assinatura da WABA e registro do número.
- Envio com fila e vazão por número (hub:406), conciliação de `uncertain` (hub:753) e idempotência por `Idempotency-Key` (hub:693).
- Upload de mídia, com `mediaId` válido por 29 dias (hub:837).
- Mídia recebida: o hub baixa da Meta e entrega por URL assinada de 5 minutos, por 30 dias (hub:858, hub:863).
- Cache de templates por WABA com `version` (hub:875, hub:889).
- Saúde do número e avisos de conta (hub:615, hub:1215-1224), que hoje o app ignora.
- Volume mensal (`/consumption`) e franquia (`/usage`) (hub:1449-1515).

### 2.3 O que fica no app
- `ChannelConnection` como âncora das FKs compostas `(connectionId, organizationId)` (`prisma/schema.prisma:739`).
- Conversas, `WhatsappMessage`, `MessagingContact`/`ContactIdentity`, janela de 24 h calculada localmente, automação de lead, `OfficialSendCommand`, campanhas, templates locais, `OfficialUpload`, R2 e tabela de tarifas.

### 2.4 Decisões de desenho

**D1. Os parsers atuais recebem o item cru de `envelope.meta` onde ele existe.**
- O `meta` é contrato estável em `whatsapp.message.received`, `whatsapp.message.echo` e `whatsapp.message.status` com `source:"meta"` (hub:1232). Em `received`/`echo` o formato é `{ message, contact }`, com `contact` um objeto único ou `null` (hub:1255; código do hub): embrulhar em lista antes de `profileFor`.
- No status, o `meta` é o item de `value.statuses[]` sem embrulho, com `timestamp` em string e `pricing` com os nomes da Meta (hub:1303-1315). É o que `receiptSchema` já espera (`src/modules/whatsapp-official/receipts.repo.ts:8-10`), salvo `played`.
- Como o app da Meta é o mesmo, a versão do webhook também é: o item é o que o elosCRM recebia, mais `biz_opaque_callback_data` nos envios feitos pelo hub (hub:1303). No status de um envio feito por outro workspace (dono anterior do número) que casa por `wamid` com um envio nosso, o hub tira o `biz_opaque_callback_data` do item, e é a única alteração (hub:1232, hub:1704). Sem efeito no app: `receiptSchema` exige só `id`, `status` e `timestamp` (`receipts.repo.ts:8-10`), e nada no código lê o campo.
- Correções pontuais no caminho cru:
  - `played` vira no-op `processed` antes do `receiptSchema.parse`: não é chave de `priority` (`receipts.repo.ts:11`) nem valor de `WhatsappMessageStatus`.
  - `timestamp` do eco pode vir inteiro (a Meta documenta assim; o hub repassa como veio): `messageSchema` aceita string e número (`src/modules/whatsapp-official/message-parser.ts:8`).
  - `category` com hífen e `free_group_customer_service` (`src/modules/whatsapp-costs/message-cost.repo.ts:11,33`).
- Do `data` normalizado sai só `data.message.media.id` (id do hub; o id do `meta` é da Meta e não é baixável, hub:1232). O `fallbackName` da versão anterior saiu: `from.name` vem do mesmo casamento que `meta.contact`, e os dois são nulos juntos (código do hub).
- `history.received`, `contacts.synced` e `identity.updated` chegam com `meta: null` (código do hub; a doc diz só que o contrato é o `data`, hub:1232, e que `identity.updated` não tem `meta`, hub:1359). Precisam de adaptador do formato normalizado (§3.2).

**D2. Nenhum valor novo em enum existente.**
- O Prisma 7 lança `Value 'X' not found in enum 'Y'` ao ler um valor fora do enum gerado, quando o campo é selecionado (conferido no runtime instalado, 7.10.0).
- Ficam intocados `ChannelProvider`, `ChannelConnectionStatus` (`prisma/schema.prisma:694-699`), `OfficialSendStatus`, `WhatsappMessageStatus`, `WhatsappMessageOrigin`, `OfficialWebhookStatus` e `OfficialSyncStatus`.
- Conexão do hub continua `provider: cloud_api`, e as mensagens dela continuam `origin: "cloud_api"`, valor de que dependem a automação de lead (`src/modules/lead-automation/inbound-automation.repo.ts:16`) e o custo (`message-cost.repo.ts:5`).

**D3. Journal próprio para eventos do hub (`HubWebhookEvent`).**
- `OfficialWebhookEvent.wabaId` é NOT NULL, e os eventos de template chegam com `connectionId: null` (hub:1230). O journal antigo fica para leitura e retenção.

**D4. Transporte único: a conexão oficial é do hub.**
- Sem conexão direta viva, não há escolha de rota. Saem `officialRoute` (por conexão) e `route` (por comando) da versão anterior.
- O código de envio, mídia, template e custo troca a Graph pelo hub no lugar, sem ramificação. O gate passa a exigir `hubConnectionId` em vez de `tokenEnc` (§3.3).
- Uma conexão `cloud_api` com `hubConnectionId` nulo é legado desativado e nunca opera.

**D5. Reaproveitar a linha da mesma org; nunca criar outra para o mesmo número.**
- `phoneNumberId` é `@unique` global (`prisma/schema.prisma:712`), e a desativação local não o limpa (`lifecycle.repo.ts:38`). Uma linha nova para um número que já teve linha colidiria.
- Conversas, mensagens, comandos e identidades apontam para a conexão por FK composta com `Restrict` (`prisma/schema.prisma:739`, relação em :1133). Reaproveitar a linha mantém o histórico na mesma conversa, como o texto do web já promete (`eloscrm-web/components/whatsapp-official/lifecycle-controls.tsx:26`).
- Só entra na regra conexão com `kind: "whatsapp"`. A varredura, o refresh e o receptor descartam `kind` diferente antes dela (`lead_ads` e desconhecido, hub:603, hub:1732).
- Regra no primeiro `connection.*` com id desconhecido e `whatsapp` preenchido:
  1. Procurar `cloud_api` **sem filtrar a org**: em outra org, pelo `whatsapp.phoneNumberId` ou pelo `whatsapp.wabaId`; na org do workspace, pelo `whatsapp.phoneNumberId`. É a mesma busca do onboarding atual (`src/modules/whatsapp-onboarding/onboarding.repo.ts:38-42`). Buscar só na org deixaria o passo 4 inalcançável, e o passo 5 cairia em `P2002`, porque `phoneNumberId` é único global (`prisma/schema.prisma:712`).
  2. Achou na mesma org, com `wabaId` e `businessPortfolioId` iguais aos do hub: liga `hubConnectionId`, limpa `disabledAt` e `tokenEnc` e espelha o resto (§2.5). Antes, exige zero comandos fora de estado terminal nessa linha (§7 F0). Se a linha já tiver outro `hubConnectionId`, ele é sobrescrito: o hub só reaproveita o id enquanto a conexão antiga existe, e apaga conexões desconectadas há mais de 30 dias (hub:618, hub:620). Na mesma transação, as linhas de `OfficialSyncRequest` da conexão (únicas por `(connectionId, syncType)`, `prisma/schema.prisma:808`), que o disable deixou `failed` (`lifecycle.repo.ts:37`), são regravadas a partir do `sync[]` do hub; a regra de "estado terminal não é sobrescrito" (§3.1) vale só depois da ligação.
  3. Achou na mesma org, com `wabaId` ou `businessPortfolioId` diferente: não liga. O evento fica `failed WHATSAPP_ASSET_CHANGED`, com alerta e revisão manual, como o onboarding próprio faz hoje (`onboarding.repo.ts:43`): outro portfólio muda o escopo do BSUID e duplicaria contatos. A conexão continua viva no hub, sem `DELETE`: um `DELETE` perderia as mensagens até a reconexão (hub:624), e a revisão pode aceitar a mudança. Os eventos dessa conexão ficam `unresolved` no `HubWebhookEvent` e a varredura os aplica depois que a revisão ligar a linha; o hub guarda o evento por 30 dias para `redeliver` (hub:1125).
  4. Achou em outra org: não liga. O evento fica `failed WHATSAPP_NUMBER_UNAVAILABLE`, com alerta, mantendo a regra de produto de não liberar o número para outra imobiliária (`lifecycle-controls.tsx:26`). O app chama `DELETE /v1/connections/:id` no hub: viva, a conexão prende o número no workspace errado e impede a org dona de reconectá-lo (hub:618), e o que o `DELETE` perde (hub:624) são mensagens que o app recusaria de qualquer forma.
  5. Não achou nada: cria a linha.
- `whatsapp: null` com `kind: "whatsapp"`: acontece numa conexão `disconnected` cujo número foi conectado depois em outro workspace (hub:603, hub:1702). Com id desconhecido, não há `phoneNumberId` para a regra acima: o evento fica `processed` sem efeito e nenhuma linha é criada. Com id já ligado, aplica `status`, `hubErrorCode` e `hubEventAt` e não apaga `phoneNumberId`, `wabaId`, `displayPhoneNumber` nem os outros campos espelhados.
- As linhas antigas de outros números continuam `disabled` como histórico. A remoção de `tokenEnc` como coluna fica para F5.

**D6. Versão mínima de rollback.**
- A versão mínima de rollback é a release que estiver no ar quando F4.1 começar, com os handlers de F2 e F3. É essa versão, não M1, que fica registrada no `AGENTS.md`, valendo a partir da criação da primeira conexão no hub.
- M1 não serve: tem só o receptor e o `applyHubConnection` (§7 F1). Com uma conexão viva, os eventos de mensagem respondem 2xx como `unsupported` (§5.2) e a retenção os expurga (§3.7): a mensagem some em silêncio, sem reentrega do hub.
- Abaixo dela também não há caminho de envio para a conexão do hub. Uma imagem antiga reprovaria comando do hub no `createCommand`/`markSending`, que exigem `tokenEnc` (`src/modules/whatsapp-outbound/outbound.repo.ts:51,92`), e o `recover` global (:134-135) mexeria em comandos que não são dela.
- Não precisa de release N0 separada: antes do piloto não existe trabalho do hub para uma imagem antiga estragar.

**D7. Só número Coexistence (`requireCoexistence: true`).** Decidido em 2026-11-12 (era a Q3).
- Toda sessão de conexão pede `requireCoexistence: true` (hub:495), como o onboarding atual (`onboarding.service.ts:78-80`).
- Motivo: número só Cloud API não funciona com a exceção manual da uazapi, que exige `isOnBusinessApp` (`uazapi-policy.repo.ts:18`).

### 2.5 Mapeamentos de identidade

| Hub | App | Regra |
|---|---|---|
| Workspace (`externalId`) | `Organization` | `externalId = organization.id` (cabe em hub:448). `POST /v1/workspaces` é idempotente por `externalId` (hub:450). Grava `Organization.hubWorkspaceId`. A WABA pertence a um workspace só no hub: uma segunda org com a mesma WABA recebe `WABA_ALREADY_CONNECTED` (hub:540). |
| Conexão `kind:"whatsapp"` | `ChannelConnection` (`provider: cloud_api`) | `hubConnectionId @unique`, ligado por D5 em **qualquer** `connection.*` com id desconhecido, porque a reconexão emite `connection.updated` (hub:618). `kind` desconhecido ou `lead_ads`: `unsupported` (hub:603). `kind: "whatsapp"` com `whatsapp: null` é aceito (conexão `disconnected` cujo número foi para outro workspace, hub:603): regra em D5. |
| Tenant do evento | `organizationId` + `connectionId` | `organizationId` por `hubWorkspaceId = workspace.id`, conferido com `externalId`. `connectionId` só se `connection.organizationId` for a org do workspace; senão `unresolved`. |
| `whatsapp.businessId` | `businessPortfolioId` | Escopo do BSUID (hub:651). Gravado na ligação; depois, o hub pode mudar o valor sem evento (hub:604): a releitura diária só alerta (§9 R6). |
| `whatsapp.currency`, `whatsapp.timezone` | `currency`, `timezone` (coluna nova, IANA) | Nulos até a Meta informar, relidos todo dia pelo hub, nulos numa conexão `disconnected` cuja conta passou para outro workspace (hub:605). A releitura do hub não emite evento (hub:605, hub:1694): o valor novo chega pelo `GET` do `scheduleHubConnectionRefresh` (§3.7), que grava os dois campos. Nulo no hub não apaga o valor local. Com `timezone` nulo, o hub conta o mês de `/usage` e `/consumption` em `America/Sao_Paulo` (hub:605); os custos usam o fuso que a resposta devolve (§3.6), nunca esta coluna. `timezoneId` (`prisma/schema.prisma:716`) guarda o id numérico da Meta e fica nulo nas conexões do hub. |
| `isOnBizApp`, `displayPhoneNumber`, `verifiedName` | `isOnBusinessApp`, `displayPhoneNumber`, `verifiedName` | Espelho direto. São lidos pelo hub na conclusão e na reconexão. |
| `qualityRating` | `qualityRating` (coluna nova) | Foto do momento da conexão, não atualizada (hub:606). Na UI, o estado atual vem de `health` (hub:615). |
| `tokenExpiresAt` | `tokenExpiresAt` | Espelhar só com `status: active`. `null` significa "sem prazo" (hub:614), mas também sai `null` quando a credencial foi apagada (`token_expired`, `credential_invalid`, desconexão; código do hub): em `error`/`disconnected`, não sobrescrever. |
| `status` `active`/`pending`/`error`/`disconnected` | `connected`/`pending`/`disconnected`/`disconnected` | `errorCode` vai para `hubErrorCode`. `disabled` continua só local. `status` desconhecido não muda o estado local e o evento fica `processed` com alerta: valor novo de enum chega sem aviso (hub:1690) e nunca vira `connected`. |

---

## 3. Mapeamento capacidade → hub

Legenda: **C** = coberto; **CA** = coberto com adaptação no app; **H** = depende de item aberto no hub (§4).

### 3.1 Conexão e ciclo de vida

| Capacidade atual | Hub | Mudança no app | Status |
|---|---|---|---|
| Disponibilidade do onboarding (`GET /v1/whatsapp/onboarding/config`, hook `useOfficialOnboardingConfig` em `eloscrm-web/lib/queries/whatsapp-official.ts:12-17`) | `503 META_WEBHOOK_NOT_READY` na sessão (hub:517) | `GET /v1/whatsapp/hub/config` → `{available}` pela presença da chave | CA |
| Embedded Signup próprio (`onboarding.service.ts:29-120`) | `POST /v1/workspaces` + `POST /v1/workspaces/:id/connect-sessions {kind:"whatsapp", returnUrl, requireCoexistence:true}` → `{url}` (hub:485-505); corpo estrito (hub:497) | `POST /v1/whatsapp/hub/connect-sessions` (gestor, Origin pinado e rate limit como em `src/routes/v1/whatsapp/onboarding/index.ts:11-24`). Nenhum campo além dos três. A `url` leva token e não vai para log (hub:507) | CA |
| Retorno do popup (`official-signup.tsx:16,78-86`) | `returnUrl` sem query nem fragmento, igual à allowlist; a volta traz só `status`, `connectionId`, `code` (hub:481, hub:531-536) | O app manda exatamente `https://<WEB_ORIGIN>/integracoes/whatsapp`. A página `eloscrm-web/app/(app)/integracoes/whatsapp/page.tsx` abre na aba oficial quando houver `status` na query. Com `status=connected`, o web chama `POST /v1/whatsapp/hub/connections/:id/refresh` (gestor, guards como em `src/routes/v1/deals/index.ts`): o backend lê `GET /v1/connections/:id`, exige `connection.workspaceId === org.hubWorkspaceId` (hub:566) e `kind === "whatsapp"`, responde `404` em qualquer outro caso, aplica D5 e devolve só o `publicConnectionSelect` (`src/modules/channel-connections/channel-connections.repo.ts:4-9`). `META_PHONE_AMBIGUOUS` (hub:536, hub:540) mostra "fale com o suporte", que leva o caso à equipe Matra (hub:638). Código desconhecido = erro genérico | CA |
| Fonte da verdade da conexão | Evento `connection.created` e `GET /v1/connections` (hub:538) | No retorno `status=connected`, `GET /v1/connections/:id` e aplica (D5). Varredura `GET /v1/connections?workspaceId=` no job de refresh para id desconhecido ou `pending` parado: a emissão do evento da conclusão é best-effort no hub (código do hub). A listagem traz também `kind: "lead_ads"`: o refresh descarta `kind !== "whatsapp"` antes de D5 (hub:1732) | CA |
| Somente Coexistence (`onboarding.service.ts:78-80`) | `requireCoexistence: true` (hub:495); `COEXISTENCE_REQUIRED` só sai depois do fluxo da Meta (hub:542) | Sempre `true` (D7). Texto de erro orienta abrir um link novo e escolher o app existente | C |
| Número/WABA em outra org | `PHONE_ALREADY_CONNECTED`/`WABA_ALREADY_CONNECTED` entre workspaces (hub:540, hub:618) | D5. A recusa do hub chega só pelo retorno do navegador, sem evento (hub:618) | CA |
| `pending → connected` | `connection.created` (`pending`) → `connection.updated` (`active`) (hub:1208-1209) | `applyHubConnection`, monotônico por `createdAt` do envelope (hub:1204) | CA |
| Sync Coexistence (`OfficialSyncRequest`) | `connection.sync[] {type, status, progress, errorCode}` (hub:608-613) | `requested → accepted` (não `pending`: `pending` é "vá pedir" para `dueConnections`, `src/modules/whatsapp-onboarding/sync-request.repo.ts:30`); `accepted → accepted`; `completed → complete`; `failed + declined_by_business → declined`; `failed + sync_window_expired → expired`; `failed + sync_uncertain → uncertain`; outros `failed → failed`. `smb_app_state_sync` fica `accepted` para sempre (hub:610). Estado terminal nunca é sobrescrito. `deadlineAt` = `connection.createdAt + 24 h` (hub:608; o hub conta da conclusão, código do hub). Número que já passou pelo Coexistence do elosCRM no mesmo app pode receber `failed sync_failed:<código>`, sem afetar a conexão (hub:613, hub:639). Se a Meta aceitar, o histórico chega por `history.received` (§3.2). Desde F1, `refreshSyncProgress`, `activeSyncConnections` e `dueConnections` (`src/modules/whatsapp-onboarding/sync-request.service.ts:8-21`, `sync-request.repo.ts:27-32,40`) ignoram conexões com `hubConnectionId` não nulo: o job antigo relê o `OfficialWebhookEvent` e gravaria `receiving`/`complete`/`declined` por cima do estado vindo do hub (`sync-request.repo.ts:33-39`) | CA |
| Saúde | `health` (hub:615), `connection.updated` com `meta.health: "changed"` | `hubHealth`; exibição na aba | C |
| Qualidade | `qualityRating` é foto (hub:606) | Exibir como "na conexão", ou não exibir. Releitura: H-D11 | H (desejável) |
| Token expirando | `connection.token_expiring` (hub:1226); `error token_expired` | Aviso na aba; `credentialExpired` (`src/modules/whatsapp-inbox/inbox.service.ts:26`) passa a ler `hubErrorCode` | CA |
| Offboard e volta | `ACCOUNT_OFFBOARDED` → `error offboarded`; `ACCOUNT_RECONNECTED` só desfaz esse caso (hub:1219-1220) | `status = disconnected` e campanhas pausam pelo gate global (`WHATSAPP_CONNECTION_UNAVAILABLE`, `src/modules/whatsapp-campaigns/failures.ts:8`). Com o `active`, ficam `paused` até o gestor retomar: o `holdForRetry` passa a campanha de `running` a `paused` (`src/modules/whatsapp-campaigns/campaigns.repo.ts:89`), `claim` e `pendingCampaigns` só pegam `running` (:98, :115) e a volta é o `changeState` do gestor (`campaigns.service.ts:62-68`) | CA |
| Desconexão remota | `connection.disconnected {reason, accountEvent}` é terminal; só uma sessão nova traz a conexão de volta, com o mesmo id até 30 dias depois e com id novo depois disso, quando o hub apaga a conexão (hub:1213, hub:618, hub:620) | `status = disconnected`, com o aviso pelo `meta.reason` (hub:1213): `meta_uninstalled` (`accountEvent` `PARTNER_REMOVED` ou `PARTNER_APP_UNINSTALLED`, hub:1719) → "desconectado pelo celular ou pelo WhatsApp Manager, reconecte"; `meta_account_deleted` → "a conta do WhatsApp foi apagada", sem oferecer reconexão; `api` vem do nosso `DELETE` (purga, D5 passo 4) e não gera aviso. Id novo depois de 30 dias liga por D5 passo 2. Não reaproveita `disableConnection`, que cancela campanhas (`lifecycle.repo.ts:33`). Depois que o número é conectado em outro workspace, a conexão antiga vem com `whatsapp: null` (hub:603): o espelho mantém os campos locais (D5) | CA |
| Restrição da conta | `DISABLED_UPDATE`, `ACCOUNT_RESTRICTION`, `ACCOUNT_VIOLATION`, um evento por conexão, repetível (hub:1221) | Alerta deduplicado por `(conexão, accountEvent, dia)` (parâmetro) | CA |
| Desativar local (`lifecycle.repo.ts:20-41`) | `DELETE /v1/connections/:id` perde as mensagens do intervalo e não as recupera na reconexão (hub:620, hub:624) | Disable continua local, sem `DELETE`: o número fica preso à org, como hoje (`lifecycle-controls.tsx:26`). Eventos de status de comandos existentes continuam sendo aplicados com a conexão `disabled` (hoje `src/modules/whatsapp-official/webhook.service.ts:31` barra tudo); conteúdo novo é descartado. Sessão nova para conexão `disabled` limpa `disabledAt` no `active` | CA / H (cancelamento) |
| Orientação "Desconectar conta" (`lifecycle-controls.tsx:25-26`) | Nunca desconectar no celular, offboard ou deregister (hub:636) | Textos trocados em `24b93ee` (§7 F0.1). O segundo texto manda falar com o suporte (`lifecycle-controls.tsx:26`) e volta a apontar para "Conectar pelo hub" antes de F4.3 | CA |
| Multi-conexão por org (`prisma/schema.prisma:740`) | N conexões por workspace | Sem mudança | C |
| Moeda e fuso (`onboarding.service.ts:86`) | `whatsapp.currency`/`timezone` (hub:605) | §2.5 | C |
| Purga de organização | Conexão continua `active` no hub e prende o número | Em `purgeOrganizationAssets` (`src/modules/audit/organization-purge.service.ts:17`, chamado por `src/modules/organization/organization.service.ts:131`): `DELETE` de cada conexão (hub:620) e depois `deactivate` do workspace (hub:440), que sozinho não desconecta nada (código do hub). Cada `DELETE` captura o próprio erro e soma no `organizationPurgeFailures` (`organization-purge.service.ts:48`) para expurgo manual: `organization.service.ts:131` chama `purgeOrganizationAssets` sem o `purgeOrganizationAssetsSafely` (só `src/lib/auth.ts:133` usa o wrapper), então uma exceção ali travaria a exclusão | CA |

### 3.2 Recebimento

| Capacidade | Hub | Mudança | Status |
|---|---|---|---|
| Autenticação | `x-hub-signature: sha256=HMAC(secret, "${ts}.${raw}")`, ±5 min (hub:1062, hub:1070) | Receptor novo (§5.2) | CA |
| Dedup de entrega | `id` do envelope (hub:1105) | `HubWebhookEvent.hubEventId @unique` | CA |
| Tipos suportados (`message-parser.ts:33-54`) | `received` com `meta.message` cru (hub:1255) | `ingestMessage(conn, meta.message, [meta.contact].filter(Boolean), "cloud_api", receivedAt, {hubMediaId})` | CA |
| interactive, button, order, revoke, edit (hoje `unsupported`) | Normalizados em `data` (hub:1256) | Paridade: continuam `unsupported` | C |
| Eco do app Business | `whatsapp.message.echo`, `meta` cru; o evento não diz a origem (hub:1319-1322) | `ingestMessage(..., "business_app")`. Eco de envio feito pelo próprio app via hub dedup por wamid; a remoção do eco no aceite já existe (`outbound.repo.ts:120-124`) e passa para `acceptByHub` | CA |
| Histórico de 180 dias | `history.received` normalizado, sem `meta` (hub:1326-1342) | `history-adapter` reconstrói o item que o parser lê, por `type`: `media` → `<type>: {id, mime_type, caption, filename}` com `hubMediaId` e sem id da Meta; `context.wamid` → `context.id`; `contacts` camelCase → formato da Meta; `from`/`to` a partir de `direction` e `thread`; `timestamp` ISO → epoch em segundos (`message-parser.ts:8`). Com `thread.waId: null`, usa `thread.userId` e não força o alias `wa_id` (hoje forçado em `message-parser.ts:28-32`). Bloco com `phase/chunkOrder/progress` nulos (mídia dos últimos 14 dias, hub:1341) enriquece o `media_placeholder` sem tocar o progresso. H-D5 dispensaria o adaptador | CA / H (desejável) |
| Recusa de histórico (`2593109`) | `sync[].errorCode = declined_by_business` (hub:612) | Via `applyHubConnection`. Outros erros de histórico só vão para o log do hub: o app deixa de ver `OFFICIAL_HISTORY_FAILED` | CA |
| Contatos do app (`src/modules/whatsapp-official/sync.repo.ts:10-22`) | `whatsapp.contacts.synced`, sem `type` (hub:1346) e sem `meta` (D1); `phone` só com dígitos e `timestamp` `null` quando a Meta não manda (código do hub, `apps/api/src/lib/handlers/whatsapp-coexistence.ts:628-638,686-692`) | Função nova que recebe o contato normalizado: `phone → wa_id`, `userId → bsuid`, `parentUserId → parent_bsuid`, `fullName → displayName`. Contato só com `userId` entra por `bsuid` (hoje `ingestContactSync` exige `phone_number`, :13-14) | CA |
| Troca de BSUID (`sync.repo.ts:24-65`) | `identity.updated kind:user_changed_user_id` (hub:1359) | Adaptador monta `{user_id:{previous, current}, parent_user_id?, timestamp: <epoch>}`, omitindo `parent_user_id` quando um dos lados é `null` (`identityValue.parse(null)` lança) e tratando `previous.userId: null` como `unresolved` | CA |
| Troca de número (não existe hoje) | `kind:user_changed_number` com `previous.waId` (telefone antigo) e `current` (hub:1350-1359); `previous.waId` vem `null` quando a Meta não manda o número antigo, e evento reentregue de antes de 2026-11-12 não traz o campo (hub:1359, hub:1703) | Acha o contato por `previous.userId`, senão por `previous.waId`; sem `previous.waId`, só por `previous.userId`, e sem os dois o evento fica `unresolved`. Fecha o `wa_id` antigo (`validUntil`) só quando `previous.waId` e `current.waId` vêm preenchidos: sem o antigo não há valor para fechar, e `current.waId` sai nulo quando a Meta manda só o `user_id` novo (código do hub, `apps/api/src/lib/whatsapp/normalize/identity.ts:129-131`), o que deixaria o contato sem telefone válido. Abre `current.waId` quando vem preenchido e cria o alias `bsuid = current.userId` quando difere; com `current.waId` nulo, fica só o alias. Os dois nulos o hub não emite (:133). Sem `previous.userId`, o hub deixa a janela no registro antigo até a próxima mensagem do contato (hub:656): o app também não transfere a janela local para a identidade nova; um envio nesse intervalo cai no `422 OUTSIDE_SERVICE_WINDOW` do hub, tratado como `OFFICIAL_WINDOW_CLOSED` (§3.3). Auditoria `WEBHOOK_RECONCILED`. `kind` desconhecido → `processed` sem efeito | CA |
| Recibos (`receipts.repo.ts:8-48`) | `status source:"meta"`, `meta` = item cru (hub:1303) | `ingestReceipt(conn, envelope.meta, receivedAt)`. `played` → no-op. A dedup atual (`eventHash` do item, :42) basta: há uma entrega só | C |
| Recibo antes da mensagem | Status com `messageId: null`, não reemitido (hub:1299) | Em envio pelo hub, `providerMessageId` só é gravado no `accepted`. `acceptByHub` chama `reconcileReceipts(tx, channel, wamid)` como o `accept` faz (`outbound.repo.ts:129`) | CA |
| Mídia recebida (`src/modules/whatsapp-official/media.service.ts:16-45`) | `data.message.media.id` + `media.updated` (pode chegar antes) + `GET /v1/media/:id` → URL de 5 min; `409 MEDIA_NOT_READY`, `410 MEDIA_UNAVAILABLE`, `404` depois de 30 dias (hub:852-863) | `WhatsappMessage.hubMediaId`; `officialMediaId` forçado a nulo no `create` e no `enrichment` (`src/modules/whatsapp-official/ingest.repo.ts:31,50`); `mediaStatus` (:45) e `hasMedia` (:73,76) olham `hubMediaId`. Worker novo: `409` não conta tentativa; `410` e `404` terminais; `media.updated` com `stored` zera tentativas. Download sem `Authorization`, host `*.r2.cloudflarestorage.com`, sem redirect (hub:865), teto de bytes, `sha256` conferido com o do `GET`/`media.updated`, nunca com o do `received` (hub:865). `url` e resposta fora do log. O teto de 16 MB e a lista de 7 MIME do worker atual ficam como estão (decisão explícita: o hub aceita até 100 MB) | CA |
| Retry pelo front (`src/routes/v1/whatsapp/official-media/index.ts:17-22`) | idem | `resetMedia` aceita `hubMediaId`; `410`/`404` → `failed` com texto próprio | CA |
| Janela de 24 h (`ingest.repo.ts:67-68`) | `data.window.expiresAt` (hub:807) | Cálculo local mantido | C |
| Grupo | `groupId`, `window: null` (hub:1260) | Comportamento atual | C |
| Ordem fora de sequência | `createdAt` do envelope (hub:1106) | Handlers idempotentes e monotônicos (§5.2). Evento `unresolved` (ex.: `received` antes do `connection.*` que liga a conexão) é resolvido de novo na varredura | CA |

### 3.3 Envio

| Capacidade | Hub | Mudança | Status |
|---|---|---|---|
| Texto (`src/modules/whatsapp-outbound/outbound.service.ts:34`) | `{type:"text", text:{body, previewUrl:false}}` (hub:672) | `buildHubBody` em `src/modules/whatsapp-outbound/hub-payload.ts` | CA |
| Mídia (`src/modules/whatsapp-outbound/media.service.ts:10-12`) | Um formato estrito por tipo: `image`/`video` `{mediaId, caption?}`; `document` `{mediaId, caption?, filename?}`; `audio` `{mediaId, voice?}`; `sticker` `{mediaId}` (hub:673-676). `caption`/`filename` vazios são recusados (código do hub) | Um ramo por tipo, omitindo campo vazio. Upload preguiçoso uma vez por `OfficialUpload` (`hubMediaId`, `hubMediaExpiresAt`), reaproveitado entre destinatários da mesma conexão; novo upload perto dos 29 dias (margem: parâmetro). Limites: 30 uploads/min por chave e 2 simultâneos por app, 8 no hub inteiro (hub:400, hub:402). Qualquer `429` reagenda pelo `Retry-After` (hub:404); `502 META_UNAVAILABLE` também reagenda | CA |
| Template (`src/modules/whatsapp-outbound/template.ts:4-40`) | `{templateId, parameters}` ou `{name, language, parameters}` (hub:681, hub:786-788) | Envia por `templateId` (`hubTemplateId`). `parameters` sempre na mesma forma: omitido e `{}` são corpos diferentes para a chave (hub:784) | CA |
| Reply | `replyTo: <wamid>` (hub:683) | Mapear | CA |
| Destinatário | `to:{userId}` ou `to:{phone}`; com os dois vale o telefone; `AUTHENTICATION` exige telefone (hub:683, hub:712) | Mandar um só, preservando a preferência atual por BSUID | CA |
| Idempotência | `Idempotency-Key` única por app, 30 dias; recusa síncrona não consome a chave; depois do `202` ela fica presa ao corpo, mesmo em `failed` (hub:693). A regra do `4xx` tem teste no hub: `400` e `422` com a mesma chave, depois `202` (código do hub, `apps/api/src/v1/connections/messages.test.ts:310-339`) | Chave `${orgId}:${command.id}:${hubAttempt}` (cabe em hub:666), com `hubAttempt` novo em `OfficialSendCommand` (§6). Reenvio com corpo corrigido depois de `4xx` síncrono usa a mesma chave, e o plano depende disso. `hubAttempt` sobe só depois de um `failed` assíncrono que pede reenvio, como `media_expired` (§3.4): a chave antiga ficou presa ao corpo do `202`. No reenvio, `hubMessageId` passa a ser o da tentativa nova; evento de `source:"hub"` com outro `messageId` é da tentativa anterior, já `failed`, e fica `processed` sem efeito. Na campanha, o `holdForRetry` já desvincula o comando `failed` e a próxima tentativa nasce com outro comando, logo com outra chave (`src/modules/whatsapp-campaigns/campaigns.repo.ts:81-82,87`); o `hubAttempt` cobre o comando do envio manual, único por `messageId` (`prisma/schema.prisma:1155`) | CA |
| Envio com wamid (`outbound.service.ts:138-140`) | `202 {message}`; o wamid chega em `status source:"hub" accepted` (hub:666, hub:1267-1281) | `executeSend` termina em `sending` com `hubMessageId`. A liquidação vai para `acceptByHub`/`failByHub` (novos, sem lease, idempotentes, monotônicos): `accept` e `finishFailure` exigem `leaseToken` (`outbound.repo.ts:108,116`), que o webhook não tem. Evento antes de gravar `hubMessageId` fica `pending` e aplica na retentativa. `sentAt` e `lastMessageAt` vêm do `timestamp` do evento, não de `new Date()` (:125,128) | CA |
| Falha de rede ou 5xx no POST | Mesma chave e mesmo corpo é seguro (hub:693) | Repetir o POST com a mesma chave e o mesmo corpo é a prova sem corrida: um `GET …/messages?idempotencyKey=` vazio só prova ausência naquele instante (hub:779). Repetição automática só com `now − submittedAt` abaixo de 2 min (parâmetro) e depois do `finalCheck` (conexão, campanha `running`, janela, identidade). Fora disso, `failed` local "não confirmado pelo hub", que aceita promoção por evento posterior com o mesmo `messageId` ou `wamid` | CA |
| `recover` (`outbound.repo.ts:133-137`) | `GET …/messages/:id` (hub:780) | `sending` sem `hubMessageId` → regra acima; com `hubMessageId` e sem evento há mais de 2 min (parâmetro) → `GET` e conciliação | CA |
| `uncertain` | Conciliação pelo `biz_opaque_callback_data` (hub:753); `abandoned` só por ação da equipe Matra, sem prazo (hub:746) | `acceptByHub` aceita `uncertain → accepted`. Sem evento depois de 24 h (parâmetro, Q8), o comando vai a `failed` local com `safeError` "não confirmado pelo hub", sem esperar `abandoned`. O `failed` local é terminal para o app e ainda aceita `accepted` posterior (§5.2) | CA / H (desejável) |
| `abandoned` | `accepted` com `overridesAdminResolution` vence (hub:753, hub:1281) | `failed` local com `safeError: HUB_ABANDONED`; o `accepted` posterior ainda promove. Nos dois casos o estado terminal local muda só o `OfficialSendCommand`: a `WhatsappMessage` não vai a `failed`, porque a mensagem pode ter chegado, e o destinatário de campanha fica `unknown`, dentro da trava de 7 dias (`campaigns.repo.ts:14`, Q7). Hoje o worker trata todo comando `failed` como "não chegou à Meta": o reentry liquida o destinatário como `failed` ou pausa pelo código (`src/modules/whatsapp-campaigns/dispatch.service.ts:20-23`), e o `holdForRetry` desvincula o comando para a próxima tentativa sair com outra chave (`campaigns.repo.ts:81-82,87`). Os dois passam a reconhecer o `safeError` local (`HUB_ABANDONED`, "não confirmado pelo hub") e liquidam `unknown`, sem desvincular nem reenviar: um reenvio aqui é a mensagem de marketing duplicada que a trava existe para evitar. Efeito do estado terminal: a exclusão do atendimento deixa de travar, porque `inbox.repo.ts:115-116` bloqueia só `pending`, `preparing`, `sending` e `uncertain`, e o comando entra na retenção, que purga `accepted` e `failed` (`retention.repo.ts:8,13`) | CA |
| Classificação de `uncertain` | `131000`/`131016`/`133004` viram `uncertain` (hub:746) | Muda o invariante só para 4xx com esses códigos; com 5xx já era `uncertain` (§9 R3) | CA |
| Gate de conexão | conexão `active` (hub:660) | `getOfficialChannel(orgId, id)`: exige `status connected`, `disabledAt` nulo e `hubConnectionId`; `hubErrorCode = token_expired` → `WHATSAPP_TOKEN_EXPIRED`. Substitui `getOfficialCredentials` nos 9 chamadores (§5.3) e os filtros `tokenEnc: {not: null}` de `outbound.repo.ts:51,92` e a checagem `!channel.tokenEnc` de `src/modules/whatsapp-campaigns/preview.service.ts:22` | CA |
| Janela no envio (`outbound.service.ts:23`) | `422 OUTSIDE_SERVICE_WINDOW`; `failed outside_service_window`; `131047` vindo da Meta (hub:683, hub:713) | Checagem local mantida; os três → `OFFICIAL_WINDOW_CLOSED` | C |
| Revalidação do template (`outbound.service.ts:114-119`) | `GET …/templates/:templateId` (hub:880) | Comparação local por `version` (hub:889); `GET` só quando um evento trouxer `version` maior que `hubVersion` ou no início/retomada de campanha. Balde geral de 600/min por chave, compartilhado por todas as orgs (hub:398) | CA |
| "Aceita pela Meta" no web (`eloscrm-web/components/whatsapp-official/official-composer.tsx:73-75`, `inbox-thread.tsx:14,68`) | `accepted` = a Meta aceitou (hub:744); `pacing` à parte (hub:749) | Texto atual continua correto | C |

### 3.4 Disparos e campanhas

| Capacidade | Hub | Mudança | Status |
|---|---|---|---|
| Preview, público, parâmetros, custo estimado, trava de 7 dias (`preview.service.ts:19-115`, `src/modules/whatsapp-campaigns/campaigns.repo.ts:12-14`) | local | Nenhuma além do gate (§3.3) | C |
| Envio inline no worker (`src/modules/whatsapp-campaigns/dispatch.service.ts:30-31`) | `202` + evento | Hoje o worker liquida `sending` como `unknown` na hora (:39). Agora não liquida: estende a lease do destinatário (`extendLease`, novo em `campaigns.repo.ts`) por pelo menos 15 min (parâmetro), o teto do retry do hub antes de `failed rate_limited` (1+4+16+64+256+256+256 s com `131056`, código do hub) mais a espera de vazão. No reentry (:20-24), comando `sending` com `hubMessageId` faz `GET …/messages/:id`: `pending`/`sending` reestende a lease sem liquidar. Durante a espera, o slot por conexão (`campaigns.repo.ts:101`) segura as campanhas daquela conexão | CA |
| Liquidação (`campaigns.repo.ts:73-91`) | `failed {error:{code, metaCode}}` (hub:1281) | `applyHubSendStatus` em `src/modules/whatsapp-campaigns/settle.service.ts`: lê o destinatário pelo `campaignRecipientId` do comando e liquida com o `leaseToken` lido na linha (`settle`/`holdForRetry` exigem `preparing` e o token). Evento que chega depois da lease promove `unknown → sent`/`failed` | CA |
| Classificação por código (`failures.ts:10-32`, `providerErrorCode` `Int`) | `errorCode` + `metaCode` (hub:757-773); toda falha vinda da Meta traz `metaCode`, inclusive `rate_limited` com o último código real (código do hub) | Pausa global pela classe do `errorCode`: `credential_invalid`, `permission_denied`, `payment_method_required`, `marketing_disabled_on_cloud_api`, `rate_limited`, `connection_inactive`, `credential_unavailable`. `providerErrorCode = metaCode` (o mapa de `errorCode → número` só como fallback). `template_not_approved` → `CAMPAIGN_TEMPLATE_CHANGED`; `media_expired` → novo upload e reenvio com chave nova (comando novo pelo `holdForRetry`, ou `hubAttempt + 1` no envio manual, §3.3); `meta:unknown` → genérico. Em `uncertain`, `error` vem `null` e o código só em `metaErrorCode` do `GET` (hub:1281). Rótulos do web (`eloscrm-web/components/whatsapp-official/campaign-error-labels.ts:5-27`) continuam numéricos | CA |
| Recusas síncronas no POST | Por `code` (hub:699-714) | Cada `code` tem destino próprio, nunca o fallback `preSubmissionFailure` (`failures.ts:32`): `409 CONNECTION_NOT_ACTIVE` e `404 CONNECTION_NOT_FOUND` → pausa global; `422 TEMPLATE_NOT_APPROVED`, `400 TEMPLATE_PARAMETERS_MISMATCH`, `400 TEMPLATE_COMPONENT_UNSUPPORTED`, `404 TEMPLATE_NOT_FOUND`, `400 MEDIA_KIND_MISMATCH` → `needs_review`; `422 OUTSIDE_SERVICE_WINDOW` → `OFFICIAL_WINDOW_CLOSED`; `410 MEDIA_EXPIRED`, `404 MEDIA_NOT_FOUND` → novo upload e a mesma chave com o `mediaId` novo (recusa síncrona não consome a chave, hub:693); `400 RECIPIENT_PHONE_REQUIRED` → falha do destinatário; `409 IDEMPOTENCY_KEY_REUSED` → já existe envio com a chave: `GET ?idempotencyKey=` e adotar só se o envio achado não estiver `failed`; `failed`, ele é aplicado como o `failed` assíncrono daquela tentativa e segue a classificação acima. Nunca chave nova às cegas; `400 IDEMPOTENCY_KEY_REQUIRED` e `400` sem `code` (validação) → bug do mapeador, `needs_review` sem retry; `429` → reagendar pelo `Retry-After` sem falha | CA |
| Template na conexão recém-ativada | O cache só existe depois da sync assíncrona da ativação; até lá todo envio de template dá `404 TEMPLATE_NOT_FOUND` (código do hub) | Campanha só começa com `syncedAt` da listagem não nulo (hub:887) | CA |
| Encerrar (`campaigns.repo.ts:45-58`) | Sem cancelamento (`oa`) | O que estiver `pending` no hub ainda sai depois de "Encerrar", até cerca de 14 min depois se estiver em retry por limite. Com 1 em voo por conexão, é no máximo 1 mensagem de campanha | H (desejável) |
| Recibos e relatório (`campaigns.service.ts:12-28`, `failedReceipts` em `campaigns.repo.ts:118`) | `meta` cru com `errors[]` (hub:1301) | Sem mudança (D1) | C |

### 3.5 Templates

| Capacidade | Hub | Mudança | Status |
|---|---|---|---|
| Sync (`outbound.service.ts:88-94` → `saveTemplates`, `outbound.repo.ts:19-35`) | `GET …/templates` paginado (cache mantido pelos webhooks) + `POST …/templates/sync` → `202 {status: "queued" \| "recent", syncedAt}` (hub:879-897) | `syncTemplates` lê a listagem inteira e pede o `/sync`, devolvendo o `status`. Os chamadores (`src/modules/whatsapp-campaigns/campaigns.service.ts:54,67`, `src/routes/v1/whatsapp/outbound/index.ts:43`, `src/modules/whatsapp-templates/template-status.service.ts:21`) passam a ler o cache: "sincronizar antes de iniciar" vira "ler o cache". O `/sync` divide com criar e excluir o balde de 30/min por chave, para todas as orgs (hub:401): `429` sem `code` segue só com a listagem. `409 CREDENTIAL_UNAVAILABLE`/`CONNECTION_NOT_ACTIVE` não apagam o cache local. `MISSING` só depois de paginar tudo e com o `syncedAt` da conta posterior à ligação | CA |
| `definition` formato Graph, `templateSchema` com `id: /^\d+$/` (`src/modules/whatsapp-outbound/outbound.schema.ts:14`) | `components` cru, `parameterFormat` camelCase, `metaTemplateId` (hub:885, hub:919) | `definition = {id: metaTemplateId, name, language, category, status, parameter_format, components, rejected_reason}`. O `id` continua numérico e `templateSchema` não muda. Grava a `definition` de forma determinística (chaves fixas, `rejected_reason` normalizado) e só com `version` maior, porque o hash da campanha cobre a `definition` inteira (`preview.service.ts:112`, `gate.service.ts:30`) | CA |
| Chave `(organizationId, wabaId, externalId)` | `metaTemplateId`, `wabaId` no template e nos eventos (hub:885) | `externalId = metaTemplateId`, como hoje. Colunas `hubTemplateId`, `hubVersion`. Linha antiga da mesma org e WABA casa por `externalId` | CA |
| Status por webhook (`template-status.service.ts:17-34`) | `template.status_updated {template, event, reason, otherInfo, disableDate}`, `connectionId: null`, ordem por `version` (hub:1367, hub:1373) | `applyHubTemplate`: acha por `(org, wabaId, metaTemplateId)` com `wabaId` do próprio evento; desconhecido → upsert, sem sync. `DELETED → MISSING`, `REINSTATED → APPROVED`. `FLAGGED`, `LOCKED` e `UNARCHIVED` não sobem `version` (código do hub): o aviso de qualidade é tratado fora do filtro de `version`, sem mexer no estado. Evento reentregue de antes de 2026-11-12 sem `metaTemplateId`/`wabaId`: `GET …/templates/:id` em cada conexão da org até achar (hub:885) | CA |
| Edição, categoria, qualidade | `template.updated {change}` (hub:1371) | Atualiza `definition`/`category`; `components` → campanha vai a `needs_review` pelo hash | C |
| Criação MARKETING/UTILITY com header TEXT (`src/modules/whatsapp-templates/templates.schema.ts:3-16`, `templates.service.ts:23-29`) | `POST …/templates` (hub:899) | Builder `{name, language, category, parameterFormat:"POSITIONAL", header?, body{text, examples}, footer?}`. `templates.schema.ts` passa a recusar variáveis coladas (`{{1}}{{2}}`), que o hub recusa com `400` sem `code` (código do hub, `apps/api/src/lib/whatsapp/templates/create-schema.ts:265`; a doc lista só "sem exemplo ou fora de ordem", hub:905). Recusas: `409 TEMPLATE_NAME_TAKEN`, `403 META_PERMISSION_DENIED`, `422 META_REJECTED`, `429 META_RATE_LIMITED` (`Retry-After: 60`), `502 META_UNAVAILABLE` → conferir a lista antes de repetir (hub:903-915) | CA |
| Exclusão (`templates.service.ts:33-42`) | `DELETE …/templates/:templateId` → `204`, sem evento; `409 TEMPLATE_NOT_DELETABLE` em `DISABLED` (hub:882, hub:909) | Usa `hubTemplateId`; marca o registro local no `204`, como o `markDeleted` faz hoje | CA |
| Motivo e recomendação de rejeição (`template-status.service.ts:13-14,29-31`) | `rejectedReason` + `otherInfo{title, description}` (hub:885, hub:1367) | `otherInfo.description` → `rejectionDetail`; a recomendação some até H-D2 | H (desejável) |

### 3.6 Custos

| Capacidade | Hub | Mudança | Status |
|---|---|---|---|
| Custo por mensagem (`message-cost.repo.ts:4-45`) | `pricing` cru no `meta` do status (hub:1303) | Alimentar com o `meta`, nunca com `data.pricing`, que renomeia `pricing_model` para `model` (hub:1294) | C |
| `category` com hífen (`authentication-international`, hub:1439) | idem | `toUpperCase` também troca `-` por `_` (`message-cost.repo.ts:11`); sem isso não casa com o regex das tarifas (`src/modules/whatsapp-costs/costs.schema.ts:6`) | CA |
| `free_group_customer_service` (hub:1440) | idem | Na lista de gratuitos (`message-cost.repo.ts:33`) e no enum de `costs.schema.ts:6,13` | CA |
| `billable` obsoleto (hub:1442) | "decida por `type`" | `type: regular` = cobrada, `free_*` = grátis, nos dois ramos (`message-cost.repo.ts:13,30,33,34`); `billable` só como conferência | CA |
| Moeda | `whatsapp.currency` (hub:605) | §2.5. Sem moeda, os 422 atuais (`costs.service.ts:20`) com texto "a Meta ainda não informou a moeda" | C |
| "Reportado pela Meta" (`analytics.service.ts:20`, `CostAnalyticsSnapshot`) | `/consumption?month=` por número, mensal, só volume; `meta.items` em maiúsculas com `tier` (hub:1488-1515) | Tabela nova `CostConsumptionSnapshot` por `(organizationId, connectionId, month)`: `Σ volume × OfficialRate` das linhas `REGULAR`, com a faixa da tarifa escolhida pelo `tier` da linha (hoje `message-cost.repo.ts:37` usa só `volumeFrom: 0`). O `month` e o `timezone` gravados são os da resposta (hub:1492-1493): o hub conta no fuso da conta, ou em `America/Sao_Paulo` quando a Meta não informou o fuso e na conexão `disconnected` cuja conta ou número passou para outro workspace (hub:1465, hub:1701). Por isso o snapshot nunca usa a coluna `timezone` local, que mantém o valor antigo (§2.5). Só o `month` do pedido é calculado localmente, em `timezone ?? "America/Sao_Paulo"`, o mesmo padrão do hub (hub:605): na virada, um mês calculado em outro fuso pode levar `400 CONSUMPTION_MONTH_OUT_OF_RANGE` (hub:1488). Não mexe na chave de `CostAnalyticsSnapshot` (`prisma/schema.prisma:1565`). Textos "waba" → "número" (`costs.service.ts:75,111,115`, `eloscrm-web/lib/cost-types.ts:7,16`, `cost-dashboard.tsx:49,60`) | CA / H (desejável) |
| Franquia de 1.000/mês | `GET …/usage`, `whatsapp.usage.free_tier` (hub:1447-1482) | Opcional: aviso na aba de custos | C |

### 3.7 Manutenção e jobs

| Capacidade | Hub | Mudança | Status |
|---|---|---|---|
| Journal + replay (`src/routes/v1/whatsapp/events/index.ts:12-17`) | `GET /v1/events` (filtros `status`, `type`), `POST /v1/events/:deliveryId/redeliver` (hub:1148-1170) | Listagem e replay do `HubWebhookEvent`; o `OfficialWebhookEvent` fica só em leitura | CA |
| Retenção (`src/modules/whatsapp-maintenance/retention.repo.ts:6-16`) | O hub retém 30 dias (hub:1125) | `HubWebhookEvent` no expurgo, incluindo `unsupported`, `failed` esgotado e `unresolved` sem org. `hubRequest` entra no expurgo de comandos (:13) | CA |
| Exclusão de atendimento (`src/modules/whatsapp-inbox/inbox.repo.ts:115-129`) | Mídia no hub por 30 dias, sem exclusão sob demanda (hub:863) | Limpa também `hubRequest` (:124) e `hubMediaId` (:129). A política de privacidade do elosCRM registra que a cópia no hub sai pela retenção de 30 dias | CA |
| Recuperação após indisponibilidade nossa | 8 tentativas em cerca de 22 h (hub:1115-1123) | Runbook: `GET /v1/events?status=failed` → `redeliver` por `deliveryId`, com pausa entre os POSTs (balde de 600/min, hub:398). Para pausar o recebimento, o receptor responde `503`; nunca pedir a desativação do endpoint, que faria os eventos nascerem sem entrega (hub:1143) | CA / H (desejável) |
| Jobs (`src/server.ts:19-36`) | n/a | Novos: `scheduleHubWebhookSweep` (lê só o banco local; roda sempre), `scheduleHubSendReconcile` e `scheduleHubConnectionRefresh` (diário, `GET /v1/connections`; garante a leitura de `currency` e `timezone`, que o hub relê sem emitir evento, hub:605, e só detecta a mudança de `businessId`, §9 R6). Os dois que chamam o hub rodam só com `HUB_JOBS_ENABLED=true`, nunca derivado de `NODE_ENV` | CA |

### 3.8 Identidade do contato

| Capacidade | Hub | Mudança | Status |
|---|---|---|---|
| Escopo `business:<portfolio>` (`identity.repo.ts:14,20`) | `businessId` (hub:651) | Nenhuma | C |
| Aliases bsuid/parent_bsuid/wa_id (`message-parser.ts:17-22`) | Crus no `meta` | Nenhuma | C |
| `username` | `from.username`, telefone pode faltar (hub:653-655) | Sem `ContactIdentityKind` para isso (D2); ignorar | C |
| Nono dígito e `campaign_import` (`identity.repo.ts:22`, `src/lib/phone.ts:79-84`) | n/a | Nenhuma | C |

---

## 4. Itens abertos no hub

Entregues em 2026-11-12 e retirados desta lista: H1 (formato do `meta` do status, hub:1303), H2 (host da URL de mídia, hub:865), H3 e H-D12 (moeda e fuso, hub:605), H-D1 (`metaTemplateId`/`wabaId`, hub:885), H-D7 (chave em `4xx`, hub:693), H-D13 (`Idempotency-Key` e `429` no `oa`), H-D14 (`returnUrl`, hub:481) e H-D15 nas chaves (várias ativas, hub:365). O cliente gerado pelo `oa` pede o header como `idempotency-key`, em minúsculas (hub:1698). Na tarde de 2026-11-12, o hub também passou a documentar `whatsapp: null` (hub:1702), `previous.waId` nulo (hub:1703) e a exceção do `biz_opaque_callback_data` (hub:1704), corrigiu o fuso de `/usage` e `/consumption` depois da troca de workspace (hub:1701), testou que o `4xx` síncrono não consome a chave (código do hub, §3.3) e abriu as respostas do `oa` (hub:1699). Nenhum desses era linha desta tabela: ela não muda. H4 não se aplica: não há conexão a importar.

Nenhum item abaixo bloqueia o piloto nem a abertura: todos têm degradação aceitável.

| Id | Proposta | Por quê | Degradação sem ele | Bloqueante |
|---|---|---|---|---|
| H-D2 | `rejection_info` da Meta no template ou no `status_updated` | O app mostra `rejectionRecommendation` (`template-status.service.ts:14,31`). O hub já grava o campo, só não expõe (código do hub) | Recomendação some (Q5) | não |
| H-D3 | Cancelar envio `pending` no hub | "Encerrar" e o disable não alcançam a fila do hub | Sai no máximo o que já estava na fila (§3.4) | não |
| H-D4 | `/consumption` por período diário de até 31 dias | Dashboard usa período livre (`costs.schema.ts:4`, `cost-dashboard.tsx:46`) | Dashboard mensal (Q4) | não |
| H-D5 | Itens crus no `meta` de `history.received` | Reaproveitar o parser como em D1 | `history-adapter` por tipo (§3.2) | não |
| H-D6 | `GET /v1/events` com `connectionId` e período; redeliver em lote | Recuperação grande hoje é um POST por entrega (hub:1149) | Runbook manual com pausa | não |
| H-D8 | `clientReference` ecoado no envio e nos status | Correlação direta com `OfficialSendCommand` | `message.id` no `202`, consulta por chave, `wamid` (§3.3) | não |
| H-D9 | Evento de fim de sync de templates | Hoje o fim só é visível por polling de `syncedAt` (hub:893) | Polling com teto | não |
| H-D10 | Encerrar `uncertain` pelo `/v1` | Só a equipe Matra encerra (hub:746) | Prazo local "não confirmado" (§3.3) | não |
| H-D11 | Releitura de `quality_rating` e limite de mensagens, com evento | `qualityRating` é foto (hub:606) | A aba mostra `health` | não |
| H-D16 | Exclusão sob demanda de mídia e eventos por `wamid` | LGPD: hoje só a retenção de 30 dias apaga (hub:863, hub:1125) | Política declara os 30 dias | não |

### 4.1 Operacional (não é API)
- Cadastrar com a equipe Matra: endpoint de produção, segredo `whsec_` (gerado pelo hub, hub:1141) e a allowlist `https://<WEB_ORIGIN>/integracoes/whatsapp` (hub:67, hub:481).
- Segundo app consumidor para dev, com chave `mh_live_` própria, túnel HTTPS e `returnUrl` próprio (hub:384-389). Não há ambiente de teste (hub:363).
- Troca de chave sem janela: pedir a nova, publicar, pedir a revogação da antiga (hub:365).
- Rotação do segredo: o hub guarda um só e assina tudo com o novo (hub:1144). Publicar o segredo novo logo depois; o que for recusado volta pelas reentregas. `HUB_WEBHOOK_SECRET_PREVIOUS` só cobre o rolling deploy do próprio app (hub:1144): o runbook da rotação termina apagando a env no deploy seguinte, para um segredo vazado não continuar valendo.
- Nunca chamar `DELETE` em `subscribed_apps` da WABA: com o mesmo app da Meta, essa inscrição é a do hub, e removê-la tira o hub da conta (hub:634, hub:1711). A limpeza do legado é só apagar o token (F5).

---

## 5. Mudanças no app por módulo

### 5.1 Arquivos novos
- `src/lib/meta-hub/client.ts`: `fetch` com `redirect: "error"`, timeout e Bearer; `HubError(status, code, retryAfter, uncertain)` sem a `message` traduzida (hub:377); `ensureWorkspace`, `createConnectSession`, `getConnection`, `listConnections`, `sendMessage(connId, key, body)`, `getMessage`, `findMessageByKey`, `uploadMedia`, `getMedia`, `listTemplates`, `getTemplate`, `createTemplate`, `deleteTemplate`, `requestTemplateSync`, `getConsumption`, `getUsage`, `deleteConnection`, `deactivateWorkspace`. Tipos gerados do `oa` atual (https://metahub.matratecnologia.com/docs/openapi.json): as respostas não declaram mais `additionalProperties: false` e os corpos de pedido continuam fechados (hub:1699; no `oa` do snapshot, as 77 ocorrências estão todas em `requestBody`). A resposta não é validada em modo estrito, porque campo novo chega sem outro aviso além do changelog (hub:1690).
- `src/lib/meta-hub/media-download.ts`: fora do cliente autenticado, sem `Authorization` (§3.2).
- `src/lib/meta-hub/webhook-auth.ts`: §5.2.
- `src/routes/webhooks/meta-hub/index.ts`; `src/routes/v1/whatsapp/hub/index.ts` (`GET /config`, `POST /connect-sessions`, `POST /connections/:id/refresh`, §3.1).
- `src/modules/meta-hub/{webhook.repo,webhook.service,dispatch.service,connection.service,history-adapter,contacts-adapter,identity-adapter}.ts`.
- `src/modules/whatsapp-outbound/hub-payload.ts`, `src/modules/whatsapp-outbound/hub-status.service.ts` (`acceptByHub`, `failByHub`).
- `src/modules/whatsapp-campaigns/settle.service.ts` (`applyHubSendStatus`).

### 5.2 Receptor do webhook do hub
- Rota `POST /webhooks/meta-hub`, sem guards. Ligado sempre que `HUB_WEBHOOK_SECRET` existir.
- Corpo: parser `parseAs: "buffer"` encapsulado (`src/routes/webhooks/whatsapp-official/index.ts:10-11`), `bodyLimit` de 16 MB (parâmetro, por causa dos lotes de histórico), `logLevel: "silent"`, rate limit por IP copiado de :12-20.
- Autenticação: `x-hub-timestamp` inteiro e `x-hub-signature` string única com `sha256=` antes do HMAC; `|agora − ts| ≤ 300 s`; HMAC sobre os bytes crus; `timingSafeEqual` depois de conferir o comprimento, contra `HUB_WEBHOOK_SECRET` e `HUB_WEBHOOK_SECRET_PREVIOUS` (hub:1062-1099). Falha → `401`. Nunca logar corpo nem assinatura.
- Captura: schema tolerante `{id, type, createdAt, workspace:{id, externalId}, connectionId|null, data, meta|null}` (hub:1043-1055); tenant como em §2.5; `createMany({skipDuplicates:true})` por `hubEventId`.
- ACK: gravou → `200` (o hub espera até 10 s, hub:1103); falha de gravação → `503`; nunca 3xx (hub:1104). Nenhum domínio antes do ACK: com Redis (`queueEnabled()`), dispara o processamento sem `await`; sem Redis, fica para a varredura, que não depende de `HUB_JOBS_ENABLED`.
- Fila: BullMQ `meta-hub-webhook`, `jobId = row.id`; varredura no padrão de `src/modules/whatsapp-official/webhook.service.ts:48-59`. O hub limita a 5 entregas simultâneas por endpoint (código do hub): o ACK rápido define a vazão das rajadas de histórico.
- Ordenação (a ordem de chegada não é garantida, hub:1106):
  - `connection.*`: aplica só se `envelopeAt > hubEventAt`.
  - `template.*`: só se `version > hubVersion` (sem `version` = 0, hub:1373), salvo os avisos `FLAGGED`/`LOCKED`/`UNARCHIVED` (§3.5).
  - `source:"hub"` (`accepted`, `failed`, `uncertain`, `abandoned`, hub:1267): `uncertain < abandoned < accepted` e `uncertain < accepted`; `accepted` com `overridesAdminResolution` vence `abandoned` em qualquer ordem (hub:1281); `failed` vindo do hub é terminal e não coexiste com `accepted` no mesmo envio. O `failed` local (prazo de `uncertain`, `abandoned`, POST não confirmado, §3.3) não veio do hub e cede a um `accepted` posterior com o mesmo `messageId` ou `wamid`.
  - Mensagem e recibo: regras atuais (`ingest.repo.ts:61-71`, `receipts.repo.ts:11`).
- Despacho por `type`:

| type | Handler |
|---|---|
| `whatsapp.message.received` | `ingestMessage(conn, meta.message, [meta.contact].filter(Boolean), "cloud_api", receivedAt, {hubMediaId: data.message.media?.id})` |
| `whatsapp.message.echo` | `ingestMessage(..., "business_app", ...)` |
| `whatsapp.message.status` `source:"meta"` | `ingestReceipt(conn, envelope.meta, receivedAt)`; `played` → no-op `processed` |
| `whatsapp.message.status` `source:"hub"` | `acceptByHub`/`failByHub` + `applyHubSendStatus` |
| `whatsapp.media.updated` | Reenfileira a mídia com `hubMediaId = data.id` e zera tentativas; sem mensagem → `processed` (o `received` virá) |
| `whatsapp.history.received` | `history-adapter` → `ingestMessage(..., "history", ...)` |
| `whatsapp.contacts.synced` | `contacts-adapter` |
| `whatsapp.identity.updated` | `identity-adapter` → `sync.repo.ts` |
| `whatsapp.template.*` | `applyHubTemplate` |
| `connection.*` com `kind:"whatsapp"` | `applyHubConnection` (D5), aceitando `whatsapp: null` |
| `whatsapp.usage.free_tier` | `hubHealth.freeTier` (opcional) |
| `leadgen.*`, `kind:"lead_ads"`, `type` desconhecido | `unsupported` com 2xx (hub:1200), decidido antes da resolução de tenant para não virar `unresolved` e voltar à varredura |

- Conexão `disabled`: conteúdo novo vira `failed OFFICIAL_CONNECTION_DISABLED`; `connection.*` e status de comandos existentes são aplicados. A separação fica antes do gate atual, que hoje falha o evento inteiro.

### 5.3 Módulos existentes

| Módulo | Arquivos | Mudança |
|---|---|---|
| `channel-connections` | `channel-connections.service.ts:43-57`, `channel-connections.repo.ts:4-9` | `getOfficialChannel` (§3.3); `publicConnectionSelect` expõe `hubErrorCode`, `qualityRating`, `timezone`, sem segredos |
| Chamadores de `getOfficialCredentials` (9) | `src/modules/whatsapp-outbound/outbound.service.ts:17,90`; `src/modules/whatsapp-templates/templates.service.ts:22,35`; `src/modules/whatsapp-outbound/media.service.ts:28`; `src/modules/whatsapp-costs/analytics.service.ts:17`; `src/modules/whatsapp-campaigns/campaigns.service.ts:66`; `src/modules/whatsapp-official/media.service.ts:24,57` | Trocar por `getOfficialChannel`. Mais os filtros `tokenEnc` de `outbound.repo.ts:51,92` e `preview.service.ts:22` |
| `whatsapp-outbound` | `outbound.repo.ts:19-35,45-139`, `outbound.service.ts:14-161`, `template.ts`, `media.service.ts` | Envio pelo hub em `executeSend`, `acceptByHub`/`failByHub`, `recover` com a regra de §3.3, upload preguiçoso |
| `whatsapp-official` | `ingest.repo.ts:31-76`, `receipts.repo.ts:8-48`, `message-parser.ts:8`, `media.service.ts`, `media.repo.ts:7-29`, `sync.repo.ts`, `webhook.service.ts:31` | `hubMediaId` no ingest, `played`, `timestamp` numérico, contato normalizado, status com conexão `disabled` |
| `whatsapp-campaigns` | `dispatch.service.ts:15-42`, `campaigns.repo.ts:73-118`, `failures.ts`, `campaigns.service.ts:54-73` | Não liquidar `sending`, `extendLease`, liquidação por evento, classificação de §3.4 |
| `whatsapp-templates` | `template-status.service.ts:17-34`, `templates.service.ts:22-42`, `templates.schema.ts`, `templates.repo.ts` | `applyHubTemplate`, CRUD pelo hub, variáveis coladas recusadas |
| `whatsapp-maintenance` | `lifecycle.repo.ts:20-41`, `retention.repo.ts:6-16`, `src/routes/v1/whatsapp/events/index.ts` | Retenção e replay do journal novo |
| `whatsapp-inbox` | `inbox.repo.ts:124,129`, `inbox.service.ts:26` | Exclusão limpa `hubRequest` e `hubMediaId`; `credentialExpired` por `hubErrorCode` |
| `whatsapp-costs` | `message-cost.repo.ts:11,13,30,33,34,37`, `costs.schema.ts:6,13`, `analytics.service.ts`, `costs.service.ts:75,111,115` | Categoria, gratuidade por `type`, faixa por `tier`, `CostConsumptionSnapshot` |
| Purga de organização | `src/modules/audit/organization-purge.service.ts:17-48` | `DELETE` das conexões e `deactivate` do workspace no hub (§3.1) |
| `env` e boot | `src/env.ts`, `src/server.ts:19-36`, `.env.example`, `test/setup.ts` | `HUB_API_URL` (default `https://api.metahub.matratecnologia.com/v1`, hub:24), `HUB_API_KEY`, `HUB_WEBHOOK_SECRET`, `HUB_WEBHOOK_SECRET_PREVIOUS`, `HUB_ENABLED`, `HUB_JOBS_ENABLED` |
| Web | `eloscrm-web/lib/types.ts:685-704`, `lib/queries/whatsapp-official.ts:12-17`, `components/whatsapp-official/{hub-connect.tsx (novo), official-tab.tsx, lifecycle-controls.tsx:25-26, template-manager.tsx}`, `app/(app)/integracoes/whatsapp/page.tsx`, `lib/cost-types.ts:7,16`, `cost-dashboard.tsx:49,60` | Botão "Conectar pelo hub", leitura do retorno, estados e avisos (`offboarded`, `disconnected`, restrição, `health`), sync "solicitado", custos por número |
| Docs | `docs/whatsapp-official-integration.md:9`, `docs/2026-10-05-whatsapp-omnichannel-base-plan.md:3,113`, §9 de `docs/whatsapp-official-integration.md` (linhas 229-248), `AGENTS.md` | O que hoje nega o hub, a mudança das regras de envio da §9 e a versão mínima de rollback (D6) |

---

## 6. Modelo de dados (aditivo)

Colunas nulas ou com default, nenhum valor novo de enum, tabelas novas. `db push` em dev, teste e produção **antes** de subir a imagem (`AGENTS.md:80-99`, na raiz do repositório). Se pedir `--accept-data-loss`, parar.

```prisma
model Organization {
  hubWorkspaceId   String?  @unique
  hubWebhookEvents HubWebhookEvent[]
}

model ChannelConnection {
  hubConnectionId  String?   @unique
  hubErrorCode     String?
  hubHealth        Json?
  qualityRating    String?   // foto da conclusão (hub:606)
  timezone         String?   // IANA (hub:605); timezoneId fica para o id numérico legado
  hubEventAt       DateTime? // createdAt do último envelope connection.* aplicado
  hubCheckedAt     DateTime?
  hubWebhookEvents HubWebhookEvent[]
}

model OfficialSendCommand {
  hubMessageId String?   @unique // da tentativa atual
  hubAttempt   Int       @default(0) // compõe a Idempotency-Key (§3.3)
  hubRequest   Json?     // corpo exato enviado; entra na retenção e na exclusão
  hubState     String?
  hubErrorCode String?
  submittedAt  DateTime?
  @@index([status, submittedAt])
}

model WhatsappMessage {
  hubMediaId String? // officialMediaId fica NULL no caminho do hub
  @@index([hubMediaId])
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

model CostConsumptionSnapshot {
  id             String   @id @default(cuid())
  organizationId String
  connectionId   String
  month          String   // YYYY-MM no fuso que o hub devolve em timezone (hub:1465)
  timezone       String   // timezone da resposta do /consumption (hub:1493)
  currency       String?
  items          Json     // meta.items do /consumption
  amount         Decimal?
  fetchedAt      DateTime
  @@unique([organizationId, connectionId, month])
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
  receivedAt      DateTime  @default(now())
  processedAt     DateTime?
  payloadPurgedAt DateTime?
  @@index([status, nextAttemptAt])
  @@index([organizationId, receivedAt])
  @@index([hubConnectionId, envelopeAt])
}
```

- Únicos novos em tabela populada (`Organization.hubWorkspaceId`, `ChannelConnection.hubConnectionId`, `OfficialSendCommand.hubMessageId`, `OfficialTemplate(organizationId, hubTemplateId)`) fazem o `db push` parar pedindo `--accept-data-loss`, mesmo com a coluna toda nula. Saída no padrão do `account.issuer` (`AGENTS.md:101-127`): `ALTER TABLE … ADD COLUMN` e `CREATE UNIQUE INDEX CONCURRENTLY` com o nome que o Prisma geraria, antes do push, que então responde "in sync". O mesmo para `WhatsappMessage.hubMediaId`, por causa do lock de escrita.
- Checagem antes da imagem: `SELECT table_name, column_name FROM information_schema.columns WHERE table_name IN (…)`, só leitura. Sem o push, quebra também a uazapi, porque a imagem lê essas tabelas sem `select`.
- Legado: `OfficialOnboarding` (sem linhas novas), `OfficialWebhookEvent` (só leitura; a retenção zera payloads, não apaga linhas), `tokenEnc` (nulo nas conexões do hub), `OfficialSyncRequest` (alimentado por `connection.sync[]`). A remoção é F5 e inverte a ordem desta seção: imagem sem referências primeiro, drop por SQL depois (§7 F5).

---

## 7. Fases com critério de verificação

Testes rodam com `.env.test` por cima de tudo (`test/setup.ts`); nenhum teste ou script local usa o `.env` de produção.

**F0. Pré-requisitos**
1. Trocar os textos de `lifecycle-controls.tsx:25-26` (desconectar no celular derruba o número também no hub, hub:636; "Conectar com a Meta" aponta para um onboarding que responde 409). → `pnpm lint && pnpm typecheck` no web; deploy independente das outras fases.
   - Resultado em 2026-11-12: feito. Textos trocados em `24b93ee`. Em `6dccdba`, a aba deixou de mostrar o botão do onboarding antigo, que levava ao 409, e passou a encaminhar ao suporte (`eloscrm-web/components/whatsapp-official/official-tab.tsx:44-45`); o `OfficialSignup` (`official-signup.tsx`) fica no repositório para reversão até F5. O aviso (`official-tab.tsx:45`) e o texto de `lifecycle-controls.tsx:26` voltam a apontar para o fluxo do hub antes de F4.3 (§7 F4.3).
2. Equipe Matra: app de produção (chave, endpoint, segredo, allowlist) e app de dev (chave, túnel, `returnUrl`). → `GET /v1/me` com as duas chaves responde 200, rodado pelo usuário.
   - Resultado em 2026-11-12: o app consumidor de produção existe e `GET /v1/me` com a chave dele responde 200. Faltam o app de dev (chave `mh_live_` própria, túnel HTTPS e `returnUrl` próprio, hub:384-389; o hub não entrega chave `mh_test_`, hub:363) e a conferência da allowlist de retorno (hub:67). O endpoint de webhook do app de produção e o segredo `whsec_` (hub:66) só são cadastrados em F1, com o receptor no ar (§7 F1.5; cadastro em §4.1).
3. Estado do legado, por SELECT só de leitura rodado pelo usuário: conexões `cloud_api` por status; comandos de conexões `cloud_api` fora de estado terminal (`pending`, `preparing`, `sending`, `uncertain`); WABAs com mais de uma org. → comandos não terminais encerrados por ação manual auditada antes de D5 reaproveitar a linha (o `knownResponses` só concilia `uncertain` com `externalMessageId`, `outbound.repo.ts:139`, e os `pending` voltam ao `executeSend`, que exige token, `outbound.service.ts:160`, e eles bloqueiam a exclusão do atendimento, `inbox.repo.ts:115-116`); WABA em duas orgs decidida antes da primeira sessão.
   - Resultado em 2026-11-12: uma conexão `cloud_api`, `disabled`, sem `tokenEnc`, com `disabledAt`; nenhuma WABA em duas orgs (há uma conexão só). Quatro comandos `uncertain` de uma org, todos de campanha, sem `externalMessageId`, criados em 2026-11-10 entre 13:07 e 13:08. Nenhum caminho do app os concilia (sem `wamid`), e eles barram D5 e a exclusão do atendimento. Encerrar como `failed` com `safeError` de encerramento manual, sem mexer no `OfficialCampaignRecipient`. Na tela da campanha os quatro passam a aparecer como falha (`campaigns.service.ts:27`). Encerramento executado pelo usuário em 2026-11-12; a consulta dos comandos não terminais voltou vazia depois dele.
   - UPDATE aplicado: só em `OfficialSendCommand`, os quatro de `uncertain` para `failed`, sem `externalMessageId`. `WhatsappMessage` e `OfficialCampaignRecipient` não foram tocados; os destinatários seguem `unknown`. As mensagens ligadas seguem `pending` (**a confirmar** pela consulta abaixo): o `finishFailure` com falha incerta não toca a mensagem (`src/modules/whatsapp-outbound/outbound.repo.ts:107-112`), e o UPDATE manual não fez o que os encerramentos do app fazem, que é passar a mensagem `pending` a `failed` junto do comando (`outbound.repo.ts:111`, `src/modules/whatsapp-campaigns/campaigns.repo.ts:54`, `src/modules/whatsapp-maintenance/lifecycle.repo.ts:30`).
   - Decisão: sem UPDATE na `WhatsappMessage` enquanto a trava de 7 dias importar. `recentlyReceived` só tira da trava o destinatário cuja mensagem está `failed` (`campaigns.repo.ts:14`): passar as quatro mensagens a `failed` solta a trava que se quer manter. Custo aceito: as quatro aparecem como pendentes na conversa e no relatório, sem nada que as conclua. A trava conta 7 dias a partir do `completedAt` do destinatário (`RESEND_WINDOW_DAYS`, `src/modules/whatsapp-campaigns/preview.service.ts:18,104`) e só vale com `completedAt` preenchido: o `settle` do disparo o grava (`campaigns.repo.ts:79`), a desativação local leva o destinatário a `unknown` sem gravá-lo (`lifecycle.repo.ts:35`). A consulta abaixo mostra qual dos dois casos é o destes quatro.
   - SQL proposto, rodado pelo usuário (nós não acessamos produção). Primeiro a conferência, só leitura, que tem de devolver 4 linhas; o UPDATE é opcional, para alinhar as mensagens depois que a trava vencer (ou se `completedAt` vier nulo), em transação e só sobre `pending`. `createdAt` é `timestamp` sem fuso gravado em UTC (`DateTime` sem `@db.Timestamptz`, `eloscrm-api/prisma/schema.prisma`), daí a conversão para `America/Sao_Paulo`:

   ```sql
   -- 1. conferência: tem de devolver 4 linhas
   SELECT c.id, c."messageId", m.status AS message_status, r.status AS recipient_status, r."completedAt"
   FROM "OfficialSendCommand" c
   JOIN "WhatsappMessage" m ON m.id = c."messageId" AND m."organizationId" = c."organizationId"
   JOIN "OfficialCampaignRecipient" r ON r.id = c."campaignRecipientId" AND r."organizationId" = c."organizationId"
   WHERE c.status = 'failed'
     AND c."externalMessageId" IS NULL
     AND c."campaignRecipientId" IS NOT NULL
     AND (c."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo' >= '2026-11-10 13:07'
     AND (c."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo' < '2026-11-10 13:09';

   -- 2. opcional: espera "UPDATE 4"; com qualquer outro número, ROLLBACK em vez de COMMIT
   BEGIN;
   UPDATE "WhatsappMessage" m
   SET status = 'failed'
   FROM "OfficialSendCommand" c
   WHERE m.id = c."messageId"
     AND m."organizationId" = c."organizationId"
     AND m.status = 'pending'
     AND c.status = 'failed'
     AND c."externalMessageId" IS NULL
     AND c."campaignRecipientId" IS NOT NULL
     AND (c."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo' >= '2026-11-10 13:07'
     AND (c."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo' < '2026-11-10 13:09';
   COMMIT;
   ```

**F1. Release M1: schema, receptor e conexão**
1. Schema da §6. → índices únicos criados antes; `pnpm db:push`, `pnpm db:push:test`, `pnpm typecheck`, `pnpm test` verdes; em produção, checagem por `information_schema` antes da imagem.
2. Envs e cliente. `test/setup.ts` força chave fictícia, segredo aleatório e `HUB_API_URL=http://127.0.0.1:9/v1`. → `test/meta-hub-client.test.ts` com spy de `fetch`: host fixo, header, `429` com `Retry-After` e sem `code`, 5xx/rede = `uncertain`, paginação, `redirect: "error"`, resposta com campo desconhecido aceita.
3. Receptor. → `test/meta-hub-webhook.test.ts`: assinatura válida → 200; inválida → 401; `ts` fora de ±5 min → 401; headers malformados → 401 sem calcular HMAC; segredo anterior aceito; `id` repetido → 1 linha; `type` desconhecido → 2xx `unsupported`; falha de persistência → 503; workspace desconhecido → `unresolved`; workspace da org A com conexão da org B → `unresolved`.
4. `applyHubConnection`, onboarding pelo hub (rota de sessão, rota de refresh, `hub-connect.tsx`, `page.tsx`) e o filtro de `hubConnectionId` não nulo em `refreshSyncProgress`, `activeSyncConnections` e `dueConnections` (§3.1). → casos: `created → active → error(token_expired) → disconnected`; reconexão por `connection.updated` com id desconhecido casa; D5 reaproveita a linha `disabled` da org, inclusive com `hubConnectionId` antigo, e cria linha nova para número inédito; linha `disabled` de outra org com o mesmo `phoneNumberId`, ou com o mesmo `wabaId`, dá `WHATSAPP_NUMBER_UNAVAILABLE` e `DELETE` no hub, nunca `P2002`; mesma org com `wabaId` ou portfólio diferente dá `WHATSAPP_ASSET_CHANGED` sem `DELETE`; `connection.*` e listagem com `kind` `lead_ads` ou desconhecido não criam linha; `status` desconhecido não vira `connected`; `connection.disconnected` com `meta.reason` `api`, `meta_uninstalled` (`PARTNER_REMOVED` e `PARTNER_APP_UNINSTALLED`) e `meta_account_deleted`, cada um com o seu aviso; rota de refresh com conexão de outro workspace ou `kind` `lead_ads` → `404`, e resposta só com `publicConnectionSelect`; linha de `OfficialSyncRequest` vinda do hub não muda com o job antigo de sync rodando; `businessPortfolioId` gravado antes da primeira mensagem; evento velho não regride; `sync[]` terminal não regride; `tokenExpiresAt` não é sobrescrito com `null` em `error`; `disconnected` com `whatsapp: null` em conexão ligada não apaga os campos locais, e com id desconhecido não cria linha; corpo da sessão sem campo extra e `returnUrl` sem query. Web: `pnpm lint && pnpm typecheck && pnpm build` e `screenshot` da aba.
5. M1 em produção com `HUB_ENABLED` desligado. → nenhuma conexão no hub enquanto F2 e F3 não estiverem no ar; a versão mínima de rollback entra no `AGENTS.md` no início de F4.1 (D6).

**F2. Recebimento e envio**
1. `received`, `echo`, `status meta`. → portar os casos de `test/whatsapp-official-webhook.test.ts` para envelopes assinados (`test/meta-hub-inbound.test.ts`); `meta.contact` objeto e `null`; eco com `timestamp` numérico; `played` sem erro.
2. Mídia. → `test/meta-hub-incoming-media.test.ts`: `409` não consome tentativa; `media.updated` antes da mensagem; `410` e `404` terminais; sha256 do `GET` divergente → `failed`; redirect recusado; host fora de `*.r2.cloudflarestorage.com` recusado; nenhum `Authorization` no download.
3. Histórico, contatos e identidade. → por tipo de mensagem no `history-adapter` (texto, cada mídia, contexto, contatos, localização, `media_placeholder`); thread com `waId: null`; bloco com `phase` nulo; contato só com `userId`; `user_changed_number` com e sem `previous.userId` e com `previous.waId: null` (acha por `previous.userId`, não fecha `wa_id`); `current.waId: null` (não fecha `wa_id`, só cria o alias); envio logo depois de `user_changed_number` sem `previous.userId`; `kind` desconhecido; reingestão: `history.received` com `wamid` já gravado na linha reaproveitada por D5 não duplica nem reordena a conversa.
4. Envio (`getOfficialChannel` nos chamadores, `hub-payload.ts`, `executeSend`, `acceptByHub`/`failByHub`, `recover`). → portar `test/whatsapp-outbound.test.ts`; um formato por tipo de mídia, sem campo vazio; `accepted` antes e depois do status; evento antes de `hubMessageId` aplica na retentativa; `uncertain → accepted`; `abandoned → accepted` com `overridesAdminResolution`; `sentAt` = `timestamp` do evento; recibo antes do `accepted` reconciliado; POST repetido com a mesma chave dentro da janela; fora dela, `failed` local promovido por evento posterior; `4xx` síncrono repetido com a mesma chave e o corpo corrigido; `media_expired` no envio manual reenvia com `hubAttempt + 1` e ignora evento da tentativa anterior; `409 IDEMPOTENCY_KEY_REUSED` com envio achado `failed` não é adotado; `uncertain` vencido e `abandoned` vão a `failed` local, liberam a exclusão do atendimento e entram na retenção, sem levar a mensagem a `failed`.
5. Templates. → portar `test/whatsapp-template-status.test.ts` e `test/whatsapp-template-management.test.ts`: `version`; `FLAGGED` sem `version` maior gera aviso; casamento por `metaTemplateId`; evento antigo sem `wabaId`; sync parcial não marca `MISSING`; `definition` regravada sem mudança não muda o hash.

**F3. Disparos e custos**
1. `dispatch.service.ts`, `extendLease`, `settle.service.ts`, `failures.ts`. → portar `test/whatsapp-campaigns.test.ts`, incluindo a pausa global (:473-545) a partir de `failed` assíncrono e de `409` síncrono; reentry com hub `pending` reestende a lease; `accepted` tardio promove `unknown → sent`; comando com `failed` local (`HUB_ABANDONED` ou "não confirmado pelo hub") deixa o destinatário `unknown`, não é desvinculado pelo `holdForRetry` e não gera reenvio; tabela de §3.4 em teste unitário, inclusive `409 IDEMPOTENCY_KEY_REUSED` e `400` sem `code`; campanha não inicia com `syncedAt` nulo.
2. Header de mídia subido uma vez por campanha. → `test/whatsapp-campaign-components.test.ts` com `uploadMedia` chamado 1 vez para N destinatários.
3. Custos. → `test/whatsapp-costs.test.ts`: categoria com `_`, `free_group_customer_service`, gratuidade e cobrança por `type`; `CostConsumptionSnapshot` com mock de `getConsumption`, faixa por `tier`, `month` e `timezone` gravados da resposta mesmo com outro `timezone` na conexão; `timezone` nulo na conexão pede o mês em `America/Sao_Paulo` na virada do mês; ausência de tarifa ou país nunca vira zero.

**F4. Piloto e abertura**
1. Piloto no app de dev, com número de teste próprio (hub:389). → ligação por D5, `active`, sync recusado ou aceito sem afetar a conexão, uma mensagem recebida, um envio manual e um de template `accepted → delivered` com `MessageCost`, mídia nos dois sentidos, uma campanha de 2 destinatários.
2. `HUB_ENABLED` em produção; primeiro número real de uma org interna. → os mesmos critérios, mais zero `HubWebhookEvent` `failed` em 7 dias (parâmetro).
3. Abertura para os clientes. → reconexão pelo gestor de cada org; antes dela, o texto de `lifecycle-controls.tsx:26` e o aviso de `official-tab.tsx:45` trocam "fale com o suporte" por "Conectar pelo hub".

**F5. Remoção do código direto (não aditiva; inverte a ordem de §6)**

O módulo `whatsapp-official/` fica: `identity.repo.ts`, `ingest.repo.ts`, `message-parser.ts`, `receipts.repo.ts`, `sync.repo.ts`, `media.service.ts`, `media.repo.ts` e `webhook.schema.ts` (com `eventHash`, `objectOf` e `journalQuerySchema`) são usados por outros módulos e pelos handlers do hub. Saem dele só os três arquivos do webhook próprio (§2.1). Nenhum passo chama `DELETE` em `subscribed_apps` (§4.1).

1. Religar o que ainda depende do código que sai. `syncStatus` (`src/modules/whatsapp-onboarding/onboarding.service.ts:122-126`) e `listSyncs` (`onboarding.repo.ts:71`) vão para `channel-connections`, porque `src/routes/v1/whatsapp/connections/index.ts:6,15` os usa. `src/routes/v1/whatsapp/events/index.ts` deixa de importar `webhook.service.js` e lê só o `HubWebhookEvent`. `test/helpers/official-connection.ts` troca `saveVerifiedOfficialConnection` (:2,15) pelo `hubConnectionFixture` (§8), e os testes que chamam o serviço direto (`test/whatsapp-channel-connections.test.ts:53-75`, `test/whatsapp-maintenance.test.ts:102-104`) perdem esses casos; `test/whatsapp-contact-identities.test.ts` importa só `disable` (:6) e não muda. Quem lê o journal antigo fora dos arquivos que saem: a retenção (`src/modules/whatsapp-maintenance/retention.repo.ts:7,12,21`) perde a parte do `OfficialWebhookEvent` e fica só com comandos e `HubWebhookEvent`, com os casos de `test/whatsapp-maintenance.test.ts:116-136` reescritos para o journal novo; `processTemplateStatus` (`src/modules/whatsapp-templates/template-status.service.ts:17`), que recebe um `OfficialWebhookEvent`, sai, substituído pelo `applyHubTemplate`. → `pnpm typecheck` verde antes de apagar qualquer arquivo; `grep -rn "officialWebhookEvent\|officialOnboarding" src test` (fora de `src/generated`) só acha os arquivos que o passo 2 apaga.
2. Remover o código. API: `src/modules/whatsapp-onboarding/` inteiro (inclui `refreshSyncProgress`, importado só por `whatsapp-official/webhook.service.ts:8`, que também sai), `src/routes/v1/whatsapp/onboarding/index.ts`, `src/routes/webhooks/whatsapp-official/index.ts`, `webhook.repo.ts`, `webhook.service.ts` e `webhook-processing.service.ts` de `whatsapp-official/`, `src/lib/whatsapp-official/` inteiro, o analytics da Graph, os jobs e envs de §2.1, e em `channel-connections` as funções de token listadas em §2.1 mais `verifiedOfficialConnectionSchema` (`channel-connections.schema.ts`). Web: `components/whatsapp-official/official-signup.tsx`, `useOfficialOnboardingConfig` (`lib/queries/whatsapp-official.ts:12-17`) e o uso em `official-tab.tsx`. Testes:
   - apagados por terem versão do hub: `whatsapp-official-webhook`, `whatsapp-outbound`, `whatsapp-campaigns`, `whatsapp-template-status`, `whatsapp-template-management` (§8) e `whatsapp-official-incoming-media` (F2.2);
   - apagados por testarem só o código que sai: `whatsapp-onboarding`, `whatsapp-official-graph`, `whatsapp-official-media-download`, `whatsapp-official-crypto`;
   - ficam e trocam o mock de `graph.js` ou `media-download.js` pelo do cliente do hub: `whatsapp-campaign-components` e `whatsapp-costs` (já revistos em F3), `whatsapp-campaign-inbox`, `whatsapp-maintenance` e `whatsapp-official-media-template`.
   → `pnpm lint`, `typecheck`, `test`, `build`; `grep -rn "lib/whatsapp-official/" src test` vazio.
3. Imagem sem referências, banco intacto. O `schema.prisma` perde `ChannelConnection.tokenEnc` (`prisma/schema.prisma:718`), `OfficialOnboarding` (:765, relações em :115 e :733, enum `OfficialOnboardingStatus` em :744) e `OfficialWebhookEvent` (:874, relações em :113 e :731; o enum `OfficialWebhookStatus` fica, o `HubWebhookEvent` usa). A remoção da instância uazapi (`lifecycle.repo.ts:16`) e o `disableConnection` (`lifecycle.repo.ts:38`) deixam de gravar `tokenEnc`. Nenhum `db push` neste passo: a imagem que ainda está no ar lê `ChannelConnection` sem `select` (`lifecycle.repo.ts:11,22`, `uazapi-policy.repo.ts:33`), e dropar a coluna antes daria `P2022` também na uazapi e na ingestão. → `pnpm db:generate && pnpm typecheck && pnpm test` verdes com o schema novo e o banco antigo; depois, imagem nova no ar e saudável.
4. Drop por SQL explícito e revisado, só depois do passo 3 no ar, no padrão da exceção do `account.issuer` (`AGENTS.md:101-127`, na raiz). Antes, `SELECT count(*) FROM "ChannelConnection" WHERE provider = 'cloud_api' AND "tokenEnc" IS NOT NULL` = 0. Depois, `ALTER TABLE "ChannelConnection" DROP COLUMN "tokenEnc"`, `DROP TABLE "OfficialOnboarding"`, `DROP TABLE "OfficialWebhookEvent"` e `DROP TYPE "OfficialOnboardingStatus"`. As colunas `tokenEnc` de outras tabelas (`prisma/schema.prisma:656,1396,1429`, uazapi e Lead Ads) ficam. O `OfficialWebhookEvent` sai por expurgo explícito porque a retenção nunca o esvazia (§2.1), e o critério é a imagem do passo 3 no ar, sem leitor; a coluna `tokenEnc` não depende do journal. O mesmo SQL roda em dev e teste. → `db push` em dev, teste e produção responde "in sync"; se pedir `--accept-data-loss`, parar.
5. Atualizar os docs de §5.3.

**F6 (separada). Lead Ads pelo hub.** `adName`/`campaignName` saem `null` até um lead de anúncio real confirmar os campos no hub.

---

## 8. Testes

- **Infra:** `test/helpers/hub.ts` com `vi.mock("../src/lib/meta-hub/client.js")`, `signHubEvent(envelope, secret, ts)` e `hubConnectionFixture` (com `hubConnectionId`, sem `tokenEnc`); `test/helpers/official-connection.ts` estendido. Postgres real, hub mockado, como a suíte atual.
- **Portados:** os casos de domínio presos ao formato Graph em `test/whatsapp-official-webhook.test.ts`, `test/whatsapp-outbound.test.ts`, `test/whatsapp-campaigns.test.ts`, `test/whatsapp-template-status.test.ts`, `test/whatsapp-template-management.test.ts` ganham versão por envelope do hub. Os originais saem em F5.
- **Segurança:** assinatura, janela de tempo, headers malformados, segredo anterior, tenant cruzado, download de mídia sem Bearer e com allowlist, `url` de sessão e de mídia fora do log.
- **LGPD:** retenção e exclusão de atendimento limpam `hubRequest` e `hubMediaId`.
- **Web:** `pnpm lint && pnpm typecheck && pnpm build` e `screenshot` da aba oficial e do dashboard de custos.

---

## 9. Riscos

**R1. Rollback abaixo da versão mínima (D6).** Abaixo de M1, sem receptor, o canal oficial para e os eventos esperam nas reentregas por cerca de 22 h (hub:1123). Entre M1 e a versão mínima é pior: o receptor responde 2xx `unsupported` aos eventos de mensagem e não há reentrega. Mitigação: a versão mínima registrada no `AGENTS.md` (D6) e `redeliver` do intervalo depois da volta.

**R2. Perda de mensagens.** `DELETE` no hub, desconexão no celular ou offboard perdem o intervalo (hub:624, hub:636), e a reconexão não o recupera. Indisponibilidade nossa acima de cerca de 22 h deixa entregas `failed`: recuperação por `redeliver` dentro de 30 dias (hub:1125). Desativar o endpoint no hub faz os eventos nascerem sem entrega (hub:1143): nunca pedir.

**R3. Mudança das regras de envio da §9 de `docs/whatsapp-official-integration.md` (linhas 229-248).** No hub, repetir com a mesma chave e o mesmo corpo é seguro enquanto a mensagem existe (hub:693), mas um POST que nunca chegou vira envio novo. Regra: repetição só na janela curta e depois do `finalCheck` (§3.3). `131000`/`131016`/`133004` com 4xx passam de `failed` a `uncertain` (hub:746). Atualizar a §9 da doc.

**R4. Teto de taxa compartilhado.** 600 req/min por chave para as rotas em geral, para todas as orgs; 30/min para upload e para escritas e sync de template (hub:398-402). `GET` de template, poll de envio, `recover` e refresh entram nos 600. Cache por `version` e poll só como fallback.

**R5. Chave de produção em máquina local.** A URL do hub é uma só (hub:24) e a chave de dev também é `mh_live_` (hub:386): o formato não protege. Mitigação: a chave de produção fica só no cofre da plataforma de deploy, e os jobs que chamam o hub exigem `HUB_JOBS_ENABLED=true` explícito.

**R6. `businessPortfolioId` mudando sem evento** (hub:604). Mudaria o escopo de identidade e duplicaria contatos (`identity.repo.ts:14,20`). O refresh diário detecta e marca `hubErrorCode = BUSINESS_CHANGED` com auditoria, sem sobrescrever, como faz hoje o `WHATSAPP_ASSET_CHANGED` (`src/modules/whatsapp-onboarding/onboarding.repo.ts:42-44`).

**R7. `db push` esquecido ou parado por índice único.** Atinge todas as conexões, inclusive a uazapi (§6). Mitigação: índices criados antes e checagem por `information_schema` como passo obrigatório do deploy.

**R8. Envio que sai depois de "Encerrar" ou do disable.** Sem H-D3, o que estiver `pending` no hub sai, até cerca de 14 min depois.

**R9. Histórico reimportado ou não.** Número que já passou pelo Coexistence do elosCRM no mesmo app pode ter o pedido de histórico recusado (hub:613, hub:639). Recusado, o intervalo desde 2026-10-23 não volta. Aceito, o histórico traz de novo o que veio antes de 2026-10-23 e pode trazer o intervalo (§1.3). A dedup por `connectionId + providerMessageId` (`src/modules/whatsapp-official/ingest.repo.ts:25-26`) segura a duplicata na linha reaproveitada por D5; F2.3 testa a reingestão.

---

## 10. Questões em aberto

- **Q4.** O dashboard de custos aceita ser mensal e por número até H-D4?
- **Q5.** Perder `rejectionRecommendation` é aceitável até H-D2?
- **Q6.** Read receipts e "digitando" (hub:796) entram no escopo? Mudam o que o cliente final vê.
- **Q7.** Um destinatário `unknown` que veio de `uncertain` do hub entra na trava de 7 dias (`campaigns.repo.ts:14`), como hoje, ou fica liberado para reenvio?
- **Q8.** Parâmetros: janela de repetição do POST, prazo do "não confirmado", extensão da lease do destinatário (mínimo 15 min), margem de renovação do upload e janela de estabilidade do piloto.

> Criado em 2026-11-10 17:35 (-03) · Última modificação: 2026-11-12 15:53 (-03)
