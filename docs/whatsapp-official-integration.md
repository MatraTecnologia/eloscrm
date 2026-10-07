# Integração do WhatsApp oficial no elosCRM

Documentação funcional e técnica da integração direta com a WhatsApp Cloud API, com Coexistence, atendimento pelo CRM, templates, campanhas e controle de consumo.

**Base analisada:** commit `cf1424f`, integrado à `main`. Este documento descreve o código dessa versão. A configuração do ambiente de produção e os ativos da Meta precisam ser conferidos separadamente.

## 1. Escopo e decisões do produto

O elosCRM conecta os números de cada imobiliária diretamente à Meta. A API do CRM recebe os webhooks, guarda as mensagens, executa os envios e mantém os vínculos com contatos, leads e negócios. Não existe um hub externo intermediando essa integração.

O WhatsApp oficial é o canal principal de atendimento. Coexistence permite usar o WhatsApp Business no celular e o CRM com o mesmo número, quando a Meta autoriza esse modo para a conta.

A uazapi continua disponível para disparos e para uma exceção manual de envio na conversa oficial, desde que use o mesmo número. Números separados são aceitos na tela de disparos. Mensagens recebidas pela uazapi não criam novas conversas, leads ou cards. Registros antigos continuam disponíveis para consulta e vinculação de histórico.

Uma falha da Cloud API não troca automaticamente o provedor. O usuário escolhe a exceção de envio pela uazapi e confirma a operação.

**Fontes:** [onboarding](../eloscrm-api/src/modules/whatsapp-onboarding/onboarding.service.ts), linhas 12–17 e 98 em diante; [webhook uazapi](../eloscrm-api/src/modules/whatsapp/whatsapp.webhook.service.ts), linha 23; [política de envio manual](../eloscrm-api/src/modules/whatsapp-inbox/uazapi-policy.repo.ts), `resolveManualRoute`.

## 2. Arquitetura e responsabilidades

~~~text
WhatsApp Business no celular ── Coexistence ── Meta
                                               │
                              webhook assinado │ Cloud API
                                               ▼
                                     eloscrm-api
                                    /           \
                              Postgres         Redis/BullMQ
                                 │                 │
                                 └──── workers ────┘
                                         │
                                  storage S3 privado
                                         │
                                     eloscrm-web
~~~

| Componente | Responsabilidade |
| --- | --- |
| Meta | Autorização, ativos WhatsApp, aprovação de templates, processamento dos envios e eventos de entrega. |
| API Fastify | Sessão, autorização, escopo da imobiliária, validação, integração com Graph API e execução dos jobs. |
| Postgres | Conexões, identidades, mensagens, comandos, campanhas, destinatários, recibos, custos e auditoria. |
| Redis/BullMQ | Filas de processamento e execução em segundo plano. |
| Storage S3 privado | Arquivos recebidos e preparados para envio. |
| Dashboard Next.js | Configuração, atendimento, templates, disparos, custos e acompanhamento das operações. |

### 2.1. Principais registros de persistência

| Model | Uso |
| --- | --- |
| `ChannelConnection` | Ativos, credencial e estado do número oficial. |
| `OfficialOnboarding` / `OfficialSyncRequest` | Tentativa de autorização e pedidos de sincronização. |
| `MessagingContact` / `ContactIdentity` | Contato técnico e identidades com escopo. |
| `Conversation` / `WhatsappMessage` | Atendimento e mensagens, com origem/autoria. |
| `OfficialWebhookEvent` | Journal de entregas e processamento de eventos. |
| `OfficialDeliveryReceipt` | Recibos recebidos da Meta. |
| `OfficialSendCommand` | Intenção, idempotência e resultado do envio oficial. |
| `OfficialCampaign` / `OfficialCampaignRecipient` | Campanha e progresso por destino. |
| `Broadcast` / `BroadcastRecipient` | Disparos uazapi e progresso por destino. |

**Fonte:** [schema Prisma](../eloscrm-api/prisma/schema.prisma), models correspondentes.

O banco guarda a intenção e o estado das operações. Redis não é a única fonte de informação sobre um envio. Rotinas periódicas recuperam trabalho persistido que ainda precisa ser executado ou conciliado.

Os workers e agendadores sobem com a API. Fechar o navegador não interrompe uma campanha. Parar a API, perder Redis ou perder acesso ao banco afeta a execução; a retomada depende da recuperação dos serviços e dos estados persistidos.

**Fontes:** [inicialização da API](../eloscrm-api/src/server.ts), imports e agendadores; [fila](../eloscrm-api/src/lib/queue.ts); [recuperação dos comandos](../eloscrm-api/src/modules/whatsapp-outbound/outbound.service.ts), `recoverSends` e `scheduleSendRecovery`.

## 3. Configuração global e configuração por imobiliária

### 3.1. Configuração compartilhada do aplicativo

As envs identificam o app Meta usado pelo elosCRM, sua configuração de Embedded Signup, assinatura dos webhooks e chaves de criptografia. Elas pertencem à instalação do CRM.

### 3.2. Dados dinâmicos por conexão

Os dados abaixo ficam no banco, vinculados à imobiliária e à conexão:

- Business Portfolio ID;
- WABA ID;
- Phone Number ID;
- número de exibição e nome verificado;
- token cifrado e informação de expiração, quando fornecida;
- indicação de uso do WhatsApp Business App;
- moeda e fuso da WABA;
- estado da conexão e das solicitações de sincronização.

Não se configura um único WABA, número ou access token global para todos os clientes. Os IDs capturados no navegador são verificados novamente pela API, com o token autorizado pela Meta.

**Fontes:** [schema](../eloscrm-api/prisma/schema.prisma), `ChannelConnection`, linha 699; [onboarding](../eloscrm-api/src/modules/whatsapp-onboarding/onboarding.service.ts), `exchange` e `activate`; [credenciais](../eloscrm-api/src/modules/channel-connections/channel-connections.service.ts), `getOfficialCredentials`.

## 4. Conexão com Coexistence

### 4.1. Fluxo do gestor

1. Acessar **WhatsApp → WhatsApp oficial** por HTTPS.
2. Iniciar a conexão com o WhatsApp Business.
3. Autorizar o app no popup da Meta e concluir o fluxo de Coexistence.
4. Confirmar no celular o que a Meta solicitar, incluindo a autorização para compartilhar histórico quando essa opção estiver disponível.
5. Selecionar o número autorizado, se houver mais de um candidato.
6. Aguardar a ativação local e acompanhar os estados de histórico e contatos.

A Meta decide se o número é elegível. Um número marcado como “Não qualificado” no popup precisa ser investigado nos ativos e no suporte da Meta; o CRM não tem uma opção para forçar sua elegibilidade.

### 4.2. Validação técnica

Antes de abrir e concluir o cadastro, a API confere se o app possui uma assinatura ativa do objeto `whatsapp_business_account`, com callback correspondente a `PUBLIC_API_URL` e os campos exigidos.

O frontend captura duas informações que podem chegar em ordens diferentes:

- o código de autorização recebido pelo callback de `FB.login`;
- o `waba_id` recebido no evento `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING`.

A API troca o código por token, verifica o app, permissões, escopos granulares e expiração; consulta a WABA e os números autorizados. Só aceita como candidato um número identificado como WhatsApp Business App e Cloud API. Na ativação, consulta os números novamente.

A tentativa pertence ao usuário, à sessão e à imobiliária. Um ID de tentativa não concede acesso a outro usuário ou tenant. Repetir uma operação concluída não deve gerar uma nova conexão sem passar pelas verificações do fluxo.

### 4.3. Sincronização

A ativação cria solicitações de histórico e sincronização do estado do aplicativo. “Solicitação aceita” significa que a Meta aceitou o pedido; não significa que todos os dados já chegaram.

O status é atualizado pelos eventos recebidos. A autorização no celular e a entrega dos eventos determinam o conteúdo importado. Histórico recusado, pendente ou com erro deve ser interpretado separadamente do status de conexão.

Grupos não fazem parte do atendimento oficial implementado. Histórico importado não cria automaticamente novos leads ou negócios.

**Fontes:** [frontend](../eloscrm-web/components/whatsapp-official/official-signup.tsx), linhas 35–94 e 118–119; [validação e ativação](../eloscrm-api/src/modules/whatsapp-onboarding/onboarding.service.ts), `checkSubscriptions`, `exchange`, `activate`; [sincronização](../eloscrm-api/src/modules/whatsapp-onboarding/sync-request.service.ts).

## 5. Identidades, contatos e vínculo com o CRM

| Registro | Significado |
| --- | --- |
| `MessagingContact` | Pessoa identificada no atendimento de mensagens. Pode existir sem lead do CRM. |
| `ContactIdentity` | Identidade técnica dessa pessoa, com tipo, origem, escopo e vigência. |
| `Client` | Lead/cliente do CRM, usado no cadastro e nos negócios. |
| `Conversation` | Conversa do contato em uma conexão/número. |
| Atendimento da inbox | Agrupamento das conversas que o CRM pode vincular ao mesmo contato ou lead. |
| Destinatário importado | Entrada de uma lista de disparo; sua importação não cria um `Client` nem um card. |

As identidades oficiais incluem `wa_id`, `phone`, `bsuid` e `parent_bsuid`. O escopo do portfólio evita tratar um identificador de uma empresa como identidade universal de outra. As rotinas preservam origem e vigência e processam `user_id_update` para alterações de identidade.

O envio oficial comum exige uma identidade vigente, informada pelo provedor e pertencente ao escopo da conexão. A exceção de identidade `campaign_import` existe para um template de campanha associado ao destinatário importado; ela não habilita envio livre arbitrário.

Não se deve fundir contatos só porque os nomes coincidem. O histórico pode ser agregado por vínculo explícito ao lead. Quando há mais de um lead com o mesmo telefone, a automação evita escolher um deles silenciosamente.

**Fontes:** [schema](../eloscrm-api/prisma/schema.prisma), `MessagingContact` e `ContactIdentity`, linhas 811 e 836; [identidades](../eloscrm-api/src/modules/whatsapp-official/identity.repo.ts); [validação do envio](../eloscrm-api/src/modules/whatsapp-outbound/outbound.service.ts), `prepare`; [automação](../eloscrm-api/src/modules/lead-automation/inbound-automation.repo.ts), linhas 18–26.

## 6. Recebimento de mensagens e webhooks

### 6.1. Entrada oficial

Endpoint público:

~~~text
GET  /webhooks/whatsapp-official
POST /webhooks/whatsapp-official
~~~

O GET responde ao desafio de verificação da Meta. O POST valida `X-Hub-Signature-256` usando o App Secret e os bytes originais do corpo, antes de aceitar o evento.

O evento é persistido antes do ACK. Se o banco não conseguir guardá-lo, a API devolve erro em vez de confirmar uma entrega perdida. A confirmação do webhook significa “evento guardado”; o processamento de mensagens, mídias e automações pode acontecer depois.

### 6.2. Campos processados

| Campo | Tratamento |
| --- | --- |
| `messages` | Mensagens recebidas e estados dos envios. |
| `smb_message_echoes` | Mensagens enviadas pelo WhatsApp Business App. |
| `history` | Histórico compartilhado no Coexistence. |
| `smb_app_state_sync` | Sincronização de contatos/estado do aplicativo. |
| `user_id_update` | Atualização das identidades do contato. |

A ativação exige os primeiros quatro campos. O quinto tem processamento implementado e deve ser incluído nas assinaturas quando disponível para o app.

Esta versão não implementa handlers de domínio para todos os eventos que a Meta oferece. `account_update` e atualizações de status de templates não devem ser documentados como automações prontas do CRM. A sincronização de templates é uma chamada explícita à Graph API.

### 6.3. Duplicação e recuperação

Mensagens são identificadas pelo ID externo dentro da conexão. Reentregas não devem criar outra mensagem equivalente. Eco e histórico enriquecem dados conhecidos sem substituir a autoria de um envio já registrado pelo CRM.

Eventos guardados podem ser recuperados e reprocessados. Erros em itens são registrados com códigos seguros; não se deve interpretar HTTP 200 do webhook como sucesso de todos os itens internos.

**Fontes:** [rota oficial](../eloscrm-api/src/routes/webhooks/whatsapp-official/index.ts), linhas 9–43; [assinatura](../eloscrm-api/src/lib/whatsapp-official/webhook-auth.ts); [processamento](../eloscrm-api/src/modules/whatsapp-official/webhook-processing.service.ts), `processChange`; [ingestão](../eloscrm-api/src/modules/whatsapp-official/ingest.repo.ts), linhas 9–64.

## 7. Tela de conversas

A rota `/conversas` apresenta o histórico de atendimento do contato nos números da imobiliária. A interface permite buscar contatos, consultar mensagens anteriores, buscar texto nas mensagens, acompanhar não lidos, arquivar/reabrir e vincular a um lead.

As mensagens distinguem recebimento oficial, envio pelo CRM, envio pelo celular e histórico importado. Envios feitos por usuários do CRM preservam a autoria registrada.

O compositor oficial permite texto, templates e mídias suportadas; respostas podem citar uma mensagem da mesma conversa e conexão. O servidor valida a citação e rejeita mensagem excluída, falha ou pertencente a outro atendimento.

A inbox usa paginação e polling. A atualização da tela não depende de manter uma conexão WebSocket. Consultas novas são feitas em intervalos menores para a página recente e maiores quando o usuário navega no histórico.

Quando só existe um número útil para o atendimento, o usuário não precisa escolher outro canal apenas para visualizar a mesma conversa. Ter múltiplas conexões não elimina o escopo individual de cada janela de atendimento.

Avatares não devem ser prometidos como dados recebidos pela integração oficial. A apresentação atual pode identificar o contato pelo nome/telefone e pelo tratamento visual padrão.

**Fontes:** [inbox](../eloscrm-api/src/modules/whatsapp-inbox/inbox.service.ts), `get`, `list`, `messages`; [compositor](../eloscrm-web/components/whatsapp-official/official-composer.tsx); [consultas da inbox](../eloscrm-web/lib/queries/inbox.ts), linhas 10–21; [resposta citada](../eloscrm-api/src/modules/whatsapp-outbound/outbound.service.ts), `prepare`.

### 7.1. Arquivamento e exclusão

Arquivar muda a organização visual do atendimento. Reabrir remove o estado de arquivo. As operações têm registro de auditoria.

Excluir exige confirmação na interface e atua sobre o atendimento agrupado. O backend bloqueia exclusão enquanto houver comandos oficiais pendentes, em preparação, em submissão ou com resultado incerto.

A exclusão remove conteúdo e vínculos do atendimento, limpa campos de mensagens e comandos e remove arquivos de mídia que não estejam referenciados por outras conversas. IDs necessários para custos e auditoria são preservados. Não é uma exclusão completa de todos os registros históricos do banco.

Essa operação é local ao CRM; não chama uma operação para apagar a conversa do celular ou do destinatário.

**Fonte:** [operações da inbox](../eloscrm-api/src/modules/whatsapp-inbox/inbox.repo.ts), linhas 76–115.

## 8. Janela de atendimento de 24 horas

O CRM guarda `lastCustomerMessageAt` e `serviceWindowExpiresAt` por conversa oficial. Uma mensagem oficial recebida ao vivo do cliente atualiza a referência da janela para o horário da mensagem mais 24 horas, sem fazer um evento antigo substituir uma referência mais recente.

O envio de texto ou mídia exige uma janela vigente. O backend confere a condição na preparação e novamente antes da submissão. Uma tela aberta durante horas não dá autorização para enviar depois do prazo.

Após o fechamento, o envio oficial precisa de um template aprovado. Enviar um template não equivale, no CRM, a receber uma nova mensagem do cliente. Uma nova resposta do cliente é que atualiza a janela.

A janela é do contato naquele número/conexão; mensagens em outro número não concedem automaticamente uma janela para todos os canais.

**Fontes:** [atualização da janela](../eloscrm-api/src/modules/whatsapp-official/ingest.repo.ts), trecho de `lastCustomerMessageAt`; [controle de envio](../eloscrm-api/src/modules/whatsapp-outbound/outbound.service.ts), `prepare` e `executeSend`.

## 9. Envio oficial, idempotência e resultado incerto

Cada envio cria um `OfficialSendCommand` associado a uma mensagem. A chave de idempotência e o hash da solicitação impedem que repetir a mesma requisição gere um novo envio. Usar a mesma chave com outro conteúdo gera conflito.

| Estado do comando | Interpretação |
| --- | --- |
| `pending` | Intenção guardada, aguardando execução. |
| `preparing` | Worker preparando e validando o envio. |
| `sending` | Submissão iniciada. |
| `accepted` | Meta respondeu com um ID de mensagem e o resultado foi registrado. |
| `failed` | Falha registrada para a operação. |
| `uncertain` | Não foi possível confirmar se a submissão produziu um envio. |

`accepted` não significa entregue nem lido. Esses estados dependem dos recibos posteriores da Meta.

Um timeout após iniciar a submissão pode significar que a Meta recebeu a mensagem e a resposta se perdeu. O CRM não repete cegamente esse envio. O estado incerto e respostas conhecidas são tratados pela recuperação/conciliação para reduzir duplicações.

Antes de enviar, a API revalida usuário, conexão, token, identidade, janela, template, mídia e, quando aplicável, a campanha. Uma campanha pode ter sido cancelada ou alterada desde o primeiro preview.

**Fontes:** [estados](../eloscrm-api/prisma/schema.prisma), linha 1116; [envio](../eloscrm-api/src/modules/whatsapp-outbound/outbound.service.ts), `createSend`, `executeSend`, `recoverSends`; [recibos](../eloscrm-api/src/modules/whatsapp-official/receipts.repo.ts).

## 10. Mídias

Arquivos ficam em storage privado. O backend valida tamanho, tipo e assinatura do conteúdo; a extensão ou o MIME enviado pelo navegador não bastam.

| Uso | Formatos nesta versão | Limite local |
| --- | --- | --- |
| Imagem enviada | JPEG, PNG | 5 MiB |
| Áudio enviado | MP3, OGG/Opus | 16 MiB |
| Vídeo enviado | MP4 | 16 MiB |
| Documento enviado | PDF | 16 MiB |
| Mídia recebida | Os formatos acima e WebP | Até 16 MiB; imagens passam por limites específicos. |

Áudio não aceita legenda. A preparação guarda digest e metadados; antes do envio, o arquivo é lido e validado novamente. A Graph API recebe o upload antes da mensagem que referencia a mídia.

O recebimento de mídia tem seu próprio estado, tentativas e recuperação. O worker consulta metadados na Meta, baixa o arquivo com controles de destino, confere tamanho/digest e guarda no bucket privado. A interface pode mostrar a mensagem antes de a mídia estar pronta.

Os limites acima são os do CRM nesta versão, não uma lista completa dos formatos ou limites possíveis na plataforma da Meta.

**Fontes:** [upload e validação](../eloscrm-api/src/modules/whatsapp-outbound/media.service.ts), linhas 9–28; [mídia recebida](../eloscrm-api/src/modules/whatsapp-official/media.service.ts), linhas 15–42; [download](../eloscrm-api/src/lib/whatsapp-official/media-download.ts).

## 11. Gerenciamento de templates

A aba de templates fica em `/integracoes/whatsapp?tab=templates`. O catálogo pertence à WABA selecionada. Um template de outra conta não aparece como opção válida para o número atual.

A tela oferece seleção de conexão, sincronização, busca por nome, filtros de status e categoria, prévia, criação e exclusão com confirmação. Aprovação e recategorização continuam sendo decisões da Meta.

### 11.1. Criação pelo CRM

| Campo | Regra local |
| --- | --- |
| Nome | Letras minúsculas, números e `_`; até 512 caracteres. |
| Idioma | `pt_BR`, `en_US` ou `es`. |
| Categoria | `MARKETING` ou `UTILITY`. |
| Cabeçalho | Texto fixo opcional; até 60 caracteres. |
| Corpo | Obrigatório; até 1.024 caracteres. |
| Rodapé | Texto fixo opcional; até 60 caracteres. |
| Variáveis | Posicionais e sequenciais: `{{1}}`, `{{2}}` etc. |
| Exemplos | Um por variável; até 10 exemplos, com até 200 caracteres cada. |

O editor atual não cria todos os formatos da plataforma: autenticação, botões e cabeçalhos de mídia não fazem parte desse formulário de criação. Templates existentes sincronizados da Meta podem conter componentes adicionais, sujeitos às validações do envio.

Para enviar, o status precisa estar aprovado e os parâmetros precisam corresponder ao template. O envio suporta preparação de cabeçalho de mídia quando o template e o upload são compatíveis. Nem todo formato oferecido pela Meta está coberto por esta implementação.

Se a criação/exclusão ficar sem confirmação, sincronize antes de repetir. Uma falha de resposta não prova que a operação remota não aconteceu.

**Fontes:** [interface](../eloscrm-web/components/whatsapp-official/template-manager.tsx); [validação](../eloscrm-api/src/modules/whatsapp-templates/templates.schema.ts), linhas 3–16; [operações](../eloscrm-api/src/modules/whatsapp-templates/templates.service.ts); [montagem para envio](../eloscrm-api/src/modules/whatsapp-outbound/template.ts).

## 12. Disparos em massa

A rota `/broadcasts` reúne disparos oficiais e uazapi. O usuário seleciona o funil, provedor e público. Nesta versão, mesmo uma lista importada é criada no contexto de um funil; isso não cria cards para seus destinatários.

| Aspecto | Oficial | uazapi |
| --- | --- | --- |
| Conteúdo | Template aprovado e parâmetros. | Texto personalizado, até 2.000 caracteres. |
| Conexão | Número oficial selecionado. | Instância uazapi conectada da organização. |
| Público | Negócios do CRM ou lista importada. | Negócios do CRM ou lista importada. |
| Preview | Elegibilidade, dados, exclusões e previsão de custo. | Destinatários e dados da seleção. |
| Execução | Comandos oficiais por destinatário. | Registro e resultado por destinatário. |
| Controle | Iniciar, pausar, retomar e cancelar. | Iniciar, pausar, retomar e cancelar. |

Os filtros do público do CRM incluem estágio, tags presentes/ausentes, valor, temperatura, responsável e situação de resposta. A combinação dos filtros é restritiva; os destinatários ainda são selecionados na interface.

O limite local é de 200 destinatários selecionados por campanha/disparo. Negócios e lista importada são públicos alternativos na mesma solicitação, sem mistura.

### 12.1. Execução oficial

1. Gerar o preview.
2. Revisar elegíveis, excluídos, parâmetros e estimativas.
3. Criar a campanha com o hash desse preview.
4. Iniciar após confirmação e sincronização do template.
5. Acompanhar cada destinatário, entrega e falha no relatório.

Se público, template, identidade, parâmetros, mídia ou custo mudarem, o servidor pode exigir novo preview ou pausar para revisão. A campanha não executa uma seleção antiga como se nada tivesse mudado.

Uma falha isolada é registrada e não implica interromper todo o lote. Existem pausas deliberadas para mudanças ou falhas que afetam as condições da campanha, como template ou arquivo que deixou de ser válido.

### 12.2. Pausa, retomada e cancelamento

Pausar impede novas reservas de destinatários. Uma operação já reservada ou submetida pode concluir depois do clique. Cancelar não recolhe mensagens já enviadas nem garante cancelar uma submissão que já chegou ao provedor.

Retomar continua o trabalho permitido pelo estado salvo. Não equivale a reenviar todos os destinatários que falharam ou tiveram resultado desconhecido.

A criação/execução de campanhas oficiais exige Redis. Disparos uazapi também exigem Redis fora do ambiente de teste. API e workers precisam permanecer disponíveis; o navegador pode ser fechado.

### 12.3. Personalização

No oficial, parâmetros de cabeçalho/corpo podem usar valores fixos ou fontes `firstName`, `fullName`, `dealTitle`, `dealValue`, `propertyTitle` e `ownerName`. Em uma lista importada, campos de negócio, imóvel e responsável não estão disponíveis; use dados de nome ou valores fixos. Dado ausente ou texto final acima do limite exclui o destinatário do preview.

Templates sincronizados podem usar parâmetros nomeados ou posicionais. Botões com URL dinâmica têm validação própria; o CRM não permite enviar componentes especiais arbitrários. Autenticação é rejeitada pelo construtor de envio desta versão.

**Fontes:** [fontes de parâmetro](../eloscrm-api/src/modules/whatsapp-campaigns/campaigns.schema.ts), `parameterSourcesSchema`; [resolução](../eloscrm-api/src/modules/whatsapp-campaigns/parameters.ts); [construtor](../eloscrm-api/src/modules/whatsapp-outbound/template.ts), linhas 5–29.

### 12.4. Relatório de erros

O resultado por destinatário inclui estado, mensagem segura, código, etapa, número de tentativas, início e conclusão quando registrados. Campanhas oficiais também podem exibir ID do comando, mensagem, estado de entrega e custo associado.

Distinguir falha de preparação, recusa do provedor, falha de entrega posterior e resultado desconhecido. Um lote concluído não significa que todos os destinatários receberam as mensagens.

**Fontes:** [tela](<../eloscrm-web/app/(app)/broadcasts/page.tsx>); [schemas oficiais](../eloscrm-api/src/modules/whatsapp-campaigns/campaigns.schema.ts); [serviço oficial](../eloscrm-api/src/modules/whatsapp-campaigns/campaigns.service.ts); [dispatch](../eloscrm-api/src/modules/whatsapp-campaigns/dispatch.service.ts); [gate](../eloscrm-api/src/modules/whatsapp-campaigns/gate.service.ts); [disparos uazapi](../eloscrm-api/src/modules/broadcasts/broadcasts.service.ts).

## 13. Importação de destinatários

### 13.1. Formatos e limites

- Excel `.xlsx`, CSV UTF-8 e JSON.
- Arquivo até 1 MiB.
- Até 1.000 destinatários no preview; até 200 selecionados para um disparo.
- Excel usa a primeira planilha. Converta `.xls` para `.xlsx`.
- Coluna de telefone obrigatória; nome opcional, até 120 caracteres.
- Telefones brasileiros com DDD, com ou sem DDI 55; os demais países não fazem parte do importador atual.
- Preview identifica telefone inválido, nome inválido e repetição no arquivo.

Para Excel/CSV, o importador reconhece `phone`, `telefone`, `numero`, `whatsapp` ou `celular`; para nome, `name`, `nome` ou `contato`. Os cabeçalhos são normalizados para caixa/acentuação. Evite colunas equivalentes repetidas.

O CSV aceita vírgula, ponto e vírgula ou tabulação, com tratamento de campos entre aspas. No Excel, salve telefones como texto para evitar notação científica ou alteração de dígitos.

O JSON usa somente objetos com `phone` e `name`; chaves extras são recusadas. Use `phone` como string.

### 13.2. Exemplos

~~~csv
phone,name
"+55 (43) 99999-0001","Contato de exemplo"
"43999990002","Outro contato de exemplo"
~~~

~~~json
[
  { "phone": "5543999990001", "name": "Contato de exemplo" },
  { "phone": "5543999990002", "name": "Outro contato de exemplo" }
]
~~~

Os telefones acima são apenas exemplos de formato; não representam destinatários autorizados.

Arquivos para download no dashboard:

- `/examples/broadcast-recipients.xlsx`;
- `/examples/broadcast-recipients.csv`;
- `/examples/broadcast-recipients.json`.

### 13.3. Persistência e autorização

Importar não cadastra o público como leads nem cria negócios. O preview do arquivo não dispara mensagens. A seleção é guardada quando o disparo/campanha é criado.

No oficial, o preview da campanha já pode criar um contato técnico e uma identidade com origem `campaign_import`; a execução usa essa identidade no envio associado à campanha. O preview do arquivo e o preview da campanha são operações diferentes. Isso não converte a lista em cards de kanban. Uma mensagem recebida depois pode passar pela automação normal de entrada.

O schema da lista admite `consent.confirmed` e `consent.evidence` como campos opcionais. No código analisado, os fluxos de preview, preparação e submissão não impõem esses campos como autorização obrigatória nem aplicam uma supressão global por opt-out. Existe um módulo de permissões de comunicação com revisões, mas sua existência não comprova enforcement no envio. Essa integração precisa ser concluída e testada antes de afirmar que campanhas respeitam automaticamente consentimento e descadastro. Uma confirmação/evidência informada é uma declaração do gestor, não uma prova obtida automaticamente do destinatário. Não interprete “telefone reconhecido pelo parser” como confirmação de que o número existe no WhatsApp.

A leitura de XLSX possui verificações de estrutura e expansão do ZIP, além dos limites de linhas/colunas. O arquivo não é executado como código.

**Fontes:** [parser](../eloscrm-api/src/modules/campaign-imports/imports.service.ts), `parseImport`; [schema](../eloscrm-api/src/modules/campaign-imports/imports.schema.ts); [validação de planilha](../eloscrm-api/src/modules/campaign-imports/workbook.ts); [público oficial](../eloscrm-api/src/modules/whatsapp-campaigns/preview.service.ts), tratamento de `importedAudience`; [submissão](../eloscrm-api/src/modules/whatsapp-campaigns/submission.repo.ts), `checkSubmission`; [permissões registradas](../eloscrm-api/src/modules/communication-permissions/permissions.repo.ts).

## 14. Exceção manual de envio pela uazapi

Na conversa oficial, o envio pela uazapi exige conexão oficial ativa em Coexistence, instância uazapi conectada na mesma organização e correspondência do número remetente.

O destino é resolvido pela API a partir de uma identidade vigente de telefone/`wa_id` informada pelo provedor. Um BSUID sem telefone adequado não autoriza essa exceção.

A interface pede confirmação explícita. O backend exige `confirmManualException: true`, valida o texto e usa uma chave de idempotência. A intenção fica registrada no atendimento oficial antes de chamar a uazapi, com autoria e resultado.

Números uazapi diferentes do número oficial ficam disponíveis em **Disparos**, não como troca de remetente dentro daquela conversa. A ausência de uazapi elegível não provoca fallback automático.

Uma submissão sem confirmação não é repetida usando a mesma chave. A decisão de usar API não oficial continua explícita; a compatibilidade real entre todos os serviços deve ser validada com o número usado pela imobiliária.

**Fontes:** [política](../eloscrm-api/src/modules/whatsapp-inbox/uazapi-policy.repo.ts), `sameSenderNumber` e `resolveManualRoute`; [envio manual](../eloscrm-api/src/modules/whatsapp-inbox/uazapi-manual.service.ts), linhas 7–33; [persistência](../eloscrm-api/src/modules/whatsapp-inbox/uazapi-manual.repo.ts).

## 15. Criação de leads e cards

Somente mensagens oficiais recebidas ao vivo, com direção de entrada, participam da automação atual. Ecos do celular, histórico importado e novas mensagens recebidas pela uazapi não acionam a criação automática.

A automação consulta a configuração da imobiliária para:

- criar cliente/lead quando permitido;
- vincular a conversa a um cliente existente;
- distribuir responsável entre membros elegíveis;
- criar um negócio no funil/estágio configurado quando permitido.

Criar uma conversa não implica criar um card. Se não houver configuração, se `autoCreateClient` estiver desligado, se o funil/estágio não estiver disponível ou se houver ambiguidade de telefone, a mensagem pode aparecer na inbox sem novo registro no kanban.

A distribuição considera carga de negócios e o histórico de atribuição dos membros. As mudanças são registradas em auditoria. O processamento tem estado e recuperação própria; a aba **Automações** permite consultar execuções e retentar falhas autorizadas.

**Fontes:** [automação transacional](../eloscrm-api/src/modules/lead-automation/inbound-automation.repo.ts), linhas 9–73; [worker](../eloscrm-api/src/modules/lead-automation/inbound-automation.service.ts); [rotas](../eloscrm-api/src/routes/v1/whatsapp/automations/index.ts).

## 16. Custos, simulação e conferência

A aba **Custos e consumo** é restrita a donos e gestores. O módulo mantém tarifas locais, estimativas por mensagem, evidências de pricing/recibos, agregados consultados na Meta e conferências declaradas pelo gestor.

### 16.1. Tarifas e simulação

Uma tarifa considera WABA/moeda, país, categoria, condição de pricing, período de vigência e faixa de volume. O cadastro exige URL de fonte oficial. O sistema não substitui preços vigentes por valores fixos embutidos na aplicação.

A simulação recebe quantidade, data e hipóteses de volume/condições. Se faltar tarifa para cobrir um segmento, o valor fica indisponível; não vira zero. O total só é apresentado quando todos os segmentos necessários têm valor.

No compositor, a previsão usa o mercado identificado e o cenário regular de tarifa base. Um número brasileiro pode ser identificado como `BR`; uma identidade sem país exige informação adequada. A janela aberta, isoladamente, não deve ser usada para inventar um valor no relatório local.

### 16.2. Evidências e escopos

| Informação | O que demonstra |
| --- | --- |
| Preview/simulação | Previsão baseada no catálogo e nas hipóteses informadas. |
| Recibo/pricing da Meta | Evidência recebida do provedor para a mensagem. |
| Agregado Meta | Consumo agregado no escopo retornado pela consulta da WABA. |
| Conferência do gestor | Documento/referência e valores declarados manualmente. |

As consultas podem ser filtradas por conexão, contato, conversa ou campanha. O período local é limitado a 31 dias, e relatórios acima de 20 mil mensagens/registros de custo exigem recorte menor.

As estimativas são mantidas na moeda da WABA. Impostos, intermediários e câmbio não são incluídos automaticamente. Condições gratuitas e volume anterior da simulação são hipóteses, não confirmação de elegibilidade.

A conferência permite registrar total, taxas, impostos, referência do documento e nota. Ela compara escopos disponíveis sem distribuir diferenças artificialmente entre mensagens ou campanhas. Um agregado da WABA pode abranger mais que a conexão selecionada.

O módulo não deve ser apresentado como uma fatura oficial integral sincronizada. Os dados indisponíveis e os valores não resolvidos continuam visíveis como limitações da apuração.

**Fontes:** [schemas de custos](../eloscrm-api/src/modules/whatsapp-costs/costs.schema.ts), `periodSchema`, `rateFields`, `simulationSchema`, `reportSchema`; [serviço](../eloscrm-api/src/modules/whatsapp-costs/costs.service.ts), `simulate`, `preview`, `report`, `reconcile`; [analytics](../eloscrm-api/src/modules/whatsapp-costs/analytics.service.ts).

## 17. Segurança e permissões

- Tenant vem da sessão verificada; IDs enviados pelo navegador não definem a organização autorizada.
- Queries e mutações de domínio conferem organização e relações entre conexão, contato, mensagem e campanha.
- Onboarding e gerenciamento de templates exigem gestor. Custos e campanhas oficiais também usam autorização de gestor nas rotas/serviços.
- Tokens oficiais ficam cifrados no backend; respostas públicas não devem devolver o token.
- App Secret, verify token e chaves de criptografia não pertencem ao bundle do dashboard.
- Rotas de integração aplicam schemas, limites de corpo e controles de origem/rate limit conforme a operação.
- Webhook usa assinatura dos bytes originais; não usa sessão de usuário.
- Mídias ficam em bucket privado, com acesso autorizado e URLs temporárias.
- Eventos, envios e operações de gestão têm estados e auditoria; mensagens privadas não devem ser copiadas para logs de diagnóstico.

A proteção no backend permanece necessária mesmo quando um botão só aparece para gestores. Não use flags do frontend como autorização.

**Fontes:** [rotas de onboarding](../eloscrm-api/src/routes/v1/whatsapp/onboarding/index.ts); [rotas de campaigns](../eloscrm-api/src/routes/v1/whatsapp/campaigns/index.ts); [rotas de outbound](../eloscrm-api/src/routes/v1/whatsapp/outbound/index.ts); [criptografia oficial](../eloscrm-api/src/lib/whatsapp-official/crypto.ts); [envs](../eloscrm-api/src/env.ts).

## 18. Retenção, histórico antigo e desativação

A manutenção oferece preview e aplicação da vinculação de histórico uazapi, em lotes de até 100 conversas. Registros que exigem revisão são indicados individualmente. A rotina não importa grupos como atendimento oficial nem autoriza fusão indiscriminada de contatos.

A retenção remove payloads privados de eventos processados e comandos terminais elegíveis, preservando mensagens de atendimento, custos, IDs de idempotência e auditoria. Pendências, falhas e resultados incertos não devem ser tratados como trabalho concluído apenas para expurgar conteúdo.

Defaults:

| Env | Default | Finalidade |
| --- | --- | --- |
| `WHATSAPP_JOURNAL_RETENTION_DAYS` | 30 | Elegibilidade dos payloads do journal. |
| `WHATSAPP_COMMAND_RETENTION_DAYS` | 90 | Elegibilidade dos payloads de comandos. |
| `AUDIT_RETENTION_DAYS` | 365 | Retenção da auditoria geral. |

**Desativar no elosCRM** é uma operação local. Remove a credencial local da conexão, bloqueia uso, encerra trabalho cancelável e preserva resultados incertos de submissões iniciadas. Não remove automaticamente o número da Meta, não desconecta remotamente o celular e não equivale a revogar o app no portfólio.

**Fontes:** [manutenção](../eloscrm-api/src/modules/whatsapp-maintenance/maintenance.service.ts), `backfillHistory`, `purgePayloads`, `disable`; [retention](../eloscrm-api/src/modules/whatsapp-maintenance/retention.repo.ts); [desativação](../eloscrm-api/src/modules/whatsapp-maintenance/lifecycle.repo.ts), `disableConnection`.

## 19. Configuração de produção

Domínios desta instalação:

~~~text
API:       https://api.eloscrm.matratecnologia.com
Dashboard: https://eloscrm.matratecnologia.com
~~~

### 19.1. Envs da API

~~~dotenv
NODE_ENV=production
PORT=3333
DATABASE_URL=<conexão do Postgres de produção>
REDIS_URL=<conexão do Redis de produção>
BETTER_AUTH_URL=https://api.eloscrm.matratecnologia.com
WEB_ORIGIN=https://eloscrm.matratecnologia.com
PUBLIC_API_URL=https://api.eloscrm.matratecnologia.com
BETTER_AUTH_SECRET=<secret próprio de produção>

R2_ENDPOINT=<endpoint S3>
R2_ACCESS_KEY_ID=<access key do provedor>
R2_SECRET_ACCESS_KEY=<secret key do provedor>
R2_PRIVATE_BUCKET_NAME=<bucket privado>
RESEND_API_KEY=<chave do Resend>
EMAIL_FROM=elosCRM <email@dominio-verificado.com>

UAZAPI_BASE_URL=<URL da instalação uazapi>
UAZAPI_ADMIN_TOKEN=<token administrativo>
UAZAPI_TOKEN_ENCRYPTION_KEY=<chave hexadecimal de 64 caracteres>

META_GRAPH_VERSION=v26.0
META_WHATSAPP_APP_ID=<App ID>
META_WHATSAPP_APP_SECRET=<App Secret>
META_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID=<Configuration ID>
META_WHATSAPP_GRAPH_VERSION=v26.0
META_WHATSAPP_WEBHOOK_VERIFY_TOKEN=<verify token>
META_WHATSAPP_TOKEN_ENCRYPTION_KEY=<outra chave hexadecimal de 64 caracteres>

WHATSAPP_JOURNAL_RETENTION_DAYS=30
WHATSAPP_COMMAND_RETENTION_DAYS=90
AUDIT_RETENTION_DAYS=365
~~~

Os valores entre `<...>` são placeholders. Não copie credenciais locais de teste. `PORT=3333` corresponde ao Dockerfile da API; outro método de execução precisa manter a porta coerente com o proxy/serviço.

A Graph API v26.0 é a configuração do código analisado, não uma promessa de ser a versão mais recente no futuro.

Geração para uma instalação nova:

~~~sh
# Secret de autenticação
openssl rand -base64 32

# Executar separadamente para cada chave de criptografia e para o verify token
openssl rand -hex 32
~~~

App Secret, tokens dos provedores e credenciais do storage são fornecidos por seus serviços, não gerados por OpenSSL. As duas chaves de criptografia devem ser diferentes e preservadas entre deploys. Se o banco já tiver tokens cifrados, mantenha a chave que os cifrou; rotação exige recifrar os dados.

Deixe `UAZAPI_DEBUG_LOG` ausente em produção. A trilha de diagnóstico pode conter dados pessoais mesmo com tokens redigidos.

O container recebe envs de runtime pela plataforma de deploy. Não depende de copiar `.env.local` para a imagem.

### 19.2. Envs do dashboard

~~~dotenv
NEXT_PUBLIC_API_URL=https://api.eloscrm.matratecnologia.com
~~~

Passe essa variável durante o build. No Docker, ela é um build argument. O axios acrescenta `/v1`; a autenticação usa a raiz da API. Não inclua `/v1` no valor.

O runner Docker do dashboard usa `NODE_ENV=production`, `PORT=3000` e `HOSTNAME=0.0.0.0`. O proxy deve encaminhar para a porta do serviço.

**Fontes:** [envs](../eloscrm-api/.env.example); [schema de envs](../eloscrm-api/src/env.ts); [Dockerfile da API](../eloscrm-api/Dockerfile); [Dockerfile do dashboard](../eloscrm-web/Dockerfile), linhas 22–23 e 29–34; [client API](../eloscrm-web/lib/api.ts).

## 20. Configuração no app Meta

Mantenha App ID, App Secret e Configuration ID coerentes. O Configuration ID deve ser o da configuração usada no Coexistence autorizado para este app.

### 20.1. Domínios e OAuth

Em **Configurações do app → Básico → Domínios do app**, adicionar os domínios necessários, sem protocolo:

~~~text
eloscrm.matratecnologia.com
api.eloscrm.matratecnologia.com
~~~

Em **Login do Facebook para Empresas → Configurações → Domínios permitidos para o SDK JavaScript**:

~~~text
https://eloscrm.matratecnologia.com
~~~

Em **URIs de redirecionamento OAuth válidos**, incluir a página do dashboard que abre o cadastro:

~~~text
https://eloscrm.matratecnologia.com/integracoes/whatsapp
~~~

Não substitua o domínio do dashboard pelo domínio da API nesse redirect. Mantenha habilitados OAuth do cliente, OAuth na Web, HTTPS, modo estrito, login incorporado e JavaScript SDK conforme a configuração do Embedded Signup.

### 20.2. Webhook oficial

~~~text
Callback URL:
https://api.eloscrm.matratecnologia.com/webhooks/whatsapp-official

Verify Token:
o mesmo valor de META_WHATSAPP_WEBHOOK_VERIFY_TOKEN
~~~

Assinar `messages`, `history`, `smb_app_state_sync`, `smb_message_echoes` e, quando disponível, `user_id_update`.

O App Secret autentica os POSTs; o Verify Token verifica o GET inicial. Eles são segredos diferentes e não substituem o access token da conexão.

Ao usar o mesmo app Meta em dev e produção, alterar o callback do objeto direciona as entregas para o novo ambiente. Mantenha apps separados quando precisar operar os dois sem disputar essa configuração.

### 20.3. Permissões e ativos

O backend verifica `whatsapp_business_management` e `whatsapp_business_messaging`, incluindo os grants para a WABA. O uso por clientes externos também depende da configuração e do acesso concedido ao app na Meta.

Confirme que o usuário possui acesso aos ativos necessários, que o app está apto ao uso pretendido e que o número é elegível para Coexistence. Não trate verificação do portfólio, aprovação do app, aprovação de template e elegibilidade do número como o mesmo status.

Esta seção combina o fluxo documentado anteriormente pela Meta com os requisitos explícitos do código. Os nomes e a disponibilidade dos controles no painel podem mudar. A configuração remota não foi auditada ao escrever este arquivo.

**Fontes:** [implementação de Embedded Signup preservada no repo](whatsapp-embedded-signup-implementation.md); [SDK atual](../eloscrm-web/components/whatsapp-official/official-signup.tsx), linhas 118–119; [grants e callback](../eloscrm-api/src/modules/whatsapp-onboarding/onboarding.service.ts), `checkSubscriptions` e `exchange`.

## 21. Deploy e validação operacional

### 21.1. Ordem de publicação

1. Conferir os bloqueios conhecidos e a compatibilidade das dependências.
2. Fazer backup do banco e verificar o procedimento de restauração.
3. Configurar envs, Redis, storage, e-mail e URLs de produção.
4. Aplicar o schema no banco de produção antes da nova imagem.
5. Construir o dashboard com a URL pública da API correta.
6. Publicar API e dashboard com TLS.
7. Configurar callback e domínios na Meta.
8. Executar um piloto com número e destinatário autorizados.

O projeto usa `prisma db push`, sem migrations versionadas para esse fluxo. Se o comando pedir `--accept-data-loss`, pare e investigue o drift. Não use `--force-reset` em produção.

A imagem de runtime da API não deve ser presumida como ambiente com Prisma CLI e schema disponíveis. A aplicação do schema é um passo administrativo externo ao start da aplicação.

### 21.2. Checklist do piloto

- Login e sessão pelo domínio de produção.
- Health da API e acesso ao Redis/banco/storage.
- Verificação GET do webhook e recepção de POST assinado.
- Cadastro Coexistence com ativação e estados de sincronização.
- Mensagem de entrada aparece uma vez e atualiza a janela.
- Resposta pelo CRM chega ao destinatário e recebe recibos.
- Envio pelo celular aparece com origem adequada no CRM.
- Upload/download de mídia, incluindo tratamento de falha.
- Template da WABA correta sincroniza e pode ser enviado após aprovação.
- Campanha pequena prossegue com navegador fechado.
- Pausa, retomada e cancelamento preservam o resultado de cada destino.
- Destino inválido falha sem interromper os demais, salvo bloqueio deliberado da campanha.
- Lista importada não cria leads/cards por mera importação.
- Recebimento uazapi não cria nova conversa ou lead.
- Exceção manual uazapi exige mesmo remetente e confirmação.
- Custos indisponíveis continuam indisponíveis, sem virar zero.
- Auditoria e isolamento entre imobiliárias conferidos com usuários diferentes.

Esse checklist é um roteiro de aceitação, não uma declaração de que todos os itens já foram exercitados em produção.

**Fontes:** [AGENTS da raiz](../AGENTS.md), seção de deploy/schema; [Dockerfile](../eloscrm-api/Dockerfile); [bootstrap](../eloscrm-api/src/server.ts).

## 22. Diagnóstico de problemas

| Sintoma | Verificação e próximo passo |
| --- | --- |
| SDK informa domínio desconhecido | Conferir o domínio do dashboard nos domínios permitidos do SDK e salvar a configuração Meta. |
| Cadastro exige HTTPS | Abrir o dashboard por HTTPS; em dev usar túnel HTTPS para web e API com envs coerentes. |
| `OFFICIAL_WEBHOOK_NOT_READY` | Conferir callback exato em `PUBLIC_API_URL`, objeto ativo e os quatro campos exigidos. |
| `OFFICIAL_ATTEMPT_UNAVAILABLE` | Consultar a tentativa existente; ela pode estar em andamento, concluída ou expirada. Não repetir a autorização indiscriminadamente. |
| Resposta da Meta em formato inesperado | Localizar a etapa pelo código seguro, comparar com os schemas de resposta e gerar nova autorização quando exigido. Não registrar token/código bruto em logs. |
| Número “Não qualificado” | Investigar elegibilidade, estado do número e permissões/ativos na Meta. A captura isolada não identifica a causa. |
| Lead não apareceu no kanban | Conferir configuração de automação, criação de cliente/negócio, destino no funil, origem ao vivo e relatório da execução. |
| `OFFICIAL_WINDOW_CLOSED` | A janela fechou; selecionar template aprovado. |
| Template não aparece | Conferir conexão/WABA e sincronizar. A lista pertence à conta selecionada. |
| Template pendente/rejeitado | Consultar status na Meta e sincronizar; não prometer prazo de aprovação. |
| `CAMPAIGN_CHANGED` | Atualizar preview e revisar alterações de público, parâmetros, identidade, arquivo, template ou custo. |
| `CAMPAIGN_REDIS_REQUIRED` / `BROADCAST_REDIS_REQUIRED` | Configurar Redis e conferir a API responsável pela execução. |
| Destino `unknown` ou comando `uncertain` | Investigar confirmação/recibos antes de reenviar. Não interpretar como falha certa. |
| Falha individual de entrega | Consultar código e etapa por destinatário; aceitação pela Meta não garantiu entrega. |
| uazapi indisponível na conversa | Conferir número correspondente, estado conectado, Coexistence e identidade de telefone do contato. Números separados ficam em Disparos. |
| Custo indisponível | Conferir país, moeda, categoria, tarifa e vigência; não lançar zero por ausência de informação. |
| Token deixou de ser legível após deploy | Conferir as chaves de criptografia usadas no banco. Restaurar a chave correta ou executar rotação com recifragem. |
| API sobe, mas worker falha ao escrever | Conferir schema aplicado antes da imagem e falhas de banco nos jobs. Boot saudável não comprova schema compatível. |

**Fontes:** códigos dos serviços de [onboarding](../eloscrm-api/src/modules/whatsapp-onboarding/onboarding.service.ts), [outbound](../eloscrm-api/src/modules/whatsapp-outbound/outbound.service.ts), [campanhas](../eloscrm-api/src/modules/whatsapp-campaigns/campaigns.service.ts) e [custos](../eloscrm-api/src/modules/whatsapp-costs/costs.service.ts).

## 23. Referência de endpoints

Todos os caminhos `/v1` abaixo exigem sessão/organização, além das verificações de papel e origem aplicáveis. Esta tabela lista os principais contratos; schemas e rotas são a referência para campos e limites.

| Grupo | Endpoints principais |
| --- | --- |
| Onboarding | `GET /v1/whatsapp/onboarding/config`; `POST /v1/whatsapp/onboarding`; `GET /v1/whatsapp/onboarding/:id`; `POST /:id/exchange`; `POST /:id/activate` sob o mesmo prefixo. |
| Conexões | `GET /v1/whatsapp/connections`; `GET /v1/whatsapp/connections/:id`; `GET /v1/whatsapp/connections/:id/sync`. |
| Inbox | `GET /v1/whatsapp/inbox`; `GET /:id`; `GET /:id/messages`; `POST /:id/read`; `POST /:id/archive`; `DELETE /:id` sob o prefixo da inbox. |
| Vínculo e exceção manual | `POST /v1/whatsapp/inbox/conversations/:id/link-client`; `POST /v1/whatsapp/inbox/conversations/:id/uazapi/messages`. |
| Envio oficial | `POST /v1/whatsapp/outbound/connections/:connectionId/messages`; `GET /v1/whatsapp/outbound/commands/:id`. |
| Upload | `POST /v1/whatsapp/outbound/connections/:connectionId/uploads`. |
| Templates | `GET`/`POST /v1/whatsapp/outbound/connections/:connectionId/templates`; `POST /templates/sync`; `DELETE /templates/:id` sob o prefixo da conexão. |
| Campanhas oficiais | `GET`/`POST /v1/whatsapp/campaigns`; `POST /preview`; `POST /targets`; `GET /:id`; `POST /:id/preview`, `/refresh`, `/start`, `/pause`, `/resume`, `/cancel` sob o prefixo de campanhas. |
| Disparos uazapi | `GET`/`POST /v1/broadcasts`; `POST /preview`; `GET /:id`; `POST /:id/pause`, `/resume`, `/cancel` sob o prefixo de broadcasts. |
| Importação | `POST /v1/broadcasts/imports/preview`, usado pelo preview de arquivo para ambos os provedores. |
| Custos | `/v1/whatsapp/costs`, com tarifas, importação, simulação, preview, analytics, mercados e conferências. |
| Eventos | `GET /v1/whatsapp/events`; `POST /v1/whatsapp/events/:id/replay`. |
| Automação | `GET /v1/whatsapp/automations`; `POST /v1/whatsapp/automations/:messageId/retry`. |
| Manutenção | `POST /v1/whatsapp/maintenance/history`; `POST /retention`; `POST /connections/:id/disable` sob o prefixo de manutenção. |
| Mídia oficial recebida | `GET /v1/whatsapp/official-media/:id`; `POST /v1/whatsapp/official-media/:id/retry`. |
| Webhook público | `GET`/`POST /webhooks/whatsapp-official`, com autenticação própria da Meta. |

**Fontes:** arquivos de rotas em [whatsapp](../eloscrm-api/src/routes/v1/whatsapp/) e [broadcasts](../eloscrm-api/src/routes/v1/broadcasts/index.ts).

## 24. Estado da verificação e limitações conhecidas

A auditoria executada em 07/10/2026, antes deste documento, confirmou builds e typechecks da API e do dashboard. Isso demonstra compilação do código avaliado; não comprova publicação ou funcionamento integral em produção.

A suíte completa teve 706 testes aprovados, duas falhas de asserção e 62 testes ignorados devido a três falhas de setup por timeout. Reexecutar os cinco arquivos envolvidos com menos concorrência resultou em 141 testes aprovados e duas falhas. Os timeouts não se repetiram. As duas expectativas restantes ainda refletem contratos anteriores: persistência de entrada uazapi e status HTTP da restrição de atendimento.

A leitura de código feita para este documento identificou uma pendência adicional: enforcement de consentimento/opt-out nos fluxos de envio. O contrato admite consentimento opcional e há armazenamento de permissões, mas isso não está aplicado como bloqueio obrigatório nas campanhas analisadas. Outra característica a considerar é a persistência de contatos técnicos durante o preview oficial de listas.

A auditoria também reportou alertas em dependências instaladas, incluindo Next.js e Fastify. A aplicabilidade depende das condições do advisory e precisa ser revisada antes de considerar a versão pronta para produção. O merge/push realizado não resolveu esses alertas nem ajustou os dois testes.

Não foram confirmados nesta documentação: envs reais de produção, callback remoto atual, permissões efetivas de todos os clientes, elegibilidade de cada número, backup restaurado, consumo conciliado com uma fatura real e um piloto completo de disparo em produção.

A configuração de Embedded Signup e as regras comerciais da Meta podem mudar. A versão de Graph API, nomes de eventos, exigências de aprovação e tarifas precisam ser revalidados quando o app ou a documentação oficial mudar. `sessionInfoVersion: "3"` é o parâmetro usado pelo SDK neste código e não deve ser interpretado isoladamente como a versão comercial de todo o produto Embedded Signup.

Este documento registra a implementação presente. Melhorias futuras devem atualizar primeiro os contratos efetivos e depois as seções afetadas, sem transformar um plano em funcionalidade entregue.

> Criado em 2026-10-07 17:11 (-03) · Última modificação: 2026-10-07 17:26 (-03)
