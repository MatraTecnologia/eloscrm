# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Scope

Esta pasta contém a especificação OpenAPI 3.1 da **uazapiGO** (WhatsApp API, v2.1.1). É documentação de referência; não há código executável aqui.

> ⚠️ **A pasta veio importada do `matra-notification-manager`** e ainda não tem consumidor no elosCRM — nenhum código deste repo lê a spec. Quando houver cliente HTTP aqui, documentar onde ele fica e que os tipos são mantidos à mão (não há geração automática a partir dos `schemas/*.yaml`).

## Estrutura

```
uazapi-openapi-spec.yaml   # Spec raiz: info, servers, tags, $refs para paths/ e schemas/
paths/<categoria>/*.yaml   # Um arquivo por endpoint, agrupado por tag/categoria
schemas/*.yaml             # Componentes reutilizáveis (chat, message, instance, etc)
```

A spec raiz **não** define paths inline — ela faz `$ref` para os arquivos em `paths/` e `schemas/`. Ao editar, mantenha esse padrão: novos endpoints vão em `paths/<categoria>/<nome>.yaml` e são referenciados no `paths:` do `uazapi-openapi-spec.yaml`.

### Categorias (tags) — 20 grupos

`Admininstração`, `Instancia`, `Proxy`, `Perfil`, `Business`, `Chamadas`, `Webhooks e SSE`, `Enviar Mensagem`, `Mensagem Async`, `Ações na mensagem e Buscar`, `Chats`, `Contatos`, `Bloqueios`, `Etiquetas`, `Grupos e Comunidades`, `Newsletters e Canais`, `Respostas Rápidas`, `CRM`, `Mensagem em massa`, `Integração Chatwoot`.

Diretórios em `paths/` seguem versão slug/PT da tag (ex: `admininstracao/` — note o typo preservado para bater com a tag, `enviar-mensagem/`, `webhooks-e-sse/`).

## Convenções da API (críticas ao integrar)

**Autenticação por header**:
- Endpoints regulares: header `token` com token da instância.
- Endpoints administrativos (tag `Admininstração`): header `admintoken`.
- ⚠️ Não é Bearer/Authorization: os headers se chamam literalmente `token` e `admintoken`.

**Servers**: `https://{subdomain}.uazapi.com` com `subdomain ∈ {free, api}`.

**Estados de instância**: `disconnected` | `connecting` | `connected` | `hibernated` (sessão pausada com credenciais preservadas; adicionado na v2.1.1 — `Instance.status` agora declara esse enum). Limite de instâncias por servidor → erro 429.

**Capacidade de conexão**: `POST /instance/connect` pode responder **503** ("capacidade temporariamente indisponível") com header `Retry-After` em segundos — tratar com retry, não como falha definitiva.

**Proxy (`/instance/proxy`) — mudança quebrada na v2.1.1**: o valor de `proxy_fallback` deixou de ser `internal_proxy` e passou a ser **`internal`** (os outros aceitos continuam `never` ou uma URL). Quem enviava ou comparava `internal_proxy` precisa migrar. Também na v2.1.1: `rotate_now: true` (com `mode=internal`) troca o proxy interno na hora, devolve `rotated: true` e pode responder **409** quando não há proxy alternativo.

**Respostas rápidas (`/quickreply/edit`) na v2.1.1**: `onWhatsApp` virou campo de *request* (cria/sincroniza no WhatsApp Business, **só `type: text`**). Não dá para converter uma resposta local existente — enviar `onWhatsApp: true` **sem** `id`. A garantia antiga de que templates do WhatsApp não podiam ser editados/excluídos saiu da spec, junto com o `403` correspondente; falha de sincronização agora vem como `500`.

**Campos opcionais comuns** suportados por todos os endpoints de envio (`paths/enviar-mensagem/*`):
- `delay` (ms, mostra "Digitando..."/"Gravando áudio..." durante)
- `readchat`, `readmessages`, `replyid`, `viewOnce`, `mentions`, `forward`
- `track_source`, `track_id` (rastreamento; **não há validação de unicidade** de `track_id`)
- `async` (enfileira; resposta 200 não garante envio — checar via `/message/find?status=failed`)

**Envio para grupos**: `number` deve terminar em `@g.us` (ex: `120363012345678901@g.us`). Obter via webhook (`chatid`) ou `GET /group/list`.

**Placeholders em mensagens** (substituição automática server-side):
- `{{name}}` — fallback ordenado: `lead_name` → `lead_fullName` → `wa_contactName` → `wa_name`
- `{{first_name}}` — primeira palavra ≥ 2 chars do nome consolidado
- `{{wa_name}}`, `{{wa_contactName}}`, `{{lead_name}}`, `{{lead_fullName}}`, `{{lead_personalid}}`, `{{lead_email}}`, `{{lead_status}}`, `{{lead_notes}}`, `{{lead_assignedAttendant_id}}`
- Campos custom: `{{lead_field01}}` … `{{lead_field20}}` ou nomes mapeados via `/instance/updateFieldsMap`

**Diagnóstico de bloqueio do WhatsApp**: respostas de erro podem trazer `error_source: "whatsapp_server"`, `provider_code: 463`, `details.new_chat_message_capping`, `details.reachout_timelock`. Estado atual: `GET /instance/wa_messages_limits`.

**Fila async**: a tag `Mensagem Async` controla **apenas** a fila interna de envios diretos com `async=true`. Não cobre `/sender/*` (campanhas) nem altera mensagens já enviadas.

**Newsletters/Canais** usam rotas próprias (`/newsletter/messages*`, `/newsletter/updates`). **Não usar** `/message/edit` ou `/message/delete` neles. Views/reactions vêm via `/newsletter/updates`, não via webhook.

**Business** e **Chatwoot** estão marcadas como BETA/EXPERIMENTAL na spec — sinalizar isso ao consumir.

## Editando a spec

- Ao adicionar um endpoint: crie `paths/<categoria>/<nome>.yaml` com a operação completa (sem o wrapper `paths:`/path), depois adicione em `uazapi-openapi-spec.yaml` sob `paths:` uma entrada `/rota/aqui: { $ref: "./paths/<categoria>/<nome>.yaml" }`.
- Ao adicionar um schema reutilizável: `schemas/<nome>.yaml` e referenciar via `$ref: "../schemas/<nome>.yaml"` (paths) ou `$ref: "./schemas/<nome>.yaml"` (raiz).
- Manter descriptions em pt-BR (toda a spec é pt-BR).
- A spec é OpenAPI **3.1.0** (não 3.0) — pode usar `type: ["string","null"]`, `examples` arrays, etc.
