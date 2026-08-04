# Sessão — integração de WhatsApp, da instância à conversa

Registro do que foi feito, decidido e descoberto numa sessão que começou com uma pasta de código
importado que não compilava e terminou com conversas reais chegando no CRM. **23 commits**, de
`95682b6` a `e3753a8`, na `main`.

Docs de design: [`fase 1`](../eloscrm-api/docs/superpowers/specs/2026-08-03-whatsapp-uazapi-design.md) ·
[`fase 2`](../eloscrm-api/docs/superpowers/specs/2026-08-04-whatsapp-conversas-design.md)

---

## 1. Ponto de partida: uma lib que não compilava

`eloscrm-api/src/lib/uazapi/` veio importada do `matra-notification-manager` e falhava em 18 pontos:
`axios` fora das dependências, alias `@/` que este tsconfig não tem, envs e models Prisma
inexistentes.

Junto vinha um **bug silencioso**: `hibernated` (estado que a uazapi v2.1.1 adicionou) faltava em
`types.ts` e no `STATUS_MAP`. Sem ele, `parseStatus` devolve `null`, o snapshot não escreve `status`
e **o estado local congela no anterior** — a tela mostraria "conectado" para um número que parou de
atender.

## 2. Fase 1 — ciclo de vida da instância

Uma instância por imobiliária (`organizationId` é `@unique`), rotas sem `:id` (`/v1/whatsapp/instance`
resolve por `request.orgId`), token cifrado em AES-256-GCM, webhook por instância com segredo de 32
bytes.

Depois vieram as telas de **Visão geral, Sincronização, Teste, Diagnóstico, Histórico e Zona de
risco**, e o auto-sync de perfil.

## 3. O que a investigação de tráfego revelou

A uazapi **não documenta o corpo que entrega nos webhooks**. Tudo abaixo foi capturado com
`UAZAPI_DEBUG_LOG` e `/webhook/errors`, não lido de spec.

| Achado | Por que importa |
|---|---|
| `messages` entrega em `chat` + `message`, não em `instance` | o extrator do `connection` não serve |
| `sender` é **LID** (`226070083190831@lid`) | casar lead por ele nunca funcionaria; o telefone está em `chat.phone` |
| `content` é **string** no texto simples, objeto no resto | `content.text` estoura no tipo mais comum |
| GIF chega como `VideoMessage`, `video/mp4` | só `mediaType` distingue, e a UI precisa (laço, sem controles) |
| Áudio de voz é `ptt`, não `audio` | merece UI de nota de voz, com a `waveform` que vem no payload |
| Figurinha e áudio **não têm** `JPEGThumbnail` | o preview instantâneo não cobre os dois |
| Figurinha tem 233 KB, foto JPEG tem 18 KB | teto de tamanho apertado recusaria conteúdo trivial |
| `messageTimestamp` em **ms**; `Timestamp` do update em **segundos** | mesmo provedor, unidades diferentes |
| Mídia expira em **2 dias** no storage da uazapi | única falha irreversível do sistema |
| `content.URL` é `.enc` cifrado do CDN da Meta | inútil num `<img src>`; a URL exibível só nasce do download |

**O nono dígito.** Os 18 leads do banco guardam `(43) 99812-4470` (11 dígitos); o JID veio
`554391834229` (10). Mesma pessoa, nenhuma comparação direta casa. Daí a `phoneKey` = DDD + últimos
8 dígitos.

## 4. Um bug nosso que o tráfego real expôs

`messages_update` **estava chegando desde o começo** — e a API respondia **422** a todos. Dez
entregas falhadas, sem sintoma nenhum do nosso lado. Só apareceu porque fui a `/webhook/errors`
descartar falha de infra.

A causa: `webhookBodySchema` tipava `event` como `string`, porque nos outros envelopes `event` é
sinônimo de `EventType`. Em `messages_update` ele é o **payload** (objeto), e `type` é o subtipo.

O comentário que eu mesmo escrevera nesse schema dizia: *"rejeitar o corpo derrubaria todos os
eventos em silêncio, e o sintoma só apareceria em `/webhook/errors`"*. Foi exatamente isso, causado
pelo próprio schema.

## 5. Fase 2 — conversas

Sete fases, todas com `lint` + `typecheck` + `test` verdes:

| Fase | Entrega |
|---|---|
| 1 | `phoneKey` + índice + backfill idempotente |
| 2 | BullMQ/Redis, models, extrator, idempotência, matching |
| 3 | mídia para o R2 em três estágios de exibição |
| 4 | recibos de entrega e leitura (✓✓) |
| 5 | inbox: lista, thread, bolhas por tipo |
| 6 | envio de texto, com bloqueio do WhatsApp tratado à parte |
| 7 | criar/escolher lead, adicionar ao funil, aba na ficha |

### Decisões que valem lembrar

**Fila com fallback inline.** Sem `REDIS_URL`, o `enqueue` chama o processador direto — é o que
mantém teste e CI sem infra e torna a suíte determinística. Em produção o Redis é obrigatório.

**Conversa existe sem lead.** `clientId` é opcional, porque o caso central é alguém desconhecido
escrever e o corretor **então** decidir criar o lead.

**Não auto-vincular quando ambíguo.** Fixo e celular colidem na `phoneKey`; atribuir ao lead errado
é pior que pedir escolha.

**O CRM embutido da uazapi é ignorado.** O `chat` traz `lead_status`, `lead_kanbanOrder`,
`lead_field01…20`. Espelhar estado em dois lugares cria divergência sem dono.

**Mídia em três estágios:** presigned do R2 → URL temporária da uazapi → `JPEGThumbnail` embutido. O
front recebe URL pronta e não conhece a diferença.

**Sem otimismo local no envio.** A bolha só aparece após confirmação, porque o WhatsApp pode recusar
— mostrar mensagem que depois some é pior que esperar meio segundo.

## 6. Bugs de tabela ao lado, achados olhando a tela

- **`formatPhone`** decidia a máscara pelo primeiro dígito, e 8 dígitos começando com 9 viravam
  `91112-222`. É justamente o formato que o WhatsApp entrega sem o nono dígito.
- **`webhookSecret` vazava** pelo `/instance/logs`: o log guardava a resposta do `webhook.upsert`,
  cuja URL termina no segredo.
- **Header sensível na trilha**: `request.headers` ia inteiro para o arquivo de diagnóstico;
  `Authorization` e `Cookie` passariam em claro.
- **Paginação correta por acidente**: `messages.reverse()` mutava o array antes de `messages[0]` ler
  o cursor. Funcionava, mas trocar duas linhas quebraria em silêncio.
- **Selects mostravam cuid**: o Base UI renderiza o valor cru sem função de formatação — e o projeto
  já tinha o padrão certo, com comentário, em `client-dialog.tsx`.

## 7. Estado final

- API: **294 testes**, 42 arquivos
- Web: lint, typecheck e build limpos
- Integração real validada: mensagem do próprio número chegando pelo webhook, com foto de perfil,
  vinculada a lead pela `phoneKey`

### Em aberto

| Item | Nota |
|---|---|
| Envio de mídia | decidir entre base64 no corpo e presigned do R2 para o provedor baixar |
| Rate limit no receptor de webhook | o projeto não tem `@fastify/rate-limit` |
| `providerMessageId` no download | palpite razoável, ainda não confirmado contra a API real |
| Retenção de conversa e mídia | tudo é dado pessoal sob LGPD |
| Rotação de `webhookSecret` | hoje só removendo e recriando a instância |

### Deploy

Além do `prisma db push` (models de conversa, `phoneKey`, enums novos), esta entrega exige:

```bash
DATABASE_URL="…produção…" pnpm tsx scripts/backfill-phone-key.ts --apply
```

Sem o backfill, todo lead já cadastrado fica com chave nula e **nunca casa** com a conversa — o
corretor veria "criar lead" para quem é cliente há meses. E `REDIS_URL` precisa estar configurada,
senão o webhook processa inline.

---

> Criado em 2026-08-04 09:36 (-03) · Última modificação: 2026-08-04 09:36 (-03)
