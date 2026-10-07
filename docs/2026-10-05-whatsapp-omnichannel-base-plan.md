# Plano base de WhatsApp omnichannel no elosCRM

Plano aprovado para avanço por etapas. Integração direta no `eloscrm-api` e no `eloscrm-web`, usando o banco, a autenticação e a infraestrutura do próprio produto. Este plano substitui a proposta anterior de um hub externo para esta entrega.

## 1. Decisões e alcance

- Cloud API será o canal principal de atendimento e automações.
- Coexistence é requisito desta entrega: o mesmo número oficial será usado no aplicativo WhatsApp Business do celular e no elosCRM pelo navegador do PC.
- uazapi permanecerá para disparos ocasionais e para a opção explícita de continuar o atendimento quando a janela oficial estiver fechada.
- O piloto terá um número oficial em Coexistence e um número uazapi separado por imobiliária. Coexistence conecta WhatsApp Business e Cloud API; a uazapi não será conectada ao número oficial.
- O CRM reunirá as mensagens dos dois números por contato, mantendo a identificação da conexão em cada interação.
- O produto guardará e mostrará custos de uso oficial, com simulação de atendimento e disparos e identificação explícita da origem e precisão de cada valor.
- Suporte a Business-scoped user IDs (BSUID) faz parte da fundação: telefone não será obrigatório para receber, identificar ou responder a um contato pelo oficial.
- O diagnóstico da sessão consultou token, app, portfolio, WABA e número. O piloto atual usa Cloud API sem Coexistence; os testes reais restantes foram adiados pelo usuário. Isso não comprova funcionamento do canal no CRM.

Premissas propostas: começar com uma imobiliária, onboarding em Coexistence assistido por gestor e habilitação da exceção uazapi por organização. Owner/admin controla conexões e disparos; o corretor usa a exceção apenas quando autorizado. Embedded Signup para conectar uma conta WhatsApp Business existente faz parte do primeiro piloto, condicionado aos requisitos efetivos do app e da conta.

Omnichannel, nesta entrega, significa atendimento unificado de WhatsApp oficial em Coexistence e uazapi. Outros canais, chatbot, IA e integração de chamadas não entram no primeiro ciclo. A arquitetura deve separar provedor e conversa sem construir antecipadamente integrações com outros canais.

## 2. Base atual verificada

Checkout consultado: `599c46b58b64f8dc0d8a85d8aa62473100cb970e`. As referências abaixo descrevem código local, sem comprovar configuração ou comportamento de produção.

| Situação atual | Evidência no código | Consequência para a entrega |
| --- | --- | --- |
| Uma instância uazapi por organização | [`schema.prisma:612`](../eloscrm-api/prisma/schema.prisma#L612), campo `organizationId @unique` | Preservar essa instância e acrescentar a conexão oficial |
| Conversa exige `instanceId` uazapi; unicidade por instância e chat | [`schema.prisma:695`](../eloscrm-api/prisma/schema.prisma#L695) e [`schema.prisma:724`](../eloscrm-api/prisma/schema.prisma#L724), `@@unique([instanceId, chatid])` | Separar conversa agregada de conversa no provedor |
| `providerId` é o ID da mensagem uazapi, não o nome do provedor | [`schema.prisma:736`](../eloscrm-api/prisma/schema.prisma#L736), comentário do campo | Não reutilizar esse campo como enum de transporte |
| A ficha do contato mostra somente a primeira conversa retornada | [`whatsapp-tab.tsx:23`](../eloscrm-web/app/%28app%29/clients/%5Bid%5D/whatsapp-tab.tsx#L23), `conversations[0]` | Trocar essa seleção pelo histórico agregado |
| Ingestão evita vínculo quando o telefone tem mais de um candidato | [`ingest.service.ts:39`](../eloscrm-api/src/modules/whatsapp/ingest.service.ts#L39), `candidates.length !== 1` | Manter a resolução manual das ambiguidades |
| Disparos usam o envio de texto uazapi e registram a mensagem na conversa | [`broadcasts.service.ts:220`](../eloscrm-api/src/modules/broadcasts/broadcasts.service.ts#L220), `sendText` | Preservar histórico e acrescentar conexão explícita ao disparo |
| Fila roda inline e ignora atraso sem Redis | [`queue.ts:52`](../eloscrm-api/src/lib/queue.ts#L52) e [`queue.ts:63`](../eloscrm-api/src/lib/queue.ts#L63), ramo sem `REDIS_URL` | Exigir Redis para campanhas reais e operação assíncrona |
| Meta existente importa leads de formulários | [`meta.sync.service.ts:14`](../eloscrm-api/src/modules/meta/meta.sync.service.ts#L14), `META_SYNC_QUEUE = "meta-lead-sync"` | Manter Lead Ads e criar a integração de mensagens separadamente |
| Inbox usa polling | [`conversations.ts:35`](../eloscrm-web/lib/queries/conversations.ts#L35), `refetchInterval` | Reaproveitar inicialmente; socket não é pré-requisito |

## 3. Atendimento e roteamento

### Histórico e identidade

A caixa de entrada terá uma entrada por contato identificado dentro da imobiliária. Ela mostrará mensagens recebidas e enviadas nos dois canais, anexos, autor do envio no CRM, origem manual/automação/campanha e estados disponíveis no provedor. A ficha do contato usará o mesmo histórico, com filtro opcional por número/conexão.

### Uso no celular e no PC com Coexistence

O corretor usa WhatsApp Business no celular e elosCRM no navegador com o mesmo número oficial. A Meta oferece espelhamento de mensagens individuais entre Business App e Cloud API; o CRM precisa ingerir os eventos correspondentes. Coexistence exige conta existente no Business App, elegibilidade e onboarding específico, incluindo os requisitos de Tech Provider/Solution Partner aplicáveis. Fonte: [Coexistence, funcionamento e requisitos](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users).

No CRM, registrar a origem `cloud_api`, `business_app` ou `history` além da conexão oficial. Envio pelo celular aparece identificado como tal; sem identidade verificável do operador, não atribuir a um corretor específico. Mensagem enviada pelo CRM continua vinculada ao usuário que realizou o envio. O mesmo número não deve gerar duas conexões nem duas bolhas apenas por haver dois pontos de atendimento.

O envio manual pelo Business App não segue a janela da Cloud API nem a renova. O CRM mantém suas regras de template/janela, sem tentar delegar automaticamente envios ao celular. Fonte: [Coexistence, customer service window](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users#customer-service-window).

### Onboarding e sincronização inicial

Adicionar “Conectar WhatsApp Business” à integração oficial, com Embedded Signup v4 conforme a documentação vigente. Capturar a conclusão `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING`, trocar o código no backend e verificar os ativos antes de associá-los à organização autenticada. Vincular o fluxo a uma sessão de onboarding com estado, validade e verificação de origem; IDs retornados pelo navegador não comprovam propriedade. Não exigir apagar a conta do celular nem registrar novamente o número durante esse fluxo.

Persistir progresso e referências das solicitações de sincronização. Informar ao gestor se a conexão está iniciando, sincronizando, pronta, parcial ou com falha. Disparar sincronização de contatos/histórico imediatamente após onboarding, observando o prazo e a execução única das solicitações documentadas; um aceite da API não comprova que o usuário compartilhou histórico. Referência: [onboarding e sincronização](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users#synchronizing-whatsapp-business-app-data).

Sincronizar somente o histórico autorizado e disponibilizado. A Meta documenta até seis meses de conversas individuais; grupos não são sincronizados, e a disponibilidade de mídia histórica é mais restrita. A tela precisa informar alcance, pendências e conclusão sem prometer importar todas as mídias antigas. Fonte: [comparação de recursos](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users#feature-comparison).

O piloto deve validar celular → CRM e CRM → celular num número real do Business App. Número de teste Cloud API, sozinho, não comprova Coexistence. A operação também deve detectar desconexão/revinculação e orientar o gestor sobre requisitos de atividade do app e dispositivos compatíveis, conforme a documentação; PC neste plano significa elosCRM pelo navegador.

Contatos ainda sem cadastro precisam aparecer no inbox e poder ser vinculados a um `Client` existente ou originar um novo lead. Identidades de WhatsApp são vinculadas dentro da organização: número completo normalizado, `wa_id`, BSUID e seu escopo de Business Portfolio, JID ou LID, conforme o provedor. `phoneKey` auxilia a busca; não é identidade global nem autoriza unir automaticamente contatos ambíguos. Vínculo manual deve ser auditável e corrigível sem alterar a mensagem original.

### Identidade oficial com BSUID

A referência Meta define BSUID por par Business Portfolio/usuário, admite telefone ausente e descreve regeneração do ID na troca de número. Username pode mudar sem alterar o BSUID. Fonte: [Business-scoped user IDs, seções Business-scoped user ID e Phone numbers](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids#business-scoped-user-id).

O CRM manterá um ID interno estável e aliases externos com escopo, validade e proveniência. A chave de identidade oficial será composta por `organizationId`, `businessPortfolioId`, tipo e valor do identificador. Mesmo BSUID ou telefone em outra organização não autoriza unir contatos. `parent_user_id` será preservado quando recebido, sem pressupor adesão a parent BSUIDs nem compartilhamento de dados entre imobiliárias.

Normalizar os identificadores dos diferentes blocos: `contacts.user_id`/`parent_user_id`, `messages.from_user_id`/`from_parent_user_id` e `statuses.recipient_user_id`/`recipient_parent_user_id`, mantendo compatibilidade com `wa_id`, `from` e `recipient_id` quando presentes. Não interpretar BSUID como telefone nem exigir todos os campos em eventos de falha. Referência: [webhooks e campos de identidade](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids#webhook-identifier-quick-reference).

Assinar e processar `user_id_update`, conciliando `previous`/`current` no mesmo contato, com idempotência e auditoria; tratar também eventos `system` de troca de número. Conflito de aliases exige revisão, sem sobrescrever outro contato. Mensagens antigas preservam a identidade usada na época. Referência: [user_id_update e system messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids#user_id_update-webhooks).

O adapter oficial usará `recipient` para endereçar BSUID e `to` para telefone conforme o contrato Meta, sem misturar os dois inadvertidamente. A página consultada contém cronograma e avisos de disponibilidade; confirmar essa capacidade no piloto. Referência: [send message requests](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids#send-message-requests).

Sem telefone conhecido, mostrar nome/username disponível, permitir atendimento oficial e indisponibilizar a rota uazapi com uma ação para solicitar o número. Prever solicitação voluntária por `REQUEST_CONTACT_INFO`/`request_contact_info`, quando disponível na conta e permitida pela janela/template. Só unir a identidade oficial à uazapi com vínculo já autorizado ou evidência de que o número pertence ao interlocutor; um cartão de contato de terceiro não basta. Referência: [solicitação de telefone](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids#requesting-phone-numbers-from-users).

O cadastro `Client.phone` já é opcional no schema atual ([`schema.prisma:271`](../eloscrm-api/prisma/schema.prisma#L271)). Conferir serviços, schemas, automações, campanhas e telas para que nenhum fluxo oficial dependa implicitamente de telefone. A simulação de tarifa usará o país disponível na identidade/BSUID; se não houver evidência suficiente, exibirá valor indisponível em vez de assumir Brasil. Referência do prefixo: [country codes](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids#country-codes).

A vinculação precisa convergir para um agregado por contato, inclusive quando mensagens dos dois canais chegam simultaneamente. Contagem de não lidos é agregada sem contar reentregas; marcar como lido no CRM e enviar recibo ao provedor são operações distintas, respeitando as capacidades de cada conexão.

Grupos uazapi existentes continuam separados das conversas individuais. A primeira entrega oficial cobre atendimento individual; não tenta converter grupos nem perder seu histórico.

Com números separados, o cliente verá duas conversas no próprio WhatsApp. A unificação ocorre no CRM. Uma resposta recebida no número uazapi pertence àquela conexão e não abre a janela do número oficial. Esta separação é uma regra do modelo proposto, coerente com a janela de atendimento baseada em mensagens recebidas na Cloud API; referência: [envio de mensagens e janela de atendimento](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages#customer-service-windows).

### Escolha de envio

| Situação | Comportamento proposto |
| --- | --- |
| Atendimento iniciado no oficial, janela aberta | Responder pelo número oficial com texto ou mídia suportada |
| Janela oficial fechada | Oferecer template aprovado e a alternativa uazapi, quando habilitada |
| Resposta a uma mensagem recebida na uazapi | Selecionar a conexão uazapi da mensagem; troca para o oficial exige escolha explícita |
| Novo contato sem conversa no oficial | Iniciar pelo oficial com template aprovado; uazapi exige a mesma autorização da exceção |
| Falha ou indisponibilidade do oficial | Mostrar o estado real e preservar o envio; não trocar de provedor automaticamente |
| Disparo ocasional pela uazapi | Gestor escolhe a conexão antes de criar a campanha |

O composer deve mostrar o número remetente, o canal selecionado e o estado da janela. Quando oferecer a exceção, explicará que a mensagem sairá por outro número. O envio registrará ator, conexão, motivo da exceção e mensagem resultante. O motivo pode ser uma opção objetiva, sem exigir conteúdo pessoal em texto livre.

A exceção uazapi também exige uma identidade destinatária compatível e número vinculado. Janela oficial fechada, sozinha, não garante que seja possível usar o outro provedor.

O backend decide a elegibilidade novamente no envio. Janela aberta na tela não garante janela aberta na hora de executar o comando. Citação/resposta nativa, reação e outras ações remotas precisam referenciar uma mensagem da mesma conexão e destinatário; não se pode citar nativamente pelo oficial uma mensagem enviada pela uazapi.

### Janela oficial e templates

A Cloud API permite resposta livre dentro de 24 horas da mensagem do usuário; fora da janela, exige template aprovado. O envio de um template, sozinho, não libera texto livre: é necessário o retorno do usuário. Fonte: [política WhatsApp Business, seção 2](https://business.whatsapp.com/policy).

Guardar `lastCustomerMessageAt` e `serviceWindowExpiresAt` por conexão oficial e identidade destinatária. Calcular com o timestamp do evento recebido, sem deixar reentrega ou evento antigo prolongar a janela. Mensagem outbound, status de entrega, histórico importado e interação na outra conexão não renovam esse prazo.

Manter catálogo por WABA com nome, idioma, categoria, estado e componentes do template. Na primeira entrega, sincronizar e usar templates criados no WhatsApp Manager; um editor completo de templates fica fora do escopo. Validar variáveis no servidor e guardar a versão/conteúdo efetivamente enviado. Revalidar o estado conhecido na execução e tratar recusa do provedor sem mudar para uazapi.

A opção uazapi é uma exceção operacional solicitada, sem transformar o envio em mensagem oficial ou estender sua janela. Uso não autorizado e disparos em escala podem levar a restrições; limitar frequência não garante proteção contra bloqueio. Fonte: [política WhatsApp Business, seção 7](https://business.whatsapp.com/policy).

## 4. Modelo e módulos propostos

Preferir uma conversa agregada com subconversas por conexão. Apenas juntar duas listas na tela manteria o acoplamento à uazapi e dificultaria roteamento, paginação e contagem de não lidos. Um hub externo acrescentaria um produto e um contrato que já saíram do escopo.

| Entidade | Responsabilidade |
| --- | --- |
| `ChannelConnection` | Organização, provedor (`cloud_api` ou `uazapi`), número, estado, capacidades e referência às credenciais; no oficial, Business Portfolio, WABA, `phone_number_id`, moeda e timezone da conta |
| `Conversation` | Agregado de atendimento dentro da organização, vínculo opcional ao `Client`, arquivo e resumo das interações |
| `ConversationChannel` | Conversa com um destinatário em uma conexão, IDs externos, identidade e janela oficial; vínculo único por conexão e identidade externa |
| `ContactIdentity` | Aliases externos associados ao contato interno, com tipo, escopo de portfolio/conexão, proveniência e histórico de alteração |
| `WhatsappMessage` | Mensagem canônica, agregado, subconversa, conexão, IDs externos, direção, tipo, conteúdo, autor, origem e estados |
| `WebhookEvent` | Evento autenticado recebido, conexão/tenant resolvidos, estado de processamento, tentativas e dados necessários à recuperação |
| `OutboundCommand` | Intenção durável de envio, chave de idempotência, conexão, payload validado e resultado |
| `WhatsappTemplate` | Catálogo oficial e snapshot utilizado no envio |
| `Broadcast` / `BroadcastRecipient` | Campanha e resultados por destinatário, com conexão fixada e vínculo à mensagem/ao comando |
| `WhatsappRate` | Tarifa versionada por categoria, mercado, moeda, faixa de volume e intervalo de vigência, com referência da fonte |
| `MessageCost` | Uma apuração por mensagem oficial, com metadados de pricing, tarifa aplicada, valor calculado, moeda e estado de conciliação |
| `UsageCostSnapshot` | Dados agregados reportados pela Meta, período/dimensões, moeda, origem, versão de sincronização e conciliação financeira disponível |

Os nomes são propostas para o schema, não entidades já implementadas. Evitar duplicar a mensagem em tabelas separadas por provedor. A referência externa deve incluir organização/conexão e ID da mensagem; IDs de provedores diferentes não podem colidir ou atualizar a mensagem errada.

Desconectar ou desativar uma conexão não pode excluir seu histórico por cascade. Troca de credencial ou número preserva a origem antiga das mensagens; exclusão de dados segue procedimento próprio.

Adapter Cloud API e adapter uazapi implementam as operações necessárias para o atendimento. A camada de aplicação resolve organização, conversa, permissão e rota antes de chamar o adapter. Usar capacidades para ações remotas, verificadas no backend. Favoritos do CRM, vínculo ao contato e demais ações locais continuam independentes de capacidades do provedor.

Mudanças previstas abrangem schema, módulos de WhatsApp/broadcasts, novo cliente Cloud API, webhooks, jobs, tipos duplicados do web, queries e inbox/ficha. Lead Ads mantém seus contratos. Segredos do app e credenciais oficiais ficam no backend, com configuração e cifra independentes da integração uazapi.

## 5. Recebimento, envio e recuperação

### Webhooks

1. Validar a autenticação antes de aceitar o evento. No oficial, desafio GET e assinatura `X-Hub-Signature-256` do POST com HMAC-SHA256 sobre os bytes originais, usando o app secret e comparação em tempo constante. Referência: [validação de POST no endpoint Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint).
2. Resolver a conexão e a organização pelo cadastro autorizado de WABA/`phone_number_id` ou instância uazapi. Não confiar em tenant fornecido pelo payload ou navegador.
3. Persistir o evento autenticado no Postgres antes de responder `200`. Se a gravação falhar, responder erro recuperável. Proteger tamanho do corpo e volume do endpoint sem rejeitar eventos legítimos por exigir exatamente o mesmo conjunto de campos.
4. Processar em worker e gravar mensagem, estado, vínculo e efeitos locais com idempotência. Um envelope Meta pode conter vários eventos; processar todos, com identidade e resultado individualizados.
5. Registrar falhas persistentes e permitir reprocessamento dos eventos armazenados. Redis coordena a execução; o Postgres guarda o que ainda precisa ser executado.

A configuração do app deve incluir sua assinatura na WABA; callback validado, sozinho, não comprova recebimento. Referência: [assinaturas de webhooks, coleção oficial Meta](https://www.postman.com/meta/whatsapp-business-platform/folder/ozgs3jn/webhook-subscriptions).

O replay é dos eventos capturados pelo CRM. Não existe promessa de recuperação irrestrita de webhooks não recebidos. A sincronização inicial de histórico em Coexistence é um mecanismo separado, com consentimento, alcance e prazo próprios. Referências: [endpoint de webhook Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint) e [sincronização de Coexistence](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users#synchronizing-whatsapp-business-app-data).

### Eventos de Coexistence

Preparar os receptores antes de iniciar onboarding e assinar `history`, `smb_app_state_sync` e `smb_message_echoes`, além dos eventos oficiais já previstos. `history` fornece importação; `smb_app_state_sync`, contatos; `smb_message_echoes`, envios pelo Business App. Referência: [configuração dos webhooks de Coexistence](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users#setting-up-your-app).

Deduplicar pelo ID externo dentro da conexão, inclusive quando a mesma mensagem aparece no histórico e no tráfego live. Conciliar eco/status com a mensagem já existente, preservando autor, mídia e origem conhecidos. Não assumir que a chegada de um eco prova que ele foi enviado pelo CRM.

Mensagens importadas e ecos outbound do celular não incrementam não lidos, não abrem a janela oficial nem acionam campanhas, criação de lead/negócio ou outras automações como se fossem novas mensagens recebidas. Sincronização de contatos resolve aliases/vínculos quando seguros; não deve criar leads automaticamente para toda a agenda do celular. Inbound live continua seguindo as regras de ingestão e automação configuradas pela imobiliária.

Guardar prazo e `request_id` de cada sincronização, consentimento/resultado disponíveis, lotes e progresso persistido. Recuperar processamento local por journal, sem repetir cegamente uma chamada externa que só pode ocorrer uma vez no onboarding. Se o fluxo inicial não puder ser concluído, apresentar a pendência e o procedimento de novo onboarding conforme a Meta; não declarar sincronização concluída só por aceitar a solicitação.

### Envios e estados

Persistir comando e mensagem local antes da chamada externa, com idempotência por organização e chave do comando. Repetir a mesma chave retorna o mesmo resultado; usá-la com payload diferente gera conflito. Claim/lock no worker impede dois processadores de enviar o mesmo comando simultaneamente.

Distinguir intenção pendente, aceitação do provedor, entrega, leitura, falha confirmada e resultado incerto. Um HTTP de sucesso não equivale a entrega. Status repetidos ou fora de ordem não regridem leitura para entrega; eventos que chegam antes da resposta HTTP aguardam conciliação pelo ID externo.

Timeout depois de submeter a mensagem vira `unknown`, sem reenvio automático nem troca de canal. Conciliar por resposta/webhook quando possível; se não houver evidência suficiente, manter visível para revisão. Não prometer exatamente um envio externo quando o provedor não oferece idempotência para aquela operação.

O journal e os comandos precisam de uma rotina que encontre trabalho não processado e o enfileire novamente após reinício/falha do Redis. Essa recuperação deve funcionar também quando o processo morre entre o commit no banco e o enqueue.

### Mídia e histórico

Baixar mídia de cada provedor para storage privado, com validação de tamanho/tipo e URLs temporárias autenticadas. Downloads externos precisam restringir hosts/destinos e redirects; não confiar numa URL arbitrária do webhook. Falha de mídia não pode apagar ou esconder a mensagem recebida.

Preservar texto, imagem, vídeo, áudio/documento e localização/contato recebidos quando suportados. Conteúdo desconhecido vira item identificável de tipo não suportado. Ações avançadas só entram após confirmar suporte no provedor e na versão utilizada.

“Toda interação” cobre o histórico já armazenado, a importação autorizada em Coexistence e os eventos disponíveis a partir da conexão, incluindo envios no Business App. Importação adicional pela uazapi depende dos dados que o provedor ainda disponibiliza. Grupos do Business App, chamadas e recursos sem evento de sincronização suportado não terão seu histórico prometido no CRM.

## 6. Campanhas, automações e controles

Preservar o fluxo atual de seleção de negócios/destinatários. Fixar conexão e conteúdo na criação da campanha, deduplicar pela identidade destinatária com escopo mesmo quando ela tem vários negócios, registrar resultado por pessoa e inserir cada envio no histórico agregado. Disparo oficial pode endereçar BSUID quando suportado; disparo uazapi depende do número conhecido.

A campanha precisa de preview, execução espaçada com Redis, cancelamento dos envios ainda pendentes e resultados `pending`, `sent`, `failed`, `skipped` ou `unknown`. Esses estados são propostas para a evolução do modelo. Cancelar não recolhe mensagens já submetidas ao provedor. Disponibilizar contagens de entrega/leitura quando houver eventos, sem chamar `sent` de `delivered`.

Registrar permissão para comunicação e descadastro. A supressão vale para os dois canais e deve ser revalidada pelo worker antes de cada disparo, mesmo após o preview. Referência: [política WhatsApp Business, seção 1](https://business.whatsapp.com/policy).

Automações existentes de vínculo/criação de lead e entrada no funil devem funcionar para os dois provedores, sem duplicar lead ou negócio por reentrega ou pela segunda conexão. Mensagem persistida tem prioridade; efeitos que falham ficam registrados e recuperáveis. Automações outbound usam o oficial por padrão e respeitam janela/template; não acionam a exceção uazapi por conta própria.

Permissões e isolamento são verificados no backend em leitura, envio, vínculo, mídia, campanhas e reprocessamento. Tenant de rotas humanas continua vindo da sessão Better Auth. Credenciais de cada imobiliária ficam cifradas e não saem para o navegador. Auditoria registra referências, ator, conexão e motivo, sem copiar conteúdo privado para logs. Journal contém dados de negócio protegidos, com acesso restrito, retenção e procedimento de exclusão.

## 7. Custos de uso e simulação

### Valores e suas fontes

Separar quatro estados de informação, sem somá-los como se fossem despesas distintas:

| Informação | Origem e uso |
| --- | --- |
| Estimativa antes do envio | Simulação pela tarifa vigente e hipóteses exibidas; não é débito |
| Custo calculado após entrega | Mensagem entregue + classificação recebida + snapshot da tarifa; permanece estimativa de apuração |
| Custo reportado pela Meta | Snapshot de analytics da conta, com data da consulta e indicação de valor aproximado |
| Custo conciliado com faturamento | Valor de período confrontado com documento/total financeiro disponível; só recebe essa classificação após conferência |

A documentação de `pricing_analytics` define `COST` como cobrança aproximada das mensagens entregues, na moeda da WABA; a métrica não é retornada quando a WABA compartilha uma linha de crédito de Solution Partner. Fonte: [analytics, parâmetros de pricing analytics](https://developers.facebook.com/documentation/business-messaging/whatsapp/analytics#pricing-analytics-parameters). Ausência de métrica ou falha de sincronização nunca será mostrada como gasto zero.

Guardar os metadados `pricing` dos status oficiais, a categoria reportada, o modelo/tipo de cobrança e a condição de cobrança disponível. Um HTTP aceito ou evento `sent` não confirma despesa de mensagem entregue. Receber `delivered`, `read` repetido ou reprocessar webhook não pode contabilizar o custo novamente. Referência: [pricing, webhooks](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing#webhooks).

Separar mensagens enviadas via Cloud API das mensagens manuais do Business App e das importadas. Não aplicar tarifa de envio da API a um eco do celular nem gerar novo custo por importar histórico. A origem deve aparecer nos detalhes financeiros para que o gestor entenda quais envios foram contabilizados. Referência: [Coexistence, pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users#pricing).

Sincronizar snapshots de uso com chave por organização/WABA/período/dimensões e atualizar revisões sem acumular duplicatas. Guardar a moeda original e usar `Decimal` ou equivalente para tarifas e somas, sem arredondamento prematuro para centavos. Conversão para reais é informativa e deve guardar taxa, data e fonte do câmbio; não substituir o valor original. Não somar moedas diferentes sem conversão explícita.

Exibir o custo calculado atribuível por contato, atendimento e campanha, e o reportado pela Meta nos recortes efetivamente fornecidos pela API. Analytics agregados não provam um custo exato por mensagem/campanha: onde não houver atribuição direta, manter o rótulo estimado e mostrar o valor agregado da conta separadamente. Tratar tráfego fora do CRM como diferença a conciliar, sem distribui-lo artificialmente entre campanhas.

### Tarifas, vigência e divergência nas fontes

A consulta de 2026-10-05 encontrou fontes oficiais divergentes: a [página principal de pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing) ainda descreve service e utility na janela como gratuitos; a [página de atualização para non-template messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages#summary-of-timeline) anuncia cobrança dessas mensagens a partir de 2026-10-01. Isso precisa ser confrontado com as tarifas e os eventos da conta piloto. Nenhum fluxo deve codificar “janela aberta = custo zero”.

Importar/cadastrar tarifas a partir de fonte oficial identificada e versioná-las por vigência. Considerar mercado do destinatário, categoria, moeda, faixa de volume e eventual gratuidade elegível, conforme a regra efetivamente aplicável à conta. Gratuidade, janela de atendimento de 24h e free entry point de 72h são conceitos separados: a simulação deve consultar sua elegibilidade, sem conceder envio livre só porque estimou custo zero.

Mudança futura de tarifa não recalcula silenciosamente o histórico. Reclassificação recebida da Meta gera nova apuração rastreável. Simulação sem tarifa válida, país ou dados suficientes mostra a pendência; não usa número inventado ou tarifa padrão oculta. Custos de provedor/intermediário, impostos e câmbio ficam separados quando conhecidos; tarifa Meta não será apresentada como custo operacional total. A rota uazapi não será rotulada “gratuita” apenas por não usar essa tarifa.

### Simuladores

- No composer, apresentar estimativa da mensagem oficial selecionada, com categoria/template, remetente e condições aplicadas. A estimativa acompanha alterações da mensagem e da seleção de canal; a regra de janela continua sendo validada no envio.
- No preview da campanha, mostrar destinatários elegíveis, exclusões, quantidade de mensagens por pessoa, total estimado e quebra por país/categoria/moeda. O cenário padrão considera entrega de todas as mensagens elegíveis e explicita essa hipótese.
- Na área de custos, simular volume de envios por categoria/mercado e sequência de atendimento. Quantidade de respostas futuras é uma entrada declarada da simulação, sem prever comportamento do contato.
- Salvar o snapshot da simulação na criação do disparo. Revalidar tarifa e elegibilidade antes da execução; quando houver diferença material, apresentar a nova estimativa antes de começar, em vez de iniciar automaticamente com a projeção antiga.

As faixas de volume usam o escopo documentado pela Meta e os dados disponíveis da conta. Sem volume consolidado suficiente, usar cenário identificado pela tarifa base, sem prometer desconto. Mensagens falhas, canceladas e de resultado incerto aparecem separadamente; resultado incerto não é custo confirmado nem garantia de custo zero.

## 8. Telas e ajustes de interface

| Área | Mudança prevista |
| --- | --- |
| Integrações → WhatsApp oficial | Nova aba com “Conectar WhatsApp Business”, confirmação no celular, progresso de sincronização, estado de Coexistence, número, portfolio/WABA e permissões da exceção |
| Integrações → Templates | Nova aba de catálogo sincronizado, aprovação e preview |
| Custos e consumo | Nova área para owner/admin com uso por período/número/categoria, origem dos valores, sincronização, diferenças de conciliação e simulador de volume/atendimento |
| Conversas | Histórico agregado, origem celular/CRM/importação, canal/número selecionado, janela, estimativa antes do envio, detalhes de custo conforme permissão e solicitação de telefone quando necessário |
| Ficha do contato | Histórico dos dois canais e identidades vinculadas, inclusive atendimento sem telefone |
| Disparos | Simulação no preview, conexão explícita e comparação posterior entre estimado e custo calculado/reportado disponível |
| Diagnóstico | Estado dos dois provedores, Coexistence, progresso/pendências de contatos e histórico, falhas de processamento e sincronização de uso/tarifas |

Custos detalhados e acesso aos dados financeiros terão autorização server-side. Owner/admin visualiza os totais da organização; acesso do corretor à estimativa da mensagem segue permissão proposta. O composer pode funcionar mesmo quando o usuário não tem acesso ao painel financeiro. Não expor tokens ou detalhes de webhook nas telas de atendimento.

## 9. Entrega em etapas e critérios de aceite

| Etapa | Entrega | Verificação que permite avançar |
| --- | --- | --- |
| 0. Configuração Meta | Conferência read-only dos requisitos Coexistence/Tech Provider, Embedded Signup, número Business App, ativos, subscriptions, moeda e pricing analytics | Elegibilidade e estado do número conhecidos; requisitos pendentes e divergência tarifária registrados sem alterar configuração |
| 1. Fundação e preservação | Separação conexão/subconversa/agregado, aliases BSUID, backfill local e compatibilidade uazapi | Dados antigos preservados; contato sem telefone funciona; BSUIDs de outro tenant/portfolio não colidem |
| 2. Recebimento e sincronização | Webhooks autenticados de messages/history/contatos/eco, journal, pricing e atualização de identidades | Fixtures provam deduplicação e recuperação; histórico/eco não abrem janela nem disparam automações; receptor pronto antes do onboarding |
| 3. Onboarding Coexistence | Embedded Signup, verificação de ativos, conexão e sincronização inicial | Número real confirmado com `is_on_biz_app = true` e `platform_type = CLOUD_API`; pedidos/progresso persistidos; histórico recusado/parcial tratado sem falsa conclusão |
| 4. Envio oficial | Texto/mídia, BSUID/telefone, templates, janela e comandos duráveis | Livre só na janela; duplo clique não duplica comando; timeout fica incerto; envio do CRM aparece no celular e envio por BSUID é validado |
| 5. Atendimento unificado | Inbox e ficha agregados, origem celular/CRM, seleção de canal, estimativa e permissões | Mensagem manual do celular aparece uma vez no CRM; histórico dos dois números reunido; uazapi só com identidade compatível |
| 6. Custos e simulação | Tarifas versionadas, apuração idempotente, snapshots Meta e painel financeiro | Replay não duplica custo; eco/importação não recebem nova tarifa API; fonte ausente não vira zero; vigência e classificação preservadas |
| 7. Campanhas e automações | Simulação salva, conexão fixada, supressão, cancelamento e resultados | Um comando por destinatário; descadastro bloqueia envio; revisão tarifária é rastreável; importação da agenda não cria leads/negócios em massa |
| 8. Piloto e operação | Número real em Coexistence, uazapi separada, conciliação disponível e deploy gradual | Celular ↔ CRM confirmado; desconexão e retomada testadas; limites de sincronização informados; desativação preserva histórico |

Na implementação, usar a suíte existente com Postgres de teste separado e providers mockados para regressões de backend. Na etapa de filas, validar também com Redis real local; o modo inline não prova delays, concorrência ou retomada. Conferir typecheck/lint/build dos dois projetos e verificar visualmente inbox, ficha e composer em desktop/mobile.

Casos obrigatórios: dois tenants com o mesmo telefone, dois contatos ambíguos na mesma org, evento antigo de inbound, janela vencendo entre clique e execução, status chegando antes da resposta do envio, IDs externos iguais em conexões diferentes, duas mensagens com o mesmo timestamp e paginação agregada sem itens faltantes/repetidos.

Acrescentar casos de BSUID sem telefone, mesmo usuário em portfolios diferentes, username alterado, `user_id_update` reentregue e fora de ordem, número compartilhado de terceiro sem auto-vínculo, identidade antiga preservada e supressão mantida após mudança de ID. Nos custos: tarifas com vigências distintas, mudança de categoria, moeda com tarifa fracionária, faixa de volume, janela livre elegível, webhook sem pricing, duplicata delivered/read, analytics revisados, acesso a `COST` ausente e tráfego externo ao CRM. Verificar snapshots/forecast sem enviar mensagens reais na simulação.

Coexistence exige ainda validar eco antes/depois de status, mensagem presente em history e live, mídia histórica indisponível, consentimento de histórico recusado, sincronização interrompida, prazo inicial expirado, desconexão do Business App e origem/autoria do envio no celular. Importação não pode gerar não lidos, renovar janela, duplicar custos ou executar automações retroativas.

Antes de produção: ensaiar backfill em dados locais, manter IDs e vínculos legados, comparar contagens e preparar backup/rollback. O projeto usa `prisma db push`; schema aditivo deve estar aplicado antes de subir a nova imagem. Colunas obrigatórias com dados antigos exigem expansão/backfill/validação antes de exigir preenchimento. Qualquer proposta de `--accept-data-loss` interrompe o procedimento. Operações no banco de produção ficam para autorização específica, não são parte deste plano.

## 10. Configuração para a etapa 0

As envs foram disponibilizadas e o diagnóstico inicial foi executado. Os testes reais restantes ficam adiados até o usuário ajustar cobrança e webhook. A implementação não deve alterar subscriptions ou enviar novas mensagens durante esse avanço.

O arquivo `eloscrm-api/.env.local` contém as configurações locais. O servidor passa a carregá-lo antes de `.env` em desenvolvimento, preservando variáveis já presentes no processo. Produção carrega somente `.env`; a suíte permanece com `.env.test` e chave de cifra própria.

Configurações globais do app e do servidor:

- `META_WHATSAPP_APP_ID`
- `META_WHATSAPP_APP_SECRET`
- `META_WHATSAPP_GRAPH_VERSION`
- `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN`, para o futuro endpoint, sem possibilidade de recuperar seu valor remoto
- `META_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID`, referência da configuração de onboarding em Coexistence
- `META_WHATSAPP_TOKEN_ENCRYPTION_KEY`, chave independente para cifrar os tokens das conexões
- `PUBLIC_API_URL`, endereço público da API para o futuro webhook

Somente para diagnóstico read-only, `META_WHATSAPP_ACCESS_TOKEN` permite consultar os ativos acessíveis. `META_WHATSAPP_BUSINESS_PORTFOLIO_ID`, `META_WHATSAPP_WABA_ID` e `META_WHATSAPP_PHONE_NUMBER_ID` são filtros opcionais do piloto, não configurações fixas do produto. Quando vazios, ficam comentados no arquivo local; os ativos podem ser descobertos conforme as permissões do token.

Na operação, o administrador conecta o WhatsApp pelo Embedded Signup em Coexistence. O backend troca o código de autorização, valida os ativos e vincula Business Portfolio, WABA, número e token cifrado à `ChannelConnection` da organização autenticada. Os IDs recebidos do navegador não autorizam esse vínculo. Envios usam a conexão vinculada ao canal da conversa, e webhooks resolvem a conexão pelos identificadores autenticados do evento; nenhuma operação usa uma conta global ou a primeira conexão ativa como fallback. Eventos sem identificação suficiente ficam pendentes de resolução, sem atribuição arbitrária.

Os segredos entram apenas no ambiente local, sem valores em chat ou git. Um token global de diagnóstico não substitui os tokens das conexões. A estratégia definitiva de token e onboarding depende dos acessos reais do app; a chave de cifra oficial permanece separada do acoplamento atual de Lead Ads à chave uazapi.

A conferência deve distinguir aprovação do app, acesso efetivo às permissões `whatsapp_business_messaging`/`whatsapp_business_management`, atribuição dos ativos, expiração/revogação do token, registro do número, templates e estado de qualidade/limites disponíveis. Read-only confirma configuração consultável, sem provar entrega. O teste ponta a ponta será parte do piloto com destinatário de teste definido.

Conferir também Business Portfolio proprietário, moeda/timezone da WABA, acesso à métrica `COST`, tarifas vigentes, disponibilidade de BSUID/solicitação de número e subscriptions de `user_id_update`, `messages`, `history`, `smb_app_state_sync` e `smb_message_echoes`. Para Coexistence, validar requisitos de Tech Provider/Solution Partner, versão/configuração do Embedded Signup, versão e elegibilidade do Business App e estado `is_on_biz_app`/`platform_type` do número. Aprovação de permissões WhatsApp não comprova esses requisitos. Qualquer mudança dessas configurações fica para a implementação e o piloto; a etapa 0 apenas registra o que estiver configurado.

## 11. Primeiro incremento de implementação

Escopo deste incremento: conexões, credenciais e identidade de contato no backend. Ingestão oficial, onboarding, envio, histórico agregado, custos e telas continuam nas etapas seguintes da seção 9. O contrato atual de conversas uazapi fica preservado; os agregados ainda não serão substituídos neste incremento.

1. Schema aditivo em `eloscrm-api/prisma/schema.prisma`: `ChannelConnection`, `MessagingContact` e `ContactIdentity`, enums e relações. Identidade única por organização/tipo/escopo/valor; chaves compostas impedem relacionar a identidade a um contato ou conexão de outra organização. Verificação: Prisma validate e testes de integridade no Postgres local.
2. Configuração em `src/env.ts`, `src/load-env.ts`, `src/server.ts` e `.env.example`; cifra independente em `src/lib/whatsapp-official/crypto.ts`. AAD de AES-256-GCM vincula credencial a organização/conexão. WABA, portfolio, número e token de diagnóstico não configuram o canal globalmente. Verificação: round-trip, adulteração, contexto incorreto, segregação da cifra uazapi e typecheck.
3. Módulos `src/modules/channel-connections/` e `src/modules/contact-identities/`: persistência de ativos já validados pelo futuro onboarding, leitura sem segredos, renovação/desativação, resolução de alias e vínculo manual. `saveVerifiedOfficialConnection(orgId, input)` é contrato interno, sem endpoint de cadastro que aceite ativos do navegador. `getOfficialCredentials(orgId, id)` valida estado e expiração; `resolveContactIdentity(orgId, input)` admite BSUID sem telefone e resolve concorrência sem contato órfão. Verificação: isolamento, idempotência, concorrência e preservação de identidades.
4. Rotas GET `/v1/whatsapp/connections` e `/v1/whatsapp/connections/:id`, com guards de sessão/org; tipos públicos espelhados em `eloscrm-web/lib/types.ts`. Verificação: 401 sem sessão, 404 em acesso de outra imobiliária, ausência de token na resposta e typecheck do web.

Os testes usam providers sem chamadas reais. O `db push` inicial no banco `eloscrm_test` encontrou drift em valores de `AuditEntity` e foi interrompido sem aceitar perda de dados. A validação desta etapa usa banco local novo `eloscrm_whatsapp_foundation_test`, com overrides temporários fora do repositório; `.env.test` permanece intacto. Nenhum schema de dev ou produção foi aplicado.

Verificação do incremento: 29 testes focados passaram, incluindo acesso entre organizações, cifra, concorrência e exclusão do tenant com conexões oficial/uazapi. Typechecks da API e do web, lint da API e build da API passaram. O lint do web terminou sem erros, com um warning existente em `lib/api.ts:17`. O build padrão do web foi limitado pelo download da fonte e pelo bloqueio de porta do Turbopack; o build com `next build --webpack` passou, sem alteração de configuração. A revisão independente não encontrou problemas importantes.

A execução geral da API teve 604 testes aprovados e uma falha em `test/broadcasts.test.ts:189`: espera 404, mas a fixture cria uma instância desconectada e o serviço retorna 409. O teste e o serviço de disparos permanecem idênticos ao HEAD; essa divergência fica registrada fora do escopo deste incremento. Essa execução ocorreu antes da inclusão do teste adicional de exclusão do tenant, posteriormente aprovado na rodada focada.

Regras de execução: manter mudanças nesta branch local, sem commit/push; usar os checks existentes e os testes de segurança/concorrência acrescentados, sem TDD automático, conforme as instruções do projeto. Revisar o incremento antes de passar à ingestão oficial.

## 12. Segundo incremento de implementação

Escopo entregue: receptor oficial, journal durável e ingestão de mensagens, histórico, eco, estados e identidades no backend. O onboarding ainda não cria conexões pela interface, e as conversas oficiais ainda não aparecem na inbox atual.

1. GET/POST `/webhooks/whatsapp-official` em `src/routes/webhooks/whatsapp-official/index.ts`: challenge com verify token e assinatura HMAC-SHA256 sobre os bytes originais. Limite de body de 16 MiB e 200 requests por segundo/IP em cada processo; o rate limit não é distribuído. O logger dessa rota fica silencioso para não registrar verify token ou conteúdo privado.
2. `src/modules/whatsapp-official/webhook.repo.ts`: todas as changes do envelope são guardadas numa escrita antes do ACK. O vínculo exige WABA e phone number ID cadastrados na conexão; ativos desconhecidos ficam sem tenant, com estado `unresolved`. Falha de persistência retorna 503 para permitir reentrega. Hash canônico deduplica o envelope mesmo quando muda a ordem das chaves JSON.
3. `webhook.service.ts` e `webhook-processing.service.ts`: recuperação consulta o Postgres a cada cinco segundos, com Redis/BullMQ quando configurado e processamento inline quando ausente. Claim usa lease de 120 segundos; eventos com falha têm até dez tentativas automáticas. Um item inválido não impede mensagens ou statuses seguintes. Contadores, resultados individuais privados e metadados reconhecidos de sincronização ficam no journal.
4. GET `/v1/whatsapp/events` e POST `/v1/whatsapp/events/:id/replay`: sessão, organização e papel de gestor conferidos no servidor. A leitura expõe somente metadados; replay de evento elegível registra auditoria na mesma transação que confirma a intenção.
5. `ingest.repo.ts` e `message-parser.ts`: `Conversation` e `WhatsappMessage` recebem conexão oficial e vínculo com `MessagingContact`, mantendo os IDs e contratos legados. `instanceId` passa a ser opcional para registros oficiais; rotas e ações uazapi continuam limitadas às conversas com instância. Apenas inbound live de mensagem do cliente incrementa não lidos e atualiza a janela pelo maior timestamp recebido. Histórico e eco não renovam janela nem executam automações.
6. `identity.repo.ts` e `sync.repo.ts`: aliases telefone/wa_id, BSUID e parent ficam no escopo da organização/portfolio. Lock nesse escopo e conferência do alias efetivamente salvo impedem duas conexões de aposentar identidades em contatos diferentes. `user_id_update` preserva aliases anteriores e registra auditoria. Sincronização da agenda não cria clientes ou negócios em massa; recusa de histórico e progresso reconhecido são registrados sem declarar o onboarding concluído.
7. `receipts.repo.ts`: receipts deduplicados guardam pricing, metadados de conversation e códigos de erro, inclusive quando chegam antes da mensagem. Conciliação não regride `read` para estados anteriores. Esses metadados ainda não constituem apuração financeira. Mídias oficiais guardam ID e dados disponíveis; download e envio permanecem pendentes.

Verificação: os 23 testes novos do webhook passaram. A suíte geral da API terminou com 628 testes aprovados e a mesma falha existente de disparos em `test/broadcasts.test.ts:189` (404 esperado, 409 recebido). Typecheck, lint e build da API passaram; typecheck do web passou. A verificação com Redis real local, repetida após as correções, recuperou um evento persistido antes do enqueue e confirmou uma mensagem e um não lido após reentregas. A revisão independente apontou duas falhas, ambas corrigidas e cobertas: disputa de aliases entre conexões e interrupção dos itens seguintes após um item inválido. A revisão das correções não encontrou novos achados.

O schema foi aplicado apenas em banco local novo `eloscrm_whatsapp_ingestion_test`; `.env.test`, dev e produção permaneceram intactos. O push no banco de teste já existente pediu confirmação por causa de novos índices únicos e foi interrompido. Antes do deploy, preparar expansão e criação dos índices após verificar duplicatas em dados existentes; não usar `--accept-data-loss` para contornar esse passo. Nenhuma chamada real à Meta, alteração de subscriptions, envio de mensagem ou deploy foi executado neste incremento.

A validação dos formatos usou exemplos oficiais acessíveis e textos de páginas oficiais arquivados nesta sessão. A tentativa de atualizar as páginas da Meta recebeu HTTP 429; isso não confirma disponibilidade atual de cada recurso na conta piloto. O teste real do webhook e do Coexistence permanece adiado conforme solicitado.

Continuam pendentes: Embedded Signup e pedidos de sincronização, backfill uazapi, automações de inbound oficial, comandos de envio e download de mídia, inbox/ficha agregadas, templates, apuração de custos, simuladores e telas de diagnóstico. A preparação do receptor cobre parte da etapa 2; não encerra as etapas 1 e 2 nem habilita Coexistence no número piloto.

## 13. Terceiro incremento de implementação

Escopo entregue: onboarding Coexistence e acompanhamento da sincronização. A página de WhatsApp ganhou as abas “WhatsApp oficial” e “uazapi”; a conexão pelo QR Code permanece na segunda aba. A primeira prepara o cadastro, abre a Meta, apresenta os números autorizados e permite concluir a conexão. Envio oficial e atendimento agregado continuam pendentes, com essa limitação indicada na tela.

1. `src/lib/whatsapp-official/graph.ts` faz as chamadas de OAuth, inspeção de token, leitura de ativos, assinaturas e SMB App Data. Requests usam host fixo, timeout de 15 segundos e bloqueio de redirects; paginação segue somente o cursor no endpoint conhecido. Erros guardam códigos e indicação de resultado incerto, sem mensagem privada, URL, código de autorização ou token.
2. `src/modules/whatsapp-onboarding/` valida app, validade do token, permissões e granular grants da WABA. Portfolio, moeda, timezone e números vêm da Meta. Apenas números com `is_on_biz_app = true` e `platform_type = CLOUD_API` são oferecidos. O evento final pode informar só WABA; a seleção do número acontece depois da descoberta no servidor. A ativação repete a leitura dos números autorizados. O fluxo não chama `/register`.
3. `OfficialOnboarding` vincula a tentativa à imobiliária, ao usuário e ao hash da sessão. A tentativa expira em 30 minutos, e o código recebe hash único e claim antes da troca remota. Replays conhecidos não trocam o código outra vez; timeout ou crash da troca não provoca repetição automática. Token intermediário fica cifrado e é removido após concluir ou expirar. `OfficialSyncRequest` guarda os pedidos e resultados sem depender da memória do processo.
4. POST `/v1/whatsapp/onboarding`, POST `/:id/exchange` e POST `/:id/activate` exigem sessão, organização, gestor, origem exata e body estrito de até 8 KiB. Rate limit de 60 mutações por minuto/usuário em cada processo. GET `/config` fornece somente os identificadores públicos do app configurado; GET `/:id` e GET `/v1/whatsapp/connections/:id/sync` conferem o escopo e retornam estados/metadados. Código, cifra e segredo não saem nas respostas.
5. Antes de iniciar o cadastro, o backend confere o callback esperado em `/webhooks/whatsapp-official` e os fields `messages`, `history`, `smb_app_state_sync`, `smb_message_echoes` e `user_id_update`. Nenhuma configuração global da Meta é alterada por essa conferência. A ativação recusa ativos já vinculados a outra imobiliária, persiste conexão/pedidos/auditoria numa transação e assina a WABA. A assinatura pode ser retomada por ser idempotente; a conexão permanece pendente até o aceite.
6. Contatos e histórico são solicitados imediatamente após a assinatura. Cada pedido é marcado `requesting` antes da chamada; `request_id`, aceite, recusa, falha ou incerteza ficam persistidos. Timeout, resposta inválida ou crash não reabrem o pedido. Recuperação consulta o Postgres a cada cinco segundos e retoma somente intenções ainda não consumidas. O deadline de 24 horas parte do início do cadastro no servidor, como limite conservador; o navegador não informa a data de onboarding.
7. O journal atual alimenta o progresso: aceite não significa conclusão; marcador de histórico a 100% exige que os eventos recebidos desse ciclo estejam processados. Falha ou pendência posterior volta a indicar recebimento com itens pendentes. Recusa de histórico aparece separadamente. A agenda fica como aceita/recebendo, pois o formato documentado não fornece marcador de conclusão. Novos logins do mesmo número renovam credenciais e preservam pedidos existentes, incluindo os incertos; não apagam `request_id` nem repetem a importação.

Verificação: 19 testes de onboarding e quatro do cliente Graph passaram, além dos 23 de ingestão, totalizando 46 na rodada focada. A suíte geral terminou com 651 testes aprovados e a falha anterior em `test/broadcasts.test.ts:189` (404 esperado, 409 recebido). Typechecks dos dois projetos, lint/build da API e build do web com webpack passaram. Lint do web teve zero erros e o warning já existente em `lib/api.ts:17`.

A verificação visual usou Playwright com auth, API e Meta simuladas em HTTPS local nativo do Next. Desktop (1440 px) e celular (390 px) concluíram cadastro e seleção nas duas ordens de chegada do código/evento; não houve erros de console/runtime nem overflow horizontal. As capturas mostram conexão e progresso. O proxy HTTPS temporário impediu a hidratação; foi substituído por HTTPS nativo sem mudar o produto. Os servidores temporários foram encerrados, e a alteração automática feita pelo Next em `eloscrm-web/AGENTS.md` foi removida.

A revisão independente encontrou um risco de repetir importação ao resetar pedidos em outro cadastro do mesmo número. A correção preserva cada registro existente; o teste acrescentado confirma que pedidos aceitos/incertos e IDs sobrevivem sem chamadas extras. A revisão dessa correção não encontrou novos problemas importantes. Novo ciclo de importação após offboarding precisa de fluxo explícito com evidência do desligamento; não está habilitado por outro login. Detecção de offboarding/revinculação por webhook e retomada do cadastro no navegador após reload continuam pendentes antes do piloto.

Referências de contratos consultadas nesta sessão pelo Context7, em fontes da Meta: [onboarding de usuários do Business App](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users), [troca de código como Tech Provider](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider), [inspeção de grants](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/manage-accounts) e [SDK e eventos de sessão](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation). A abertura direta das páginas continuou respondendo 429. O app, a configuração e a elegibilidade reais não foram novamente consultados; nenhum número foi conectado, nenhuma subscription real foi alterada e nenhuma mensagem foi enviada.

Schema aplicado somente no banco local isolado já usado na ingestão. Configuração do webhook público, ensaio em número real, expansão dos índices em dados existentes e deploy permanecem pendentes. O próximo incremento do plano é o envio oficial; inbox unificada, automações e apuração/simulação de custos continuam nas etapas seguintes.

## 14. Quarto incremento de implementação

Escopo implementado no backend: comandos de envio oficial, texto, templates com variáveis de texto e upload/envio de JPEG, PNG, MP3, OGG/Opus, MP4 e PDF. A interface de atendimento ainda usa o fluxo uazapi; o composer oficial entra na integração da inbox agregada.

1. `OfficialSendCommand` guarda intenção, request, payload, autoria, chave de idempotência, hash, lease e resultado. `outbound.repo.ts` cria comando, mensagem local e auditoria na mesma transação, antes da chamada externa. Chave repetida na mesma organização retorna o comando existente; payload diferente gera 409. Claim condicional impede submissão simultânea.
2. `outbound.service.ts` confere credencial ativa, membership do autor e identidade vigente no portfolio da conexão. Telefone/wa_id usam `to`; BSUID e parent usam `recipient`. Texto e mídia exigem janela aberta. A conferência se repete no worker e depois de consultas/uploads, antes da submissão. Resposta citada exige mensagem do mesmo contato e número oficial. Não há fallback automático para uazapi.
3. Estados do comando são `pending`, `preparing`, `sending`, `accepted`, `failed` e `uncertain`. Aceitação não equivale a entrega; a consulta pública inclui separadamente o status da mensagem. Rede, timeout, resposta inválida ou crash durante submissão ficam incertos, sem reenvio automático. Quando a resposta fornece um ID externo, o checkpoint o guarda antes da conciliação; respostas tardias continuam sendo evidência após expirar a lease. Recuperação concilia IDs conhecidos sem submeter outra mensagem.
4. `accept` concilia receipt/eco que chegou antes da resposta HTTP. Mantém a mensagem local e sua autoria/conteúdo e reaplica receipts, preservando leitura. Eco com outro contato, direção ou comando não é removido para forçar conciliação. Se nenhuma resposta persistida fornecer ID externo, o comando permanece incerto; não há associação por texto/horário nem correlação por `biz_opaque_callback_data` neste incremento.
5. `OfficialTemplate` mantém catálogo por organização/WABA, incluindo nome, idioma, categoria, status e definição. Sincronização pagina no host fixo por cursor. Envio guarda a definição utilizada e consulta novamente a Meta antes de submeter; aprovação/definição alteradas exigem novo envio. Variáveis nomeadas e posicionais são exatas. Limites conservadores do CRM: header preenchido até 60 caracteres e body até 1024. Templates de autenticação, headers de mídia, botões dinâmicos e outros componentes ainda não são enviados pelo CRM.
6. `OfficialUpload` registra objeto privado com chave gerada pelo servidor, MIME, tamanho, hash e filename normalizado. Upload binário valida assinatura do arquivo; imagem tem limite de 5 MiB e os outros tipos, 16 MiB nesta versão do CRM. Worker lê somente o objeto privado cadastrado, limita bytes efetivos, confere hash e fecha o stream. A Meta recebe multipart e a mensagem usa o media ID retornado, sem URL arbitrária do cliente. A purga da organização inclui uploads ainda não associados a mensagens e deduplica chaves compartilhadas.
7. Rotas em `/v1/whatsapp/outbound`: POST `/connections/:connectionId/messages`, GET `/commands/:id`, GET `/connections/:connectionId/templates`, POST `/connections/:connectionId/templates/sync` e POST `/connections/:connectionId/uploads`. Sessão e organização são obrigatórias; mutações conferem origem exata, schemas estritos, tamanho e 60 requests/minuto/usuário por processo. Respostas de comando não expõem conteúdo, payload ou credenciais; erros não encaminham mensagens privadas do provider/ORM.

Decisão de implementação: recuperação de envios consulta o Postgres a cada cinco segundos, com claim/lease no próprio banco e processamento sequencial. Isso recupera comandos gravados antes de um crash sem introduzir outra dependência de fila neste incremento. Redis continua no processamento dos webhooks; execução espaçada de campanhas permanece na etapa própria.

Verificação: 22 testes de envio e cinco de mídia passaram; a rodada focada anterior terminou com 76 aprovações. A rodada geral final, incluindo dois testes adicionais do transporte Graph, terminou com 680 aprovações e a falha anterior em `test/broadcasts.test.ts:189` (404 esperado, 409 recebido). Typechecks dos dois projetos, lint/build da API e `git diff --check` passaram. Storage e Graph dos testes novos são simulados; isso não valida upload ou entrega real na Meta. Não houve alteração visual neste incremento.

A revisão independente identificou a corrida de resposta tardia após expirar a lease. A correção guarda o ID mesmo em estado incerto; o teste reproduz a interposição da recuperação antes do checkpoint e confirma uma única submissão. A revisão da correção não encontrou achado remanescente.

Schema aplicado somente no banco local novo `eloscrm_whatsapp_outbound_test`. O push no banco isolado anterior foi interrompido ao pedir confirmação de índice único; nenhuma flag de perda de dados foi usada. `.env.test`, dev, produção e configurações reais da Meta permaneceram intactos. Não houve envio real, commit, push ou deploy.

Continuam pendentes: composer/inbox oficial e agregada, backfill uazapi, automações inbound oficiais, download de mídia recebida, componentes adicionais de templates, offboarding/revinculação, retenção de uploads não utilizados, campanhas oficiais e apuração/simulação de custos. Os receipts retêm os metadados financeiros disponíveis; ainda não existe valor apurado nem tela de custos. As limitações do piloto e da expansão de índices em dados existentes permanecem.

## 15. Quinto incremento de implementação

Escopo implementado: inbox agregada em `/conversas`, composer oficial e o mesmo atendimento na aba WhatsApp da ficha do lead. As ações avançadas da uazapi continuam acessíveis pela visão anterior.

1. `/v1/whatsapp/inbox` agrupa conversas pelo lead explicitamente vinculado, contato oficial ou conversa residual. Telefone igual não une contatos. Grupos WhatsApp permanecem separados. Vínculo manual valida organização, recusa contato/lead já associados de forma ambígua e grava auditoria na transação. Metadados não expõem credenciais ou valores internos das identidades.
2. Histórico reúne os canais por horário e ID, com paginação determinística e cursor restrito ao atendimento. A tela indica número, provider, origem celular/importação/CRM e autoria disponível. Citações são resolvidas por organização, conversa e ID do provider; conteúdo apagado permanece oculto. Os estados do comando oficial aparecem separados da entrega da mensagem.
3. Composer escolhe explicitamente o número/canal, mostra a janela de 24h e envia texto, templates suportados ou arquivos pelos endpoints oficiais. Fora da janela, texto e mídia ficam bloqueados; template exige aprovação e variáveis preenchidas. A uazapi exige seleção e confirmação explícitas, sem fallback automático. O servidor continua responsável pelas validações de autorização, identidade, janela, template e mídia.
4. Rascunho, lock e solicitação pendente ficam em memória por sessão, imobiliária e conversa. Trocar canal, atendimento ou rota não perde a chave de idempotência enquanto o app permanece carregado. Se a resposta HTTP se perder, “Consultar solicitação” reapresenta o mesmo payload/chave ao endpoint idempotente. Reload encerra esse estado local; comandos já persistidos continuam no backend e no histórico. Não há conteúdo privado em localStorage.
5. Busca, filtros de ativos/não lidos/arquivados, leitura agregada e vínculos usam tenant da sessão. A ficha do lead também inclui atendimentos totalmente arquivados. Histórico reutiliza o visualizador de imagens/vídeos e as URLs de mídia já disponíveis; isso não implementa download de mídia oficial recebida.

Verificação: dez testes novos da inbox passaram. A suíte geral final terminou com 690 aprovações e apenas a falha anterior em `test/broadcasts.test.ts:189` (404 esperado, 409 recebido). Typechecks dos dois projetos, lint/build da API e build do web passaram. Lint do web teve zero erros e o warning anterior em `lib/api.ts:17`. Scanner dos novos identificadores e `git diff --check` passaram.

Playwright com auth/API fictícias confirmou desktop (1440 px), celular (390 px), rascunho ao trocar canal, solicitação incerta ao sair/voltar ao atendimento e a mesma chave/payload após reconectar. Também confirmou template com variável fora da janela, confirmação explícita da uazapi e reprodução de MP4 fictício com controles. Não houve erros de runtime nem overflow horizontal; capturas foram inspecionadas. Isso não comprova entrega real, webhook público ou elegibilidade de Coexistence.

A revisão independente encontrou perda da chave ao desmontar o composer e vídeo sem player acionável. Ambos foram corrigidos; a revisão final dos arquivos e hashes não encontrou achado P1/P2 remanescente. A suíte usou somente o banco local novo `eloscrm_whatsapp_inbox_test`. Não houve mudança de schema neste incremento, alteração de `.env.test`, chamada real à Meta, commit, push ou deploy.

Continuam pendentes: apuração/tela/simulador de custos, campanhas oficiais, backfill uazapi, automações inbound oficiais, download de mídia recebida, offboarding/revinculação e os limites do piloto já registrados. Os receipts guardam metadados financeiros; nenhum valor faturado é inferido neste incremento.

## 16. Sexto incremento de implementação

Escopo implementado: aba “Custos e consumo” em WhatsApp, tarifas com fonte/vigência, apuração por receipts, analytics da WABA, simulador de volume e estimativa no composer oficial. Dados financeiros e endpoints exigem owner/admin; a autorização é conferida no servidor.

1. `OfficialRate` guarda tarifa decimal, moeda, país, categoria, tipo de cobrança, validade e faixa de volume. O servidor obtém moeda e WABA da conexão, rejeita sobreposição de faixas no mesmo período e aceita fonte HTTPS dos domínios oficiais previstos. Tarifas são cadastradas manualmente e permanecem imutáveis; a URL registra a fonte, sem validar automaticamente o preço publicado. Nenhum preço real foi inserido neste incremento.
2. `MessageCost` e `MessageCostRevision` vinculam apuração à mensagem, receipt e snapshot da tarifa. Somente outbound Cloud API com evidência de entrega/leitura é apurado. Celular e histórico ficam fora dessa apuração. Receipt repetido não duplica custo; classificação posterior cria revisão, preservando a moeda original. Nova tarifa não reescreve custos anteriores automaticamente; a reapuração explícita guarda revisão quando o resultado muda.
3. Janela aberta não determina gratuidade. Valor zero exige classificação explícita de gratuidade no receipt, modelo suportado e moeda conhecida. Classificação, mercado, moeda ou tarifa ausentes deixam valor pendente. Mercado automático atualmente reconhece somente telefone/wa_id brasileiro completo; BSUID isolado e outros países permanecem pendentes. A estimativa individual usa a faixa inicial, sem inferir desconto por volume acumulado da conta.
4. Valores são strings decimais nas respostas; operações usam `Decimal.clone({ precision: 40 })`, sem alterar o Decimal global e sem arredondar cada mensagem para centavos. Consumo separa períodos de envio e entrega, subtotais por moeda, custos conhecidos e pendências. Ausência de valores conhecidos não vira gasto zero. A lista exibe até 100 apurações; detalhamento financeiro por contato/campanha ainda não foi implementado.
5. `CostAnalyticsSnapshot` e suas revisões guardam consultas por organização, WABA e período. Dimensões são deduplicadas, revisões substituem o snapshot vigente e totais não são somados entre consultas. O agregado da WABA aparece separado dos custos locais, incluindo números e tráfego externos ao CRM. Ausência de COST mantém valor indisponível; falha preserva o último snapshot e informa sua data. Resposta parcial com paginação ou dimensões conflitantes é recusada. Consulta à Meta ocorre apenas por ação explícita na tela.
6. Simulador usa quantidade de pessoas, mensagens por pessoa, data, país, categoria, tipo e volume anterior declarado. Segmenta faixas de volume, retorna snapshots das tarifas e deixa o total indisponível quando há lacuna. Premissas de resposta/gratuidade são hipóteses, sem autorização de envio. Alterar o cenário oculta o resultado anterior até recalcular. A estimativa do composer resolve identidade e categoria do template no servidor, sem bloquear o atendimento quando o custo está indisponível.
7. `/v1/whatsapp/costs` oferece relatório, tarifas, simulação, preview, consulta analytics e reapuração. Schemas estritos, tenant da sessão, origem exata nas mutações, body de até 16 KiB e rate limit de 20 mutações/minuto/usuário por processo. Relatório limita período a 31 dias e cada conjunto a 20 mil registros; reapuração limita a cinco mil receipts por solicitação.

Verificação: os 12 testes de custos passaram, incluindo repetição de receipts, reclassificação, moeda preservada, ausência de dados, tarifas/faixas, analytics parcial, revisão sem soma e precisão decimal extrema. A suíte geral final terminou com 702 aprovações e a falha anterior em `test/broadcasts.test.ts:189` (404 esperado, 409 recebido). Lint/build da API e build do web passaram; lint do web teve zero erros e o warning anterior em `lib/api.ts:17`. Scanner dos identificadores novos passou.

Playwright com auth/API fictícias confirmou desktop (1440 px) e celular (390 px), decimal com vírgula no cadastro, quantidade do cenário enviado, resultado invalidado após mudar o cenário, ausência de COST e estimativa indisponível no composer. Fluxos anteriores de idempotência, template e mídia da inbox também passaram. Um overflow das abas no celular foi corrigido; tabelas têm scroll interno. Não houve erros de runtime nem overflow horizontal da página nas verificações finais. A revisão independente dos arquivos e hashes não encontrou P1/P2 remanescente.

Contratos consultados pelo Context7 em fontes da Meta: [analytics](https://developers.facebook.com/documentation/business-messaging/whatsapp/analytics), [pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing) e [non-template messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages). A divergência entre exemplos de cobrança permanece tratada pela classificação reportada, sem regra local de gratuidade baseada apenas na janela. A abertura direta das páginas da Meta respondeu 429; não houve validação da conta real. Precisão independente conferida na documentação de [Decimal.clone](https://mikemcl.github.io/decimal.js/#clone).

Schema aplicado somente no banco local novo `eloscrm_whatsapp_costs_test`; `.env.test`, dev e produção permaneceram intactos. Servidor visual encerrado e alteração automática do Next em AGENTS.md removida. Não houve mensagem, consulta real à Meta, commit, push ou deploy. Produção ainda exige aplicação manual do schema antes da imagem nova, conforme as instruções do projeto.

Continuam pendentes: campanhas oficiais com preview/snapshot e revalidação, detalhamento financeiro por contato/campanha, conciliação com fatura, taxas/câmbio, importação de tarifas, resolução de mercado fora do Brasil e descontos baseados no volume real da conta. Também permanecem backfill uazapi, automações inbound oficiais, download de mídia recebida, offboarding/revinculação e os limites do piloto já registrados.

## 17. Sétimo incremento de implementação

Escopo implementado: campanhas oficiais no diálogo de disparos do funil, com rascunho, preview, permissão de comunicação, confirmação de início, execução espaçada e acompanhamento por destinatário. O fluxo oficial aparece primeiro para gestores; a uazapi e seu histórico continuam em abas explícitas.

1. `OfficialCampaign` guarda conexão, template/parâmetros, filtros, seleção, autor, chave de idempotência e snapshot aprovado. `OfficialCampaignRecipient` guarda pessoa, negócio, identidade e hash do destino, parâmetros, tarifa com fonte/vigência/faixa e resultado. Criar o rascunho não inicia envio. Repetir criação com o mesmo payload/chave retorna o registro existente; chave com outro payload é recusada. Início repetido com o mesmo hash aprovado não cria outra execução.
2. Preview consulta somente os negócios selecionados, com limite de 200. Busca de candidatos aceita até 500 negócios por consulta e exige filtros mais restritos quando ultrapassa o limite. Filtro de retorno usa vínculos explícitos do lead/contato nas conversas dos dois canais, sem unir pessoas por telefone. A seleção pode incluir pessoas sem telefone para resolver uma identidade BSUID. Destino é deduplicado por contato e por `scope + to/recipient + value`; aliases phone/wa_id iguais não produzem dois envios. Identidades distintas sem vínculo conhecido não são inferidas como a mesma pessoa.
3. Campanha oficial exige permissão registrada para o lead e compatível com o telefone atual/destino quando conhecido. `CommunicationPermission` e revisões guardam estado, evidência declarada pelo gestor, autoria, revisão e phoneKey do momento do registro. Supressão considera também o número efetivo salvo no disparo e preserva o veto ao telefone antigo após editar o cadastro. No oficial, o worker revalida permissão antes da preparação e da submissão; a checagem transacional compartilha locks com cancelamento e registro de permissão. Evidência não sai em logs/auditoria; auditoria registra referências e estado.
4. `start` exige Redis e sincroniza o catálogo de templates antes de conferir o snapshot novamente. Público, identidade, aprovação/definição do template, categoria ou tarifa alterados bloqueiam o início até revisão explícita. Na execução, cada pessoa passa pelas validações novamente; mudança material pausa a campanha. Revisão pode substituir destinatários antes de haver comando. Se já existe comando, o app exige cancelar o restante e preparar outra campanha; não modifica um envio persistido para tentar novamente.
5. Redis executa jobs com uma tentativa; Postgres mantém a intenção e os slots de envio. Recuperação a cada dez segundos apenas enfileira referências. Claim e lease persistidos impedem jobs duplicados de preparar a mesma pessoa; o lock por conexão coordena campanhas e processos. O intervalo de dez segundos após concluir cada tentativa e a liberação do slot são atômicos. Recuperação comum dos comandos oficiais exclui comandos pendentes de campanha; não burla fila, permissão, pausa ou cancelamento. Resultado incerto nunca é reenviado automaticamente.
6. Cancelamento impede destinatários ainda não submetidos e encerra comandos locais pendentes/preparando, sem recolher mensagens já submetidas. Aceite aparece separado de entrega/leitura/falha de entrega. Resposta tardia conciliada pelo fluxo oficial atualiza a evidência mostrada pela campanha. Receipts alimentam o histórico agregado e a apuração vinculada à mensagem; o acompanhamento mostra custo estimado por destinatário quando disponível.
7. Preview considera uma mensagem entregue por pessoa elegível e tarifa base, sem prometer desconto por volume real da conta. Mostra exclusões, categoria, país, moeda, fonte da tarifa e total decimal. Dados ausentes mantêm custo indisponível, incluindo BSUID sem mercado identificado. Snapshot preserva tarifa e previsão; não representa débito nem fatura. Parâmetros deste incremento são comuns a todas as pessoas, explicitamente indicados na tela; personalização por lead permanece pendente.
8. `/v1/whatsapp/campaigns` reúne busca, preview, criação, listagem, detalhe, revisão, início e cancelamento; `/permissions/:clientId` consulta/registra permissão. Todas as rotas exigem sessão, tenant e owner/admin; mutações exigem origem exata, schema estrito, body de até 32 KiB e limite de 30 solicitações/minuto/usuário por processo. Nenhum endpoint aceita preço/total do navegador. O estado local de criação conserva o payload/chave após resposta perdida; recuperar a mesma solicitação não inicia envio.

Ruling: aplicar supressão explícita à uazapi e exigir autorização registrada nas campanhas oficiais, preservando a elegibilidade anterior dos disparos uazapi neste incremento. A autorização obrigatória para todos os disparos legados ainda exige integração da gestão de permissões nesse fluxo. Custo da decisão: ausência de autorização registrada continua sem bloquear o disparo legado; isso permanece pendente antes de considerar encerrada a seção 6 do plano.

Verificação: 13 testes de campanhas passaram, cobrindo tenant/papel/origem, criação e início idempotentes, dedup por contato/alias, Redis obrigatório, revisão de tarifa, slots entre campanhas, cancelamento durante consulta remota, timeout sem reenvio, BSUID, descadastro durante preparação e preservação do telefone suprimido no worker uazapi. A suíte geral final terminou com 715 aprovações e somente a falha anterior em `test/broadcasts.test.ts:189` (404 esperado, 409 recebido). Typechecks dos dois projetos, lint/build da API e build do web passaram; lint do web manteve zero erros e o warning anterior em `lib/api.ts:17`. Scanner dos identificadores novos passou.

Playwright com auth/API fictícias confirmou desktop (1440 px) e celular (390 px): pessoa sem permissão excluída, registro individual com evidência, preview invalidado ao editar conteúdo, mesma chave/payload ao repetir criação após resposta perdida, custo alterado exigindo nova previsão aprovada e resultado incerto sem reenvio. Capturas foram inspecionadas; não houve erros de runtime nem overflow horizontal da página/diálogo. A seleção reutiliza o controle visível Base UI do fluxo existente. Servidor visual encerrado e alteração automática do Next em AGENTS.md removida.

A revisão independente encontrou supressão consultando só o telefone atual do cadastro enquanto a uazapi enviava ao número congelado. A correção verifica o número efetivo e mantém phoneKey nas revisões; o teste altera ambos os cadastros e confirma exclusão pelo worker. A revisão final dos arquivos e hashes não encontrou P1/P2 remanescente. Revisão foi estática; testes e navegador foram executados pelo implementador.

Referências atuais consultadas: [política de mensagens, seção 1](https://whatsappbusiness.com/policy/) (opt-in e descadastro), [marketing templates](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/custom-marketing-templates) e [limites por usuário](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/per-user-limits), estas duas pelo Context7. O CRM não tenta contornar limites da Meta nem repete automaticamente uma falha de campanha. A conta real, elegibilidade, entrega e Redis de produção não foram validados nesta sessão.

Schema aplicado somente no banco local novo `eloscrm_whatsapp_campaigns_test`. `.env.test`, dev, produção e configurações reais da Meta permaneceram intactos. Filas e Graph foram simuladas nos testes novos; não houve mensagem real, commit, push ou deploy. Produção ainda exige schema aplicado manualmente antes da imagem nova.

Continuam pendentes: autorização obrigatória no fluxo legado uazapi, personalização de parâmetros por destinatário, componentes adicionais de templates, conciliação com fatura e recortes financeiros adicionais. Também permanecem backfill uazapi, automações inbound oficiais, download de mídia recebida, offboarding/revinculação, retenção e validações do piloto já registradas. Este incremento não encerra todas as etapas da atualização.


## 18. Oitavo incremento de implementação

Escopo implementado: autorização registrada também nos disparos uazapi e parâmetros oficiais personalizados por destinatário. Este incremento substitui as duas pendências registradas na seção 17; o app continua usando canais explícitos, sem fallback automático.

1. `broadcasts.service.ts` exige autorização compatível com o telefone no preview, na criação e antes do envio pelo worker. Permissão ausente, descadastro ou autorização vinculada a outro telefone excluem o destinatário. A verificação inclui o número congelado no disparo, mesmo quando o cadastro é alterado depois. Mensagens manuais de atendimento permanecem fora deste escopo de campanhas.
2. A etapa de destinatários da uazapi mostra a causa de exclusão. Gestores podem consultar pessoas da lista e registrar autorização/descadastro com evidência individual, usando as mesmas rotas protegidas por tenant, papel e origem do fluxo oficial. Salvar a evidência atualiza a seleção a partir do preview. Não é necessário conectar um número oficial para registrar a permissão.
3. `campaigns.schema.ts` aceita `parameterSources` opcional com campos English permitidos: `firstName`, `fullName`, `dealTitle`, `dealValue`, `propertyTitle` e `ownerName`. Cada variável usa texto fixo ou uma fonte, sem aceitar ambos. Chaves e quantidades são limitadas; fontes desconhecidas e variáveis incompatíveis com o template são recusadas. O servidor consulta os negócios, contatos e membros da organização; não recebe nomes, preços ou conteúdo resolvido do navegador.
4. `parameters.ts` resolve campos do CRM por negócio. Campos ausentes e texto personalizado acima dos limites excluem a pessoa, sem preencher valores inventados. `preview.service.ts` mostra o texto de cada destinatário, incluindo cabeçalho e rodapé quando presentes. A prévia genérica do formulário identifica o campo; a mensagem concreta aparece após o cálculo no servidor.
5. `campaigns.repo.ts` persiste os parâmetros individuais no recipient e a mensagem no snapshot. O hash inclui os valores resolvidos; alterações antes do início exigem revisão. `gate.service.ts` compara os parâmetros atuais com os aprovados antes da submissão e pausa a campanha quando mudam. O acompanhamento e a revisão mostram as mensagens salvas por destinatário. O comando mantém os parâmetros congelados e resultados incertos continuam sem reenvio automático.

Ruling: personalização usa fontes explícitas de um conjunto limitado, sem linguagem de expressão ou interpolação arbitrária. Dados ausentes excluem o destinatário e alterações exigem aprovação, em vez de substituir a mensagem silenciosamente. Custo da decisão: o gestor precisa completar os campos ou escolher texto fixo, e revisar campanhas quando os dados mudarem.

Verificação: 18 testes de campanhas passaram, incluindo mensagens distintas para duas pessoas, cabeçalho/rodapé, parâmetros persistidos iguais à prévia, fontes desconhecidas, campo ausente, alteração antes do início/worker e autorização uazapi no preview/criação/worker. A suíte completa anterior ao último teste adicional terminou com 719 aprovações e somente a falha já existente em `test/broadcasts.test.ts:192` (404 esperado, 409 recebido). Os fixtures de broadcasts agora registram autorizações fictícias explícitas; o contrato de produção não foi relaxado para atender testes. Typechecks dos dois projetos, lint/build da API e build final do web passaram. O lint geral do web manteve zero erros e o warning anterior em `lib/api.ts:17`; o lint focado nos componentes alterados passou sem avisos. Scanner dos identificadores novos e `git diff --check` passaram. Servidor visual encerrado e alteração automática do Next em AGENTS.md removida.

Playwright com auth/API fictícias confirmou personalização, invalidação de preview, recuperação do mesmo rascunho e revisão explícita de custo em desktop (1440 px) e celular (390 px). O fluxo uazapi confirmou exclusão sem permissão e seleção após registro individual de evidência, sem erros de runtime ou overflow horizontal. Capturas foram inspecionadas. A revisão estática independente conferiu arquivos/hashes e não encontrou P1/P2; uma mensagem de erro foi corrigida para pt-BR. A altura da lista de destinatários foi ajustada após a inspeção visual.

Não houve mudança de schema neste incremento. Testes reutilizaram somente o banco local exclusivo `eloscrm_whatsapp_campaigns_test`; `.env.test`, dev, produção e configurações reais da Meta permaneceram intactos. Graph e filas foram simulados nos testes de campanhas. Não houve mensagem real, commit, push ou deploy.

Continuam pendentes: componentes adicionais de templates, conciliação com fatura e recortes financeiros adicionais, backfill uazapi, automações inbound oficiais, download de mídia recebida, offboarding/revinculação, retenção e validações reais do piloto. Este incremento não encerra todas as etapas da atualização.

## 19. Nono incremento de implementação

Escopo: fechamento das pendências de mídia recebida, histórico uazapi, automações oficiais, manutenção da conexão, templates de mídia/botões e financeiro. A integração permanece direta no elosCRM, com Cloud API padrão e uazapi selecionada explicitamente.

1. Mídias oficiais recebidas entram em fila com lease persistida, limite de tentativas e recuperação. O download valida o host Meta, endereços públicos com DNS fixado na conexão, tamanho, hash e assinatura do arquivo; redirects são recusados. O arquivo fica no bucket privado. A inbox permite nova tentativa e renova URLs sem exigir uma instância uazapi ativa. Formatos: JPEG/PNG/WebP até 5 MiB; MP3/OGG Opus/MP4/PDF até 16 MiB.
2. O histórico uazapi ganha análise sem gravação e aplicação explícita em lotes de 100. Vínculos usam identidade exata da conexão ou lead já associado, sem fundir contatos por telefone aproximado. Grupos ficam separados; conflitos são apresentados para revisão. Remover a instância preserva conversas, mensagens e arquivos, desativando a conexão histórica.
3. Automação inbound persiste a intenção junto da mensagem e executa criação de lead, distribuição e entrada no funil em uma transação recuperável, comum aos dois provedores. Reentregas não duplicam efeitos. Histórico, ecos do celular e grupos não acionam automações oficiais. Ambiguidade de telefone exige revisão. Renomear um lead atualiza apenas títulos de negócios derivados do nome. Gestores acompanham as execuções e reprocessam falhas na nova aba Automações.
4. Desativação local remove a credencial, bloqueia submissões, cancela intenções ainda não enviadas e preserva resultados incertos para confirmação posterior. Todos os caminhos locais compartilham a trava de submissão. Reconectar o mesmo número na mesma imobiliária preserva o histórico; a propriedade entre tenants continua protegida. A remoção da conexão Coexistence na Meta permanece um procedimento manual no WhatsApp Business, separado da desativação local.
5. Retenção sanitiza somente o conteúdo de eventos processados e comandos terminais sem lease, mantendo identidades, hashes e chaves de deduplicação. Padrões de 30 dias para eventos e 90 para comandos, configuráveis pelas novas envs. Mensagens, custos, auditoria e itens pendentes/incertos continuam disponíveis.
6. Templates suportam cabeçalho de imagem, vídeo ou documento e complemento conservador de URL dinâmica. Atendimento e campanhas validam o upload por tenant/número. Campanhas congelam hash e metadados do arquivo, preservam os botões e mostram URLs completas na prévia. Alterações impedem o envio e exigem revisão. Templates de autenticação e componentes especiais continuam recusados explicitamente; não há implementação de OTP.
7. Custos têm recortes por contato, atendimento e campanha; o agregado Meta permanece separado e abrange a WABA. Importação de até 100 tarifas é atômica. O país de cobrança pode ser declarado na identidade, sem inferi-lo de BSUID. A conferência com documento financeiro registra referência, total, taxas/impostos opcionais, ator e snapshot imutável, sem alegar validação automática da fatura na Meta. Tarifas continuam cadastradas/importadas com fonte e vigência; valores ficam na moeda original.

Verificação: 762 testes passaram em 79 arquivos no banco local isolado `eloscrm_whatsapp_campaigns_test`; Graph e uazapi foram mockadas. O teste legado de instância desconectada foi alinhado ao contrato existente `409 / INSTANCE_NOT_CONNECTED`, sem alterar a rejeição da API. Typechecks e builds dos dois projetos passaram. Lint da API passou; lint do web teve zero erros e somente o aviso preexistente em `lib/api.ts:17`. Scanner dos identificadores novos e `git diff --check` passaram. A revisão estática encontrou e motivou as correções de propagação do nome e serialização da desativação.

Playwright com auth/API fictícias validou, em desktop e celular: recorte de custos, conferência financeira, importação inválida/válida, declaração de mercado, reprocessamento de automação, análise/aplicação de histórico e retenção, confirmação de desativação local e campanhas com upload/botão dinâmico. Criação idempotente, invalidação de prévia e resultados incertos sem reenvio foram preservados. Não houve erro de runtime ou overflow horizontal; capturas foram inspecionadas.

Schema aplicado somente no banco local isolado de testes. Nenhuma mensagem real, configuração Meta, banco dev/produção, commit, push ou deploy foi alterado. Antes do teste integrado, aplicar o schema no ambiente correspondente e habilitar webhook público, storage privado e Redis para campanhas. Um número cadastrado diretamente como Cloud API não foi convertido em Coexistence: o piloto exige Cadastro Incorporado com WhatsApp Business. Entrega real, callbacks públicos, sincronização/eco do celular e funcionamento de Redis no ambiente de destino ainda precisam do teste operacional.

> Criado em 2026-10-05 11:06 (-03) · Última modificação: 2026-10-07 09:33 (-03)
