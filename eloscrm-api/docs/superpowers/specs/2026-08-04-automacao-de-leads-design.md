# Automação de entrada de leads — criação e roleta de distribuição ✅ concluído

Quando alguém desconhecido manda mensagem no WhatsApp da imobiliária, hoje a conversa aparece no
inbox e **espera**. Um humano decide criar o lead, escolhe o funil, arrasta o card e define o
responsável. Este documento desenha o caminho para que essas três coisas aconteçam sozinhas, sob
configuração do gestor.

Decisões já tomadas com o cliente e que este plano assume:

| Pergunta | Resposta |
|---|---|
| Critério da roleta | **carga em aberto** — recebe quem tem menos negócios ativos |
| Gatilho | número desconhecido **e** lead já existente (o segundo ganha só o negócio) |
| Granularidade | **três chaves independentes**: criar lead, criar negócio, distribuir |

---

## 1. O que já existe e serve de base

O caminho automático já está montado — falta só a decisão no fim dele:

- `ingest.service.ts` recebe cada mensagem, faz o upsert da conversa e chama
  `linkClientIfUnambiguous`, que já resolve "esta conversa é de um lead que eu conheço?" pela
  `phoneKey`.
- `conversations.service.createClientFrom` já cria lead a partir de uma conversa, com
  `source: WHATSAPP` e o telefone formatado — é a versão manual do que a automação fará.
- `Pipeline.isDefault` e `Stage.position` já dizem qual é o funil padrão e qual é o primeiro
  estágio, que é o que o `AddToPipelineDialog` usa para pré-selecionar.

Dois detalhes do modelo atual que **moldam** o desenho:

**`Client.ownerId` e `Deal.ownerId` são `String?` sem relação.** Nada no banco impede que apontem
para alguém que saiu da imobiliária — e o web já convive com isso (`labels.ts` traduz id que não
resolve como "(removido)"). Consequência direta: a lista de corretores elegíveis da roleta tem de
ser derivada de `Member` **a cada atribuição**, nunca de um histórico. Quem sai da org para de
receber no mesmo instante, sem ninguém precisar limpar configuração.

**`AuditEvent.actorId` é `String?` sem chave estrangeira, e `actorName` é um snapshot.** Isso
permite registrar a automação como autora sem inventar um usuário de sistema no banco: `actorId`
nulo e `actorName: "Automação"`. O histórico do lead passa a dizer quem fez o quê sem mentir.

---

## 2. O que a automação decide, em ordem

```
mensagem chega
  └─ conversa existe? (upsert, já implementado)
      └─ linkClientIfUnambiguous — já implementado
          └─ AUTOMAÇÃO (novo)
              ├─ 1. conversa sem lead        → cria lead?        (chave 1)
              ├─ 2. lead sem negócio algum   → cria negócio?     (chave 2)
              └─ 3. lead recém-criado        → escolhe dono?     (chave 3)
```

### 2.1 Criar o lead (chave 1)

Só quando a conversa **não tem** `clientId`. O nome sai de `parseConversation().suggestedName`
(perfil do WhatsApp), o telefone da conversa, `source: WHATSAPP`.

**O caso ambíguo continua sendo humano.** `linkClientIfUnambiguous` recusa vincular quando a
`phoneKey` casa com mais de um lead — fixo e celular do mesmo número colidem nela. A automação
**não** pode resolver o que a ingestão deliberadamente deixou para uma pessoa: criar um lead novo ali
produziria o terceiro registro do mesmo cliente. Nesse caso a automação para e a conversa segue como
hoje, pedindo escolha na tela.

### 2.2 Criar o negócio (chave 2)

Vale para lead recém-criado **e** para lead que já existia — é o caso de quem sumiu por meses e
volta a falar. O funil e o estágio vêm da configuração; sem eles escolhidos, a chave não liga.

**Não cria se o lead já tem negócio — em qualquer funil e em qualquer estágio.** Sem essa regra,
cada "bom dia" de um cliente em negociação vira um card novo, e em uma semana o funil está
impossível de ler.

**A exceção é a nutrição**, e é ela que sustenta o "sumiu por meses e volta a falar" do parágrafo
acima: lead com `status = NURTURING` ganha card novo ao escrever. Nutrir é ação humana deliberada
(`POST /v1/clients/:id/nurture`, que exige decidir o que fazer com cada negócio aberto antes), então
é um sinal declarado de que o lead esfriou — nenhum caminho automático o liga.

> **Por que não "negócio aberto".** Até 2026-08-06 a regra olhava só para negócio aberto — estágio
> que não é `isWon` nem `isLost` —, e as duas correções anteriores erraram o alvo por manter essa
> premissa. Em produção a imobiliária marcou como ganho um estágio chamado "APROVADO" e como perdido
> um chamado "FECHADO", ambos **etapas do meio do processo dela**. O negócio ficava invisível para a
> guarda e cada mensagem do cliente criava outro card em "Novo lead": ela limpou o funil à mão e viu
> tudo duplicar em minutos. O significado de `isWon`/`isLost` é escolha de cada imobiliária, e a
> automação não pode depender dele para saber se alguém está em atendimento.
>
> A tentação seguinte é uma janela de tempo ("fechado há menos de N dias não recria"). Os dados de
> produção a descartam: uma duplicata nasceu **22 horas** depois do card original, então qualquer N
> plausível a pegaria — e nenhum N é explicável para o corretor que pergunta por que o card não
> apareceu. Nutrição responde a mesma pergunta com um sinal que o próprio usuário deu.

### 2.3 Escolher o dono (chave 3)

Três situações, e cada uma tem uma resposta diferente:

| Situação | Dono do lead | Dono do negócio |
|---|---|---|
| Lead recém-criado | roleta | o mesmo da roleta |
| Lead existente **com** dono | não muda | **herda o do lead** |
| Lead existente **sem** dono | roleta | o mesmo da roleta |

**Lead que já tem dono não troca.** Uma mensagem nova não pode transferir cliente de corretor —
seria a automação desfazendo combinação feita fora do sistema. Mas o negócio novo também não pode
nascer órfão nem cair na roleta: quem atende aquele cliente é quem deve ver o card. Por isso o
negócio **herda**, em vez de sortear.

**Lead órfão entra na roleta.** Sem dono não há trabalho a desfazer, e é justamente o lead que
ninguém está olhando. Isso também é o que impede a chave 3 de virar um botão morto quando a chave 1
está desligada: mesmo sem criar lead nenhum, a automação ainda distribui quem chegou sem
responsável.

**Título do negócio:** `Atendimento — {nome do lead}`, o mesmo texto que o `AddToPipelineDialog` já
usa. Duas convenções para a mesma coisa deixariam o funil com cards de duas caras conforme a origem.

---

## 3. A roleta

### 3.1 O critério e o empate

Recebe o corretor elegível com **menos negócios abertos** (`Deal` cujo estágio não é `isWon` nem
`isLost`, contados por `ownerId`).

O empate não é exceção, é o estado inicial: numa imobiliária que acabou de ligar a chave, **todos
têm zero**. Sem um desempate estável, o primeiro da lista receberia todos os leads até alguém
acumular carga — a roleta pareceria quebrada justamente na estreia.

Desempate: **quem recebeu há mais tempo** (`lastAssignedAt` mais antigo; nulo primeiro, para quem
nunca recebeu entrar na frente). Isso faz a roleta se comportar como rodízio enquanto as cargas são
iguais, e como balanceamento quando deixam de ser. Último critério, para ser determinístico:
`userId`.

### 3.2 Concorrência não é hipótese

Duas mensagens de leads diferentes chegando no mesmo segundo, com a fila de mídia em concorrência 5,
**leem a mesma carga e escolhem o mesmo corretor**. Ler-decidir-gravar sem proteção perde a corrida
em silêncio, e o sintoma é justamente o que o cliente quer evitar: distribuição desigual.

A atribuição roda dentro de uma transação que começa com `SELECT … FOR UPDATE` na linha de
configuração da organização, serializando as atribuições **por imobiliária**. Volume de leads é
baixo por natureza (dezenas por dia, não milhares por segundo), então serializar sai barato e
dispensa lógica de repetição.

### 3.3 Quem participa

Membros da organização que o gestor deixou ativos na tela. A lista é sempre a interseção com
`Member` no momento da atribuição — ver §1. Se ninguém estiver elegível (todos desmarcados, ou o
único corretor saiu), a automação cria o que tiver de criar e **deixa sem dono**, em vez de falhar:
lead sem responsável aparece na tela e alguém pega; lead que não existe, não.

---

## 4. Modelo de dados

```prisma
enum LeadAssignStrategy {
  LEAST_OPEN // menos negócios abertos, desempate por lastAssignedAt
}

model LeadAutomation {
  id             String       @id @default(cuid())
  organizationId String       @unique
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  autoCreateClient Boolean @default(false)

  autoCreateDeal Boolean @default(false)
  pipelineId     String?
  stageId        String?

  autoAssign Boolean            @default(false)
  strategy   LeadAssignStrategy @default(LEAST_OPEN)

  members   LeadAutomationMember[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model LeadAutomationMember {
  id             String         @id @default(cuid())
  automationId   String
  automation     LeadAutomation @relation(fields: [automationId], references: [id], onDelete: Cascade)
  userId         String
  active         Boolean        @default(true)
  // desempate da roleta enquanto as cargas são iguais — ver §3.1
  lastAssignedAt DateTime?

  @@unique([automationId, userId])
}
```

O enum nasce com um valor só de propósito: a coluna existe para a próxima estratégia não exigir
migração de dados, mas inventar `WEIGHTED` e `ROUND_ROBIN` agora seria escrever código sem cliente.

`pipelineId`/`stageId` ficam opcionais e **sem** relação declarada — coerente com `Deal.ownerId` e
suficiente aqui, desde que o serviço valide que o estágio pertence ao funil e que ambos são da org.
Funil apagado com a chave ligada é o caso a cobrir: a automação não encontra o estágio, registra o
motivo e não cria o negócio.

**Deploy:** `prisma db push` em produção, como todo schema novo neste projeto.

---

## 5. Onde o gatilho entra

Em `ingest.service.ts`, logo depois de `linkClientIfUnambiguous`, com **a mesma garantia** que o
enqueue de mídia recebeu: falha da automação não pode virar 5xx no webhook, senão a uazapi reentrega
uma mensagem já gravada. O erro é registrado e engolido; a mensagem, que é o dado que importa,
permanece.

A automação roda **só na primeira mensagem** de uma conversa que ainda não tem lead, ou quando o
lead existe e não tem negócio nenhum. Toda mensagem seguinte cai nas mesmas condições e não faz
nada — mas a verificação é uma consulta por mensagem, então o caminho começa por uma leitura barata
da configuração (uma linha por org, cacheável se um dia pesar).

---

## 6. API

| Rota | O quê |
|---|---|
| `GET /v1/lead-automation` | configuração + membros elegíveis, com nome resolvido |
| `PUT /v1/lead-automation` | grava as três chaves, funil/estágio e a lista de membros |

Gestor apenas (`owner`/`admin`) — decidir quem recebe leads é decisão de gestão. O `PUT` valida que
o estágio pertence ao funil e que os dois são da organização; sem isso, um id chutado apontaria a
automação para o funil de outra imobiliária.

Módulo novo `src/modules/lead-automation/` no formato do projeto (route → service → repo), com o
motor de decisão isolado em `assignment.service.ts` para ser testável sem webhook.

---

## 7. Tela

Rota nova `app/(app)/settings/automacoes/`, com entrada na sidebar dentro de Configurações. Três
blocos, um por chave, cada um explicando o efeito em uma linha:

1. **Criar lead automaticamente** — chave.
2. **Adicionar ao funil** — chave + dois selects (funil, estágio), desabilitados enquanto a chave
   estiver desligada. O select de estágio depende do funil, como no `AddToPipelineDialog`.
3. **Distribuir entre corretores** — chave + lista de membros com caixa de seleção, mostrando ao
   lado a **carga atual** de cada um. Ver o número ali é o que torna o critério compreensível: o
   gestor entende por que o próximo lead vai para fulano.

Um aviso quando `autoCreateDeal` está ligado sem funil escolhido, e outro quando `autoAssign` está
ligado sem nenhum membro ativo — os dois estados são configuração pela metade, e falham em silêncio
se a tela não avisar.

---

## 8. Testes

Com Postgres real, como o resto do projeto:

1. Conversa de número desconhecido, três chaves ligadas → lead + negócio + dono.
2. Chaves desligadas → nada acontece (o padrão é não automatizar).
3. Lead já existente **com** dono → ganha negócio com o mesmo dono, e o lead não troca.
3b. Lead já existente **sem** dono → roleta define, no lead e no negócio.
4. Lead com negócio em qualquer funil → não cria segundo negócio, mesmo que o negócio tenha sido
   movido para fora do funil da automação, e mesmo que esteja num estágio marcado como ganho ou
   perdido.
4b. Lead em nutrição → ganha negócio novo ao voltar a falar; é o único caso em que um lead com
   histórico recebe um segundo card sozinho.
5. `phoneKey` ambígua → automação não cria lead nenhum.
6. Roleta com todos em zero → distribui em rodízio, não empilha no primeiro.
7. Roleta com cargas diferentes → vai para o de menor carga.
8. Membro que saiu da organização não recebe, mesmo com a linha ativa na configuração.
9. Nenhum membro elegível → cria sem dono, sem erro.
10. Automação que falha não derruba o webhook (responde 200).
11. Funil configurado apagado → não cria negócio, e a mensagem entra normalmente.
12. `PUT` com estágio de outro funil ou de outra org → recusado.

O teste 6 é o que mais importa: é o comportamento na estreia, e o que quebra se o desempate por
`lastAssignedAt` for esquecido.

---

## 9. Fases

### Fase 1 — modelo e configuração ✅ concluída
- [x] `LeadAutomation` + `LeadAutomationMember` + enum, `db push` em dev e teste
- [x] módulo `lead-automation` com `GET`/`PUT`, validação de funil/estágio e guarda de gestor
- [x] 12 testes (teste 12 incluso, mais os de leitura e preservação da roleta)

**A configuração nasce na primeira leitura, desligada.** Assim nem a tela nem a ingestão precisam
tratar "ainda não existe", e o padrão desligado é o único aceitável: automação ligada de fábrica
mexeria no funil de quem nunca pediu.

**Salvar não recria as linhas de membro.** `deleteMany` + `createMany` seria mais curto e perderia o
`lastAssignedAt` de quem continua na roleta — o desempate voltaria à estaca zero toda vez que o
gestor abrisse a tela e salvasse. Quem sai da roleta vira `active: false`, não some.

**Leitura liberada a qualquer membro, escrita só para gestor.** O corretor tem o direito de saber
como os leads são distribuídos; decidir quem recebe é que é decisão de gestão.

### Fase 2 — motor de atribuição ✅ concluída
- [x] `assignment.service.ts`: carga por `ownerId`, desempate, interseção com `Member`
- [x] transação com `FOR UPDATE`, e `lastAssignedAt` gravado na mesma
- [x] herança de dono do lead existente (§2.3), que não passa pela roleta
- [x] 11 testes (3b, 6, 7, 8, 9 inclusos)

**O teste de concorrência precisou ser refeito para valer alguma coisa.** A primeira versão disparava
duas atribuições em paralelo e checava que eram diferentes — e passava **com o `FOR UPDATE`
removido**, ou seja, não testava nada: duas chamadas não chegam a se sobrepor. A versão que ficou
dispara **seis** de uma vez para três corretores e exige `[2, 2, 2]`. Sem o lock, o resultado medido
é `[0, 0, 6]`: as seis transações leem a mesma carga e o mesmo `lastAssignedAt`, escolhem o mesmo
corretor, e a distribuição sai exatamente tão torta quanto a roleta existe para evitar.

Vale o registro porque é o teste mais fácil de escrever errado do projeto: concorrência que não
concorre passa sempre, e dá a impressão de cobertura onde não há nenhuma.

### Fase 3 — gatilho na ingestão ✅ concluída
- [x] chamada após `linkClientIfUnambiguous`, com catch que não derruba o webhook
- [x] criação de lead, negócio e dono, com auditoria em nome de "Automação"
- [x] 11 testes (1, 2, 3, 4, 5, 10, 11 inclusos)

**`linkClientIfUnambiguous` passou a devolver o que decidiu.** A automação precisa da diferença
entre "não achei ninguém" e "achei demais": no primeiro caso ela cria o lead, no segundo tem de
ficar quieta. Antes a função não contava nem uma coisa nem outra.

**O ator sintético grava `actorId` nulo.** `AUTOMATION_ACTOR` tem id vazio e `recordAudit` converte
para `null` — o histórico exibe só `actorName`, e uma string vazia na coluna se passaria por
usuário. A timeline do lead diz "Automação criou".

**O catch do ingest esconde bugs de teste, não só de produção.** O teste "funil apagado não impede a
mensagem de entrar" passava **com a checagem do estágio removida**: `deals.create` lançava, o catch
engolia, e o resultado observável era idêntico. Foi preciso um segundo teste chamando
`applyToConversation` **direto**, sem a rede de proteção, para distinguir tratado de estourado.
Segundo caso do dia em que o teste óbvio não testava nada — ver Fase 2.

### Fase 4 — tela ✅ concluída
- [x] `settings/automacoes` com os três blocos e a carga por corretor
- [x] avisos de configuração pela metade (funil sem estágio, roleta sem ninguém)
- [x] entrada em Configurações

**Entrada em Configurações, não na sidebar.** A sidebar tem nove itens e é o menu de trabalho
diário; automação se configura uma vez e se revisa raramente. Ficou como cartão dentro de
`/settings`, que é onde o gestor já vai mexer em membros.

**O formulário monta só com os dados em mãos.** A página renderiza o `AutomationForm` apenas quando
a query resolve, e ele copia a configuração para o estado local na primeira renderização — nenhum
efeito sincronizando estado, que é a regra do projeto, e refetch em segundo plano não sobrescreve o
que o gestor está editando.

**A tela mostra quem é o próximo.** Ao lado de cada corretor vai a contagem de negócios abertos, e
abaixo da lista, "o próximo lead vai para fulano". Sem isso o critério é invisível: o gestor liga a
chave e não tem como conferir se a distribuição faz sentido.

---

## 10. Riscos

| Risco | Tratamento |
|---|---|
| Roleta empilha no primeiro corretor | desempate por `lastAssignedAt` (§3.1) — o teste 6 existe por isso |
| Duas mensagens simultâneas, mesmo corretor | transação com `FOR UPDATE` por organização (§3.2) |
| Negócio duplicado a cada mensagem | só cria se o lead não tiver negócio nenhum, em estágio nenhum; nutrição é a exceção (§2.2) |
| Automação transfere lead de corretor | lead existente nunca troca de dono (§2.3) |
| Corretor que saiu continua recebendo | lista elegível derivada de `Member` a cada atribuição (§1) |
| Falha da automação derruba a ingestão | catch, como no enqueue de mídia (§5) |
| Lead criado no lugar errado por chave ambígua | automação não age quando a `phoneKey` colide (§2.1) |
| Histórico sem autor | `actorName: "Automação"`, `actorId` nulo (§1) |

---

## 11. Fora de escopo

Regras por origem (site, Instagram), horário de trabalho e escala de plantão, redistribuição de lead
parado, meta por corretor, notificação de lead recebido, e estratégias de roleta além da carga em
aberto — o enum existe para elas, o código não.

---

> Criado em 2026-08-04 11:05 (-03) · Última modificação: 2026-08-06 10:12 (-03)
