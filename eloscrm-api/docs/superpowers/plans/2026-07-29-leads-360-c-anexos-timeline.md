# Leads 360 — Plano C: anexos privados e timeline unificada

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax
> for tracking.

**Goal:** A aba **Arquivos** deixa de ser um placeholder — documentos entram por upload direto no R2, num
bucket privado, e só são lidos por link assinado de vida curta. E a "Linha do tempo" passa a merecer o
nome: funde atividade, alteração auditada, comentário e anexo numa lista só.

**Architecture:** O browser sobe o arquivo direto para o R2 com uma URL PUT assinada pela API — o binário
nunca passa pelo Fastify. A linha em `Attachment` nasce `PENDING` e só vira `READY` quando o `confirm`
confirma o objeto no bucket com um `HEAD` de verdade. Leitura é sempre presigned GET de 60s. A timeline é
montada em memória a partir das quatro fontes, ordenada por data desc.

**Tech Stack:** Fastify 5, Prisma 7 (`prisma-client` rust-free), Zod 4, `@aws-sdk/client-s3` +
`@aws-sdk/s3-request-presigner`, Vitest 4 contra Postgres **e S3 reais**, Next 16 + TanStack Query.

Spec: [`specs/2026-07-29-leads-360-design.md`](../specs/2026-07-29-leads-360-design.md).
Fases já em produção: [A — auditoria](./2026-07-29-leads-360-a-auditoria.md) (`main` em `8db4fa5`) e
[B — cadastro e comentários](./2026-07-29-leads-360-b-cadastro-comentarios.md) (`main` em `218147d`).

## Global Constraints

- **`actor` é o último parâmetro** das funções de escrita dos services (`type Actor = { id: string; name:
  string }` de `src/lib/actor.ts`, obtido com `actorOf(request)`).
- **Nenhuma query de domínio sem `organizationId`.**
- **Guards por arquivo de rota**: `app.addHook("preHandler", authGuard)` + `app.addHook("preHandler",
  orgGuard)`. Rota nova sem os dois fica aberta.
- **O bucket é privado.** Nenhuma URL pública, nenhum objeto legível sem assinatura. Presign de upload
  expira em **300s**, de download em **60s**.
- **Import do Prisma** por caminho relativo a `src/generated/prisma`; `@prisma/client` é proibido por lint.
- **Sem `console.log`** fora de `prisma/` e `scripts/`. **`const` arrow functions**, nunca `function`.
- **Nunca enum cru nem emoji na UI** — rótulo em `lib/labels.ts` e ícone Lucide.
- **Sem migrations**: `pnpm db:push` e `pnpm db:push:test`, sempre os dois.
- **Estilo misto no web e em `src/lib/storage.ts`**: parte dos arquivos usa aspas simples e sem ponto e
  vírgula. Não há Prettier — siga o estilo do arquivo que está editando.
- **Commits em português, no imperativo.**

## Decisões desta fase

- **`confirm` faz `HEAD` de verdade** (D11 do spec). Confiar no cliente deixaria linha `READY` apontando
  para objeto inexistente sempre que o PUT falhasse. Isso obriga os testes a terem um S3 real — ver Task 1.
- **Anexo não gera evento de auditoria.** A timeline já mostra o anexo como item próprio (`kind:
  "ATTACHMENT"`); auditar também duplicaria a mesma informação em duas linhas.
- **`Property.photos` fica como está** (D8 do spec): vitrine é público por natureza, anexo é documento
  privado.
- **Timeline em memória** (D9): busca `limit` de cada fonte, funde, ordena e corta. Dezenas de itens por
  lead, não milhares. `limit` máximo 100.
- **Anexo `PENDING` órfão é lixo aceito.** Quem pede `upload-url` e nunca confirma deixa linha e, às
  vezes, objeto. A faxina é follow-up nomeado, não parte desta fase.
- **Sem seed de anexo.** Semear exigiria subir objeto no bucket a cada `db:seed`, acoplando o seed à rede.

---

### Task 1: Fundação de storage — commitar, apontar os testes para o S3 local e ligar o CI

O `src/lib/storage.ts` já existe na árvore de trabalho (não commitado), junto das envs `R2_*` em
`src/env.ts` e das duas deps `@aws-sdk/*` no `package.json`. Esta task versiona isso e resolve o problema
que impediria qualquer teste de anexo: **hoje o `.env.test` aponta para o R2 real de produção**, então a
suíte escreveria no bucket `eloscrm-private-data` a cada execução — e o CI, que usa credenciais fake,
falharia em qualquer chamada de rede.

**Files:**
- Commit as-is (só ajuste de estilo): `eloscrm-api/src/lib/storage.ts`, `eloscrm-api/src/env.ts`,
  `eloscrm-api/package.json`, `eloscrm-api/pnpm-lock.yaml`
- Modify: `eloscrm-api/.env.example`, `eloscrm-api/.env.test.example`, `eloscrm-api/.env.test` (local, não
  versionado)
- Modify: `eloscrm-api/test/global-setup.ts`
- Modify: `.github/workflows/ci.yml`
- Test: `eloscrm-api/test/storage.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: de `src/lib/storage.ts` — `R2_PRIVATE_BUCKET`, `getUploadUrl(bucket, key, { contentLength,
  contentType, expiresIn? })`, `getDownloadUrl(bucket, key, expiresIn?)`, `headFile(bucket, key)` →
  `{ contentLength }`, `deleteFile(bucket, key)`, `deleteFiles(bucket, keys)`; bucket de teste garantido
  pelo global-setup.

- [ ] **Step 1: Alinhar o estilo do `storage.ts` ao resto da API**

O arquivo está com aspas simples e sem ponto e vírgula, divergindo de todo o `src/`. Converter para aspas
duplas com ponto e vírgula, **sem mudar comportamento nenhum**. Rodar `pnpm lint` depois.

- [ ] **Step 2: Escrever o teste de fumaça do storage**

Criar `eloscrm-api/test/storage.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { R2_PRIVATE_BUCKET, deleteFile, getDownloadUrl, getUploadUrl, headFile } from "../src/lib/storage.js";

const key = `test/storage-${process.pid}-${Math.random().toString(36).slice(2, 8)}.txt`;

describe("storage", () => {
  it("assina PUT, sobe pelo browser, confirma por HEAD e apaga", async () => {
    const body = "conteudo de teste";
    const uploadUrl = await getUploadUrl(R2_PRIVATE_BUCKET, key, {
      contentLength: Buffer.byteLength(body),
      contentType: "text/plain",
    });

    // PUT feito como o browser faria: sem SDK, só a URL assinada
    const put = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "content-type": "text/plain", "content-length": String(Buffer.byteLength(body)) },
      body,
    });
    expect(put.ok).toBe(true);

    const head = await headFile(R2_PRIVATE_BUCKET, key);
    expect(head.contentLength).toBe(Buffer.byteLength(body));

    const downloadUrl = await getDownloadUrl(R2_PRIVATE_BUCKET, key, 60);
    const get = await fetch(downloadUrl);
    expect(await get.text()).toBe(body);

    await deleteFile(R2_PRIVATE_BUCKET, key);
    await expect(headFile(R2_PRIVATE_BUCKET, key)).rejects.toThrow();
  });

  it("recusa leitura sem assinatura", async () => {
    // o bucket é privado: a URL sem query de assinatura não pode devolver o objeto
    const bare = `${process.env.R2_ENDPOINT}/${R2_PRIVATE_BUCKET}/${key}`;
    const res = await fetch(bare);
    expect(res.ok).toBe(false);
  });
});
```

- [ ] **Step 3: Apontar `.env.test` para o S3 local e garantir o bucket**

No `.env.test` **local** (gitignored) e no `.env.test.example` versionado, trocar o bloco de storage por:

```bash
# S3 local (SeaweedFS na 8333) — os testes de anexo sobem e apagam objeto de verdade.
# Nunca apontar para o bucket de produção: a suíte escreve e apaga a cada execução.
R2_ENDPOINT=http://localhost:8333
R2_ACCESS_KEY_ID=seaweedadmin
R2_SECRET_ACCESS_KEY=seaweedadmin
R2_PRIVATE_BUCKET_NAME=eloscrm-test
```

Em `test/global-setup.ts`, criar o bucket depois do truncate e **antes** do `prisma.$disconnect()`.
O import do SDK pode ser estático no topo do arquivo — diferente de `src/lib/prisma.js`, ele não lê
`process.env` no topo do módulo, então não precisa do import dinâmico que o prisma exige:

```ts
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
```

```ts
  // o bucket de teste é criado aqui e não à mão: clone novo e CI sobem o S3 vazio
  const s3 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
  await s3
    .send(new CreateBucketCommand({ Bucket: process.env.R2_PRIVATE_BUCKET_NAME! }))
    .catch(() => null); // já existe é o caso normal a partir da segunda run
```

- [ ] **Step 4: Rodar o teste de storage**

Run: `cd eloscrm-api && pnpm vitest run test/storage.test.ts`
Expected: PASS — 2 testes. O SeaweedFS local precisa estar no ar (`docker ps | grep seaweedfs`).

- [ ] **Step 5: Subir um S3 no CI**

O `.github/workflows/ci.yml` já tem as envs de storage apontando para `localhost:8333` com credenciais
`test`, mas não há storage nenhum rodando lá. Service container não serve: nem MinIO nem SeaweedFS sobem
sem `command`, e `services:` do GitHub Actions não permite sobrescrever o comando. Use um step com
`docker run` antes dos testes, no job `api`, logo depois do checkout:

```yaml
      - name: Sobe S3 local (MinIO)
        run: |
          docker run -d --name minio -p 8333:9000 \
            -e MINIO_ROOT_USER=test -e MINIO_ROOT_PASSWORD=test12345 \
            minio/minio:RELEASE.2025-04-22T22-12-26Z server /data
          for i in $(seq 1 30); do
            curl -sf http://localhost:8333/minio/health/live && break
            sleep 1
          done
```

E ajustar a env do job para casar com a senha do MinIO (mínimo de 8 caracteres):

```yaml
      R2_SECRET_ACCESS_KEY: test12345
```

- [ ] **Step 6: Rodar a suíte inteira e verificar**

Run: `cd eloscrm-api && pnpm typecheck && pnpm lint && pnpm test`
Expected: os três limpos, com o arquivo novo somando 2 testes.

- [ ] **Step 7: Commit**

```bash
git add eloscrm-api/src/lib/storage.ts eloscrm-api/src/env.ts eloscrm-api/package.json eloscrm-api/pnpm-lock.yaml eloscrm-api/.env.example eloscrm-api/.env.test.example eloscrm-api/test/global-setup.ts eloscrm-api/test/storage.test.ts .github/workflows/ci.yml
git commit -m "feat: versiona o cliente de storage e testa contra S3 real"
```

---

### Task 2: Modelo `Attachment`

**Files:**
- Modify: `eloscrm-api/prisma/schema.prisma`
- Test: `eloscrm-api/test/attachment-model.test.ts`

**Interfaces:**
- Consumes: enum `AuditEntity` (fase A).
- Produces: `prisma.attachment`; enum `AttachmentStatus` (`PENDING|READY`).

- [ ] **Step 1: Escrever o teste que falha**

Criar `eloscrm-api/test/attachment-model.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { AttachmentStatus, AuditEntity } from "../src/generated/prisma/client.js";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let orgId = "";

beforeAll(async () => {
  app = await makeApp();
  ({ orgId } = await signUpWithOrg(app, `att-model-${stamp}@eloscrm.test`, `att-model-${stamp}`));
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("modelo Attachment", () => {
  it("nasce PENDING e guarda quem subiu", async () => {
    const attachment = await prisma.attachment.create({
      data: {
        organizationId: orgId,
        entityType: AuditEntity.CLIENT,
        entityId: "lead-1",
        key: `org/${orgId}/CLIENT/lead-1/abc-contrato.pdf`,
        filename: "contrato.pdf",
        contentType: "application/pdf",
        size: 1024,
        uploadedById: "user-1",
        uploadedByName: "Corretora Ana",
      },
    });

    expect(attachment.status).toBe(AttachmentStatus.PENDING);
    expect(attachment.uploadedByName).toBe("Corretora Ana");
  });

  it("recusa duas linhas com a mesma chave", async () => {
    const key = `org/${orgId}/CLIENT/lead-2/dup.pdf`;
    const data = {
      organizationId: orgId,
      entityType: AuditEntity.CLIENT,
      entityId: "lead-2",
      key,
      filename: "dup.pdf",
      contentType: "application/pdf",
      size: 10,
      uploadedById: "user-1",
      uploadedByName: "Corretora Ana",
    };
    await prisma.attachment.create({ data });
    await expect(prisma.attachment.create({ data })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd eloscrm-api && pnpm vitest run test/attachment-model.test.ts`
Expected: FAIL — `prisma.attachment` não existe.

- [ ] **Step 3: Adicionar o enum e o model**

Em `prisma/schema.prisma`, junto dos outros enums:

```prisma
enum AttachmentStatus {
  PENDING
  READY
}
```

E o model, depois de `Comment`:

```prisma
model Attachment {
  id             String           @id @default(cuid())
  organizationId String
  organization   Organization     @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  // mesmo par do AuditEvent e do Comment, e pelo mesmo motivo: sem FK por tipo de entidade
  entityType     AuditEntity
  entityId       String
  // chave no bucket privado: org/<orgId>/<entityType>/<entityId>/<cuid>-<slug>
  key            String           @unique
  filename       String
  contentType    String
  size           Int
  // PENDING até o confirm achar o objeto no bucket; a listagem só mostra READY
  status         AttachmentStatus @default(PENDING)
  uploadedById   String
  uploadedByName String
  createdAt      DateTime         @default(now())

  @@index([organizationId, entityType, entityId, createdAt])
}
```

Campo inverso em `Organization`, junto de `comments Comment[]`:

```prisma
  attachments Attachment[]
```

- [ ] **Step 4: Gerar client e aplicar nos dois bancos**

Run: `cd eloscrm-api && pnpm db:generate && pnpm db:push && pnpm db:push:test`
Expected: sincronizado nas duas.

- [ ] **Step 5: Rodar o teste**

Run: `cd eloscrm-api && pnpm vitest run test/attachment-model.test.ts`
Expected: PASS — 2 testes.

- [ ] **Step 6: Commit**

```bash
git add eloscrm-api/prisma/schema.prisma eloscrm-api/test/attachment-model.test.ts
git commit -m "feat: adiciona o modelo de anexos"
```

---

### Task 3: Módulo de anexos

**Files:**
- Create: `eloscrm-api/src/modules/attachments/attachments.schema.ts`
- Create: `eloscrm-api/src/modules/attachments/attachments.repo.ts`
- Create: `eloscrm-api/src/modules/attachments/attachments.service.ts`
- Create: `eloscrm-api/src/routes/v1/attachments/index.ts`
- Test: `eloscrm-api/test/attachments.test.ts`

**Interfaces:**
- Consumes: `Actor`, `actorOf`, `prisma.attachment`, `R2_PRIVATE_BUCKET`, `getUploadUrl`,
  `getDownloadUrl`, `headFile`, `deleteFile`, `httpError`, `notFound`.
- Produces:
  - `POST /v1/attachments/upload-url` `{ entityType, entityId, filename, contentType, size }` → 201
    `{ attachmentId, uploadUrl, key, expiresIn }`
  - `POST /v1/attachments/:id/confirm` → 200 attachment `READY`
  - `GET /v1/attachments?entityType&entityId` → 200 só os `READY`
  - `GET /v1/attachments/:id/download-url` → 200 `{ url, expiresIn }`
  - `DELETE /v1/attachments/:id` → 204

- [ ] **Step 1: Escrever o teste que falha**

Criar `eloscrm-api/test/attachments.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let cookie = "";
let cookieOrgB = "";
let clientId = "";

const BODY = "conteudo do contrato";

beforeAll(async () => {
  app = await makeApp();
  ({ cookie } = await signUpWithOrg(app, `att-a-${stamp}@eloscrm.test`, `att-a-${stamp}`));
  ({ cookie: cookieOrgB } = await signUpWithOrg(app, `att-b-${stamp}@eloscrm.test`, `att-b-${stamp}`));

  const created = await app.inject({
    method: "POST",
    url: "/v1/clients",
    headers: { cookie },
    payload: { name: "Lead com anexo" },
  });
  clientId = created.json().id;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const askUpload = (filename: string, contentType = "application/pdf", size = Buffer.byteLength(BODY)) =>
  app.inject({
    method: "POST",
    url: "/v1/attachments/upload-url",
    headers: { cookie },
    payload: { entityType: "CLIENT", entityId: clientId, filename, contentType, size },
  });

/** Sobe o arquivo como o browser faria: PUT direto na URL assinada, sem passar pela API. */
const putToBucket = async (uploadUrl: string, contentType = "application/pdf") => {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "content-type": contentType, "content-length": String(Buffer.byteLength(BODY)) },
    body: BODY,
  });
  expect(res.ok).toBe(true);
};

describe("anexos", () => {
  it("bloqueia sem sessão (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/attachments?entityType=CLIENT&entityId=x" });
    expect(res.statusCode).toBe(401);
  });

  it("recusa tipo fora da allowlist (422)", async () => {
    const res = await askUpload("virus.exe", "application/x-msdownload");
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION");
  });

  it("recusa arquivo acima de 20 MB (422)", async () => {
    const res = await askUpload("grande.pdf", "application/pdf", 21 * 1024 * 1024);
    expect(res.statusCode).toBe(422);
  });

  it("recusa entidade de outra organização (404)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/attachments/upload-url",
      headers: { cookie: cookieOrgB },
      payload: {
        entityType: "CLIENT",
        entityId: clientId,
        filename: "contrato.pdf",
        contentType: "application/pdf",
        size: 10,
      },
    });
    expect(res.statusCode).toBe(404);
  });

  it("faz o ciclo completo: assina, sobe, confirma, lista, baixa e apaga", async () => {
    const asked = await askUpload("contrato.pdf");
    expect(asked.statusCode).toBe(201);
    const { attachmentId, uploadUrl, key } = asked.json();
    expect(key).toContain(`/CLIENT/${clientId}/`);

    // antes do confirm, a listagem não mostra o anexo
    const pendingList = await app.inject({
      method: "GET",
      url: `/v1/attachments?entityType=CLIENT&entityId=${clientId}`,
      headers: { cookie },
    });
    expect(pendingList.json()).toEqual([]);

    await putToBucket(uploadUrl);

    const confirmed = await app.inject({
      method: "POST",
      url: `/v1/attachments/${attachmentId}/confirm`,
      headers: { cookie },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().status).toBe("READY");
    // o tamanho gravado é o que o bucket reporta, não o que o cliente prometeu
    expect(confirmed.json().size).toBe(Buffer.byteLength(BODY));

    const list = await app.inject({
      method: "GET",
      url: `/v1/attachments?entityType=CLIENT&entityId=${clientId}`,
      headers: { cookie },
    });
    expect(list.json()).toHaveLength(1);
    expect(list.json()[0].filename).toBe("contrato.pdf");

    const link = await app.inject({
      method: "GET",
      url: `/v1/attachments/${attachmentId}/download-url`,
      headers: { cookie },
    });
    expect(link.statusCode).toBe(200);
    const { url } = link.json();
    const downloaded = await fetch(url);
    expect(await downloaded.text()).toBe(BODY);

    const removed = await app.inject({
      method: "DELETE",
      url: `/v1/attachments/${attachmentId}`,
      headers: { cookie },
    });
    expect(removed.statusCode).toBe(204);

    // o objeto sai do bucket junto com a linha
    const afterDelete = await fetch(url);
    expect(afterDelete.ok).toBe(false);
  });

  it("recusa confirm quando o objeto não foi enviado (422)", async () => {
    const asked = await askUpload("fantasma.pdf");
    const { attachmentId } = asked.json();

    const res = await app.inject({
      method: "POST",
      url: `/v1/attachments/${attachmentId}/confirm`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("UPLOAD_NOT_FOUND");
  });

  it("não vaza anexo de outra organização", async () => {
    const asked = await askUpload("privado.pdf");
    const { attachmentId, uploadUrl } = asked.json();
    await putToBucket(uploadUrl);
    await app.inject({ method: "POST", url: `/v1/attachments/${attachmentId}/confirm`, headers: { cookie } });

    const list = await app.inject({
      method: "GET",
      url: `/v1/attachments?entityType=CLIENT&entityId=${clientId}`,
      headers: { cookie: cookieOrgB },
    });
    expect(list.json()).toEqual([]);

    const link = await app.inject({
      method: "GET",
      url: `/v1/attachments/${attachmentId}/download-url`,
      headers: { cookie: cookieOrgB },
    });
    expect(link.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd eloscrm-api && pnpm vitest run test/attachments.test.ts`
Expected: FAIL — 404 `Route POST:/v1/attachments/upload-url not found`.

- [ ] **Step 3: Criar o schema**

`src/modules/attachments/attachments.schema.ts`:

```ts
import * as z from "zod";
import { AuditEntity } from "../../generated/prisma/client.js";

export const MAX_SIZE_BYTES = 20 * 1024 * 1024;

// allowlist em vez de bloqueio por extensão: o navegador manda o content-type e é ele que assinamos
export const ALLOWED_CONTENT_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

export const uploadUrlSchema = z.object({
  entityType: z.enum(AuditEntity),
  entityId: z.string().min(1),
  filename: z.string().trim().min(1).max(200),
  contentType: z.enum(ALLOWED_CONTENT_TYPES),
  size: z.number().int().positive().max(MAX_SIZE_BYTES),
});

export const listAttachmentsQuerySchema = z.object({
  entityType: z.enum(AuditEntity),
  entityId: z.string().min(1),
});

export type UploadUrlInput = z.infer<typeof uploadUrlSchema>;
export type ListAttachmentsQuery = z.infer<typeof listAttachmentsQuerySchema>;
```

- [ ] **Step 4: Criar o repo**

`src/modules/attachments/attachments.repo.ts`:

```ts
import { AttachmentStatus, type AuditEntity } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import type { ListAttachmentsQuery } from "./attachments.schema.js";

export const listReady = (orgId: string, filters: ListAttachmentsQuery) =>
  prisma.attachment.findMany({
    where: {
      organizationId: orgId,
      entityType: filters.entityType,
      entityId: filters.entityId,
      status: AttachmentStatus.READY,
    },
    orderBy: { createdAt: "desc" },
  });

export const findAttachment = (orgId: string, id: string) =>
  prisma.attachment.findFirst({ where: { id, organizationId: orgId } });

export const createPending = (data: {
  organizationId: string;
  entityType: AuditEntity;
  entityId: string;
  key: string;
  filename: string;
  contentType: string;
  size: number;
  uploadedById: string;
  uploadedByName: string;
}) => prisma.attachment.create({ data });

export const markReady = (id: string, size: number) =>
  prisma.attachment.update({ where: { id }, data: { status: AttachmentStatus.READY, size } });

export const deleteAttachmentById = (id: string) => prisma.attachment.delete({ where: { id } });

// o anexo aponta para cliente, negócio, imóvel ou atividade; a existência dentro da org é checada aqui
export const entityExistsInOrg = async (orgId: string, entityType: AuditEntity, entityId: string) => {
  const where = { id: entityId, organizationId: orgId };
  if (entityType === "CLIENT") return !!(await prisma.client.findFirst({ where }));
  if (entityType === "DEAL") return !!(await prisma.deal.findFirst({ where }));
  if (entityType === "PROPERTY") return !!(await prisma.property.findFirst({ where }));
  return !!(await prisma.activity.findFirst({ where }));
};
```

- [ ] **Step 5: Criar o service**

`src/modules/attachments/attachments.service.ts`:

```ts
import type { Actor } from "../../lib/actor.js";
import { httpError, notFound } from "../../lib/http-error.js";
import { R2_PRIVATE_BUCKET, deleteFile, getDownloadUrl, getUploadUrl, headFile } from "../../lib/storage.js";
import * as repo from "./attachments.repo.js";
import type { ListAttachmentsQuery, UploadUrlInput } from "./attachments.schema.js";

const UPLOAD_EXPIRES_IN = 300;
const DOWNLOAD_EXPIRES_IN = 60;

// nome do arquivo não vai cru para a chave: acento, espaço e barra viram problema de URL e de path
const slugify = (filename: string) =>
  filename
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 100);

export const list = (orgId: string, filters: ListAttachmentsQuery) => repo.listReady(orgId, filters);

const getOwn = async (orgId: string, id: string) => {
  const attachment = await repo.findAttachment(orgId, id);
  if (!attachment) throw notFound("Anexo não encontrado");
  return attachment;
};

export const createUploadUrl = async (orgId: string, data: UploadUrlInput, actor: Actor) => {
  const exists = await repo.entityExistsInOrg(orgId, data.entityType, data.entityId);
  if (!exists) throw notFound("Registro não encontrado");

  // randomUUID em vez de cuid: o projeto não tem gerador de id no runtime, e o global do Node basta
  const key = `org/${orgId}/${data.entityType}/${data.entityId}/${crypto.randomUUID()}-${slugify(data.filename)}`;
  const attachment = await repo.createPending({
    organizationId: orgId,
    entityType: data.entityType,
    entityId: data.entityId,
    key,
    filename: data.filename,
    contentType: data.contentType,
    size: data.size,
    uploadedById: actor.id,
    uploadedByName: actor.name,
  });

  const uploadUrl = await getUploadUrl(R2_PRIVATE_BUCKET, key, {
    contentLength: data.size,
    contentType: data.contentType,
    expiresIn: UPLOAD_EXPIRES_IN,
  });

  return { attachmentId: attachment.id, uploadUrl, key, expiresIn: UPLOAD_EXPIRES_IN };
};

export const confirm = async (orgId: string, id: string) => {
  const attachment = await getOwn(orgId, id);
  // HEAD de verdade: sem isto, um PUT que falhou deixaria linha READY apontando para objeto inexistente
  const head = await headFile(R2_PRIVATE_BUCKET, attachment.key).catch(() => null);
  if (!head) throw httpError(422, "UPLOAD_NOT_FOUND", "O arquivo não chegou ao storage");
  return repo.markReady(id, head.contentLength);
};

export const downloadUrl = async (orgId: string, id: string) => {
  const attachment = await getOwn(orgId, id);
  const url = await getDownloadUrl(R2_PRIVATE_BUCKET, attachment.key, DOWNLOAD_EXPIRES_IN);
  return { url, expiresIn: DOWNLOAD_EXPIRES_IN };
};

export const remove = async (orgId: string, id: string) => {
  const attachment = await getOwn(orgId, id);
  // objeto primeiro: linha órfã é recuperável, objeto órfão em bucket privado é invisível para sempre
  await deleteFile(R2_PRIVATE_BUCKET, attachment.key);
  await repo.deleteAttachmentById(id);
};
```

- [ ] **Step 6: Criar a rota**

`src/routes/v1/attachments/index.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { authGuard } from "../../../plugins/auth-guard.js";
import { orgGuard } from "../../../plugins/org-guard.js";
import { actorOf } from "../../../lib/actor.js";
import {
  listAttachmentsQuerySchema,
  uploadUrlSchema,
} from "../../../modules/attachments/attachments.schema.js";
import * as service from "../../../modules/attachments/attachments.service.js";

const attachmentsRoutes = async (app: FastifyInstance) => {
  app.addHook("preHandler", authGuard);
  app.addHook("preHandler", orgGuard);

  app.get("/", async (request) => {
    const filters = listAttachmentsQuerySchema.parse(request.query);
    return service.list(request.orgId!, filters);
  });

  app.post("/upload-url", async (request, reply) => {
    const data = uploadUrlSchema.parse(request.body);
    const result = await service.createUploadUrl(request.orgId!, data, actorOf(request));
    return reply.status(201).send(result);
  });

  app.post("/:id/confirm", async (request) => {
    const { id } = request.params as { id: string };
    return service.confirm(request.orgId!, id);
  });

  app.get("/:id/download-url", async (request) => {
    const { id } = request.params as { id: string };
    return service.downloadUrl(request.orgId!, id);
  });

  app.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    await service.remove(request.orgId!, id);
    return reply.status(204).send();
  });
};

export default attachmentsRoutes;
```

- [ ] **Step 7: Rodar os testes**

Run: `cd eloscrm-api && pnpm vitest run test/attachments.test.ts && pnpm typecheck && pnpm test`
Expected: PASS — 7 testes novos, suíte inteira verde.

- [ ] **Step 8: Commit**

```bash
git add eloscrm-api/src/modules/attachments eloscrm-api/src/routes/v1/attachments eloscrm-api/test/attachments.test.ts
git commit -m "feat: adiciona anexos privados com upload assinado"
```

---

### Task 4: Timeline unificada

**Files:**
- Create: `eloscrm-api/src/modules/timeline/timeline.schema.ts`
- Create: `eloscrm-api/src/modules/timeline/timeline.repo.ts`
- Create: `eloscrm-api/src/modules/timeline/timeline.service.ts`
- Modify: `eloscrm-api/src/routes/v1/clients/index.ts`
- Test: `eloscrm-api/test/timeline.test.ts`

**Interfaces:**
- Consumes: `prisma.activity`, `prisma.auditEvent`, `prisma.comment`, `prisma.attachment`,
  `clients.service.getById`.
- Produces: `GET /v1/clients/:id/timeline?limit=<1..100>` → array de itens com `kind` ∈
  `ACTIVITY | AUDIT | COMMENT | ATTACHMENT`, cada um com `id`, `at` (ISO) e `payload`, ordenado desc.

- [ ] **Step 1: Escrever o teste que falha**

Criar `eloscrm-api/test/timeline.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let cookie = "";
let cookieOrgB = "";
let clientId = "";

beforeAll(async () => {
  app = await makeApp();
  ({ cookie } = await signUpWithOrg(app, `tl-a-${stamp}@eloscrm.test`, `tl-a-${stamp}`));
  ({ cookie: cookieOrgB } = await signUpWithOrg(app, `tl-b-${stamp}@eloscrm.test`, `tl-b-${stamp}`));

  const created = await app.inject({
    method: "POST",
    url: "/v1/clients",
    headers: { cookie },
    payload: { name: "Lead da timeline" },
  });
  clientId = created.json().id;

  // uma fonte de cada: alteração auditada, atividade, comentário e anexo confirmado
  await app.inject({
    method: "PATCH",
    url: `/v1/clients/${clientId}`,
    headers: { cookie },
    payload: { phone: "+5543988887777" },
  });
  await app.inject({
    method: "POST",
    url: "/v1/activities",
    headers: { cookie },
    payload: { type: "CALL", description: "Primeiro contato", clientId },
  });
  await app.inject({
    method: "POST",
    url: "/v1/comments",
    headers: { cookie },
    payload: { entityType: "CLIENT", entityId: clientId, body: "Cliente pediu retorno na quinta." },
  });

  const asked = await app.inject({
    method: "POST",
    url: "/v1/attachments/upload-url",
    headers: { cookie },
    payload: {
      entityType: "CLIENT",
      entityId: clientId,
      filename: "proposta.pdf",
      contentType: "application/pdf",
      size: 5,
    },
  });
  const { attachmentId, uploadUrl } = asked.json();
  await fetch(uploadUrl, {
    method: "PUT",
    headers: { "content-type": "application/pdf", "content-length": "5" },
    body: "hello",
  });
  await app.inject({
    method: "POST",
    url: `/v1/attachments/${attachmentId}/confirm`,
    headers: { cookie },
  });
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("GET /v1/clients/:id/timeline", () => {
  it("bloqueia sem sessão (401)", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/clients/${clientId}/timeline` });
    expect(res.statusCode).toBe(401);
  });

  it("funde as quatro fontes, mais recente primeiro", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/clients/${clientId}/timeline`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json();

    const kinds = new Set(items.map((i: { kind: string }) => i.kind));
    expect(kinds).toEqual(new Set(["ACTIVITY", "AUDIT", "COMMENT", "ATTACHMENT"]));

    const dates = items.map((i: { at: string }) => new Date(i.at).getTime());
    expect(dates).toEqual([...dates].sort((a, b) => b - a));

    const comment = items.find((i: { kind: string }) => i.kind === "COMMENT");
    expect(comment.payload.body).toBe("Cliente pediu retorno na quinta.");
    const attachment = items.find((i: { kind: string }) => i.kind === "ATTACHMENT");
    expect(attachment.payload.filename).toBe("proposta.pdf");
  });

  it("respeita o limit", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/clients/${clientId}/timeline?limit=2`,
      headers: { cookie },
    });
    expect(res.json()).toHaveLength(2);
  });

  it("recusa limit acima de 100 (422)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/clients/${clientId}/timeline?limit=101`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(422);
  });

  it("não entrega a timeline de cliente de outra organização (404)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/clients/${clientId}/timeline`,
      headers: { cookie: cookieOrgB },
    });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd eloscrm-api && pnpm vitest run test/timeline.test.ts`
Expected: FAIL — 404 na rota de timeline.

- [ ] **Step 3: Criar o schema**

`src/modules/timeline/timeline.schema.ts`:

```ts
import * as z from "zod";

export const timelineQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type TimelineQuery = z.infer<typeof timelineQuerySchema>;
```

- [ ] **Step 4: Criar o repo**

`src/modules/timeline/timeline.repo.ts`:

```ts
import { AttachmentStatus, AuditEntity } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";

/**
 * Busca `limit` de cada fonte para a fusão em memória: o item mais recente do conjunto está sempre
 * entre os `limit` mais recentes de alguma fonte, então cortar depois de ordenar dá o mesmo resultado
 * de um cursor real — com quatro queries em vez de um union.
 */
export const sources = (orgId: string, clientId: string, limit: number) =>
  Promise.all([
    prisma.activity.findMany({
      where: { organizationId: orgId, clientId },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.auditEvent.findMany({
      where: { organizationId: orgId, entityType: AuditEntity.CLIENT, entityId: clientId },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.comment.findMany({
      where: { organizationId: orgId, entityType: AuditEntity.CLIENT, entityId: clientId },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.attachment.findMany({
      where: {
        organizationId: orgId,
        entityType: AuditEntity.CLIENT,
        entityId: clientId,
        status: AttachmentStatus.READY,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
  ]);
```

- [ ] **Step 5: Criar o service**

`src/modules/timeline/timeline.service.ts`:

```ts
import * as repo from "./timeline.repo.js";
import type { TimelineQuery } from "./timeline.schema.js";

type TimelineItem = {
  kind: "ACTIVITY" | "AUDIT" | "COMMENT" | "ATTACHMENT";
  id: string;
  at: Date;
  payload: unknown;
};

export const forClient = async (orgId: string, clientId: string, query: TimelineQuery) => {
  const [activities, events, comments, attachments] = await repo.sources(orgId, clientId, query.limit);

  const items: TimelineItem[] = [
    // atividade usa a data do fato (concluída, ou agendada) e cai no createdAt quando não tem nenhuma
    ...activities.map((a) => ({
      kind: "ACTIVITY" as const,
      id: a.id,
      at: a.doneAt ?? a.dueAt ?? a.createdAt,
      payload: { type: a.type, description: a.description, dueAt: a.dueAt, doneAt: a.doneAt },
    })),
    ...events.map((e) => ({
      kind: "AUDIT" as const,
      id: e.id,
      at: e.createdAt,
      payload: { action: e.action, actorName: e.actorName, changes: e.changes },
    })),
    ...comments.map((c) => ({
      kind: "COMMENT" as const,
      id: c.id,
      at: c.createdAt,
      payload: { body: c.body, authorId: c.authorId, authorName: c.authorName, editedAt: c.editedAt },
    })),
    ...attachments.map((f) => ({
      kind: "ATTACHMENT" as const,
      id: f.id,
      at: f.createdAt,
      payload: {
        filename: f.filename,
        contentType: f.contentType,
        size: f.size,
        uploadedByName: f.uploadedByName,
      },
    })),
  ];

  return items.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, query.limit);
};
```

- [ ] **Step 6: Ligar a rota em clients**

Em `src/routes/v1/clients/index.ts`, importar:

```ts
import { timelineQuerySchema } from "../../../modules/timeline/timeline.schema.js";
import * as timeline from "../../../modules/timeline/timeline.service.js";
```

E acrescentar, depois do `app.get("/:id", …)`:

```ts
  app.get("/:id/timeline", async (request) => {
    const { id } = request.params as { id: string };
    const query = timelineQuerySchema.parse(request.query);
    // getById primeiro: sem ele, cliente de outra org devolveria lista vazia em vez de 404
    await service.getById(request.orgId!, id);
    return timeline.forClient(request.orgId!, id, query);
  });
```

- [ ] **Step 7: Rodar os testes**

Run: `cd eloscrm-api && pnpm vitest run test/timeline.test.ts && pnpm typecheck && pnpm test`
Expected: PASS — 5 testes novos, suíte inteira verde.

- [ ] **Step 8: Commit**

```bash
git add eloscrm-api/src/modules/timeline eloscrm-api/src/routes/v1/clients/index.ts eloscrm-api/test/timeline.test.ts
git commit -m "feat: funde atividades, histórico, comentários e anexos numa timeline"
```

---

### Task 5: Tipos e queries no web

**Files:**
- Modify: `eloscrm-web/lib/types.ts`
- Create: `eloscrm-web/lib/queries/attachments.ts`
- Create: `eloscrm-web/lib/queries/timeline.ts`
- Modify: `eloscrm-web/lib/labels.ts`

**Interfaces:**
- Consumes: os endpoints das tasks 3 e 4.
- Produces: tipos `Attachment`, `AttachmentStatus`, `TimelineItem`; `useAttachments(entityType, entityId)`,
  `useUploadAttachment()`, `useDeleteAttachment()`, `useAttachmentDownload()`, `useClientTimeline(id)`;
  `formatFileSize`.

- [ ] **Step 1: Declarar os tipos**

Ao fim de `eloscrm-web/lib/types.ts`:

```ts
export type AttachmentStatus = "PENDING" | "READY";

export type Attachment = {
  id: string;
  organizationId: string;
  entityType: AuditEntity;
  entityId: string;
  filename: string;
  contentType: string;
  size: number;
  status: AttachmentStatus;
  uploadedById: string;
  uploadedByName: string;
  createdAt: string;
};

export type TimelineItem =
  | {
      kind: "ACTIVITY";
      id: string;
      at: string;
      payload: { type: ActivityType; description: string; dueAt: string | null; doneAt: string | null };
    }
  | {
      kind: "AUDIT";
      id: string;
      at: string;
      payload: {
        action: AuditAction;
        actorName: string | null;
        changes: Record<string, { from: unknown; to: unknown }> | null;
      };
    }
  | {
      kind: "COMMENT";
      id: string;
      at: string;
      payload: { body: string; authorId: string; authorName: string; editedAt: string | null };
    }
  | {
      kind: "ATTACHMENT";
      id: string;
      at: string;
      payload: { filename: string; contentType: string; size: number; uploadedByName: string };
    };
```

- [ ] **Step 2: Adicionar o formatador de tamanho**

Ao fim de `eloscrm-web/lib/labels.ts`:

```ts
// tamanho de arquivo em pt-BR: 1,4 MB e não 1.4 MB
export const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} KB`;
  return `${(kb / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
};
```

- [ ] **Step 3: Criar `lib/queries/attachments.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useActiveOrganization } from "@/lib/auth-client";
import type { Attachment, AuditEntity } from "@/lib/types";

export const useAttachments = (entityType: AuditEntity, entityId: string) => {
  const { data: org } = useActiveOrganization();
  return useQuery({
    queryKey: ["attachments", org?.id, entityType, entityId],
    queryFn: async () => {
      const { data } = await api.get<Attachment[]>("/attachments", { params: { entityType, entityId } });
      return data;
    },
    enabled: !!org?.id && !!entityId,
  });
};

/**
 * Três passos: a API assina, o browser sobe direto no bucket (o binário não passa pelo Fastify) e a
 * API confirma que o objeto chegou. O PUT vai com `fetch` puro porque a URL já carrega a assinatura —
 * o axios do projeto acrescentaria baseURL e credenciais que quebrariam a assinatura.
 */
export const useUploadAttachment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      entityType,
      entityId,
      file,
    }: {
      entityType: AuditEntity;
      entityId: string;
      file: File;
    }) => {
      const { data } = await api.post<{ attachmentId: string; uploadUrl: string }>(
        "/attachments/upload-url",
        { entityType, entityId, filename: file.name, contentType: file.type, size: file.size },
      );

      const put = await fetch(data.uploadUrl, {
        method: "PUT",
        headers: { "content-type": file.type },
        body: file,
      });
      if (!put.ok) throw new Error("upload falhou");

      const { data: confirmed } = await api.post<Attachment>(
        `/attachments/${data.attachmentId}/confirm`,
      );
      return confirmed;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["attachments"] });
      qc.invalidateQueries({ queryKey: ["timeline"] });
    },
  });
};

export const useDeleteAttachment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/attachments/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["attachments"] });
      qc.invalidateQueries({ queryKey: ["timeline"] });
    },
  });
};

// o link vive 60s: pedir na hora do clique em vez de guardar na lista
export const fetchDownloadUrl = async (id: string) => {
  const { data } = await api.get<{ url: string }>(`/attachments/${id}/download-url`);
  return data.url;
};
```

- [ ] **Step 4: Criar `lib/queries/timeline.ts`**

```ts
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useActiveOrganization } from "@/lib/auth-client";
import type { TimelineItem } from "@/lib/types";

export const useClientTimeline = (clientId: string) => {
  const { data: org } = useActiveOrganization();
  return useQuery({
    queryKey: ["timeline", org?.id, "client", clientId],
    queryFn: async () => {
      const { data } = await api.get<TimelineItem[]>(`/clients/${clientId}/timeline`);
      return data;
    },
    enabled: !!org?.id && !!clientId,
  });
};
```

- [ ] **Step 5: Invalidar a timeline nas mutations que a alimentam**

Em `lib/queries/clients.ts`, `lib/queries/activities.ts` e `lib/queries/comments.ts`, acrescentar
`qc.invalidateQueries({ queryKey: ["timeline"] })` ao `onSuccess` das mutations de escrita — sem isso a
timeline fica velha por até 30s (`staleTime` do QueryClient) depois de uma edição.

- [ ] **Step 6: Verificar**

Run: `cd eloscrm-web && pnpm typecheck && pnpm lint`
Expected: os dois limpos.

- [ ] **Step 7: Commit**

```bash
git add eloscrm-web/lib/types.ts eloscrm-web/lib/labels.ts eloscrm-web/lib/queries/attachments.ts eloscrm-web/lib/queries/timeline.ts eloscrm-web/lib/queries/clients.ts eloscrm-web/lib/queries/activities.ts eloscrm-web/lib/queries/comments.ts
git commit -m "feat: consulta anexos e timeline no web"
```

---

### Task 6: Aba Arquivos de verdade

**Files:**
- Create: `eloscrm-web/app/(app)/clients/[id]/attachments-panel.tsx`
- Modify: `eloscrm-web/app/(app)/clients/[id]/page.tsx`

**Interfaces:**
- Consumes: `useAttachments`, `useUploadAttachment`, `useDeleteAttachment`, `fetchDownloadUrl`,
  `formatFileSize`, `ALLOWED_CONTENT_TYPES` (repetido no front como `accept`).
- Produces: componente `AttachmentsPanel({ entityType, entityId })`.

- [ ] **Step 1: Criar o painel**

`eloscrm-web/app/(app)/clients/[id]/attachments-panel.tsx`:

```tsx
"use client";

import { useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Download, FileText, Paperclip, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  fetchDownloadUrl,
  useAttachments,
  useDeleteAttachment,
  useUploadAttachment,
} from "@/lib/queries/attachments";
import { formatFileSize } from "@/lib/labels";
import type { AuditEntity } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx";
const MAX_SIZE_BYTES = 20 * 1024 * 1024;

export const AttachmentsPanel = ({
  entityType,
  entityId,
}: {
  entityType: AuditEntity;
  entityId: string;
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: attachments, isLoading } = useAttachments(entityType, entityId);
  const upload = useUploadAttachment();
  const remove = useDeleteAttachment();
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    // checagem no cliente é cortesia: quem manda é a API, que recusa com 422
    if (file.size > MAX_SIZE_BYTES) {
      toast.error("O arquivo passa de 20 MB");
      return;
    }
    try {
      await upload.mutateAsync({ entityType, entityId, file });
      toast.success("Arquivo enviado");
    } catch {
      toast.error("Não foi possível enviar o arquivo");
    } finally {
      // sem isto, escolher o mesmo arquivo de novo não dispara onChange
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const download = async (id: string, filename: string) => {
    setDownloadingId(id);
    try {
      const url = await fetchDownloadUrl(id);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
    } catch {
      toast.error("Não foi possível abrir o arquivo");
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0])}
        />
        <Button size="sm" onClick={() => inputRef.current?.click()} disabled={upload.isPending}>
          <Paperclip className="size-4" />
          {upload.isPending ? "Enviando…" : "Anexar arquivo"}
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : !attachments?.length ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileText />
            </EmptyMedia>
            <EmptyTitle>Nenhum arquivo</EmptyTitle>
            <EmptyDescription>Contratos, documentos e propostas deste lead ficam aqui.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="space-y-2">
          {attachments.map((file) => (
            <li key={file.id} className="flex items-center gap-3 rounded-lg border p-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <FileText className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{file.filename}</p>
                <p className="text-xs text-muted-foreground">
                  {formatFileSize(file.size)} · {file.uploadedByName} ·{" "}
                  {format(parseISO(file.createdAt), "dd/MM/yyyy", { locale: ptBR })}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Baixar ${file.filename}`}
                  disabled={downloadingId === file.id}
                  onClick={() => download(file.id, file.filename)}
                >
                  <Download className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remover ${file.filename}`}
                  onClick={() => remove.mutate(file.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
```

- [ ] **Step 2: Trocar o placeholder pela aba real**

Em `page.tsx`, importar `AttachmentsPanel` de `./attachments-panel` e substituir todo o conteúdo do
`TabsContent value="arquivos"` (hoje um `Empty` fixo) por:

```tsx
        <TabsContent value="arquivos" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Arquivos</CardTitle>
            </CardHeader>
            <CardContent>
              <AttachmentsPanel entityType="CLIENT" entityId={client.id} />
            </CardContent>
          </Card>
        </TabsContent>
```

Remover do `import` de `@/components/ui/empty` o que deixou de ser usado em `page.tsx`, e o ícone
`Archive` do import de `lucide-react` se ninguém mais o usar — `pnpm lint` acusa import não usado.

- [ ] **Step 3: Verificar**

Run: `cd eloscrm-web && pnpm typecheck && pnpm lint && pnpm build`
Expected: os três limpos.

- [ ] **Step 4: Conferir na tela**

Com API e web no ar, aberto num lead, aba **Arquivos**: anexar um PDF pequeno, ver a linha aparecer com
tamanho e autor, baixar (o arquivo abre/baixa) e remover.
Expected: os três funcionam. Um arquivo `.exe` não deve nem aparecer no seletor (`accept`), e um PDF acima
de 20 MB precisa dar toast de erro sem subir nada.

- [ ] **Step 5: Commit**

```bash
git add "eloscrm-web/app/(app)/clients/[id]/attachments-panel.tsx" "eloscrm-web/app/(app)/clients/[id]/page.tsx"
git commit -m "feat: anexa, baixa e remove arquivos do lead"
```

---

### Task 7: Timeline unificada na tela do lead

**Files:**
- Create: `eloscrm-web/app/(app)/clients/[id]/unified-timeline.tsx`
- Modify: `eloscrm-web/app/(app)/clients/[id]/page.tsx`

**Interfaces:**
- Consumes: `useClientTimeline`, `AUDIT_ACTION_LABELS`, `FIELD_LABELS`, `activityTypeLabels`,
  `formatFileSize`, `ActivityIcon` de `@/components/app/activity-visuals`.
- Produces: componente `UnifiedTimeline({ clientId })`.

- [ ] **Step 1: Criar o componente**

`eloscrm-web/app/(app)/clients/[id]/unified-timeline.tsx`:

```tsx
"use client";

import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { FileText, History, MessageSquare } from "lucide-react";
import { useClientTimeline } from "@/lib/queries/timeline";
import { AUDIT_ACTION_LABELS, FIELD_LABELS, activityTypeLabels, formatFileSize } from "@/lib/labels";
import type { TimelineItem } from "@/lib/types";
import { ActivityIcon } from "@/components/app/activity-visuals";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

const showValue = (value: unknown) => {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  return String(value);
};

const Line = ({ item }: { item: TimelineItem }) => {
  if (item.kind === "ACTIVITY") {
    return (
      <>
        <ActivityIcon type={item.payload.type} size="md" />
        <div className="min-w-0 space-y-1">
          <p className="text-sm">
            <span className="font-medium">{activityTypeLabels[item.payload.type]}</span>{" "}
            {item.payload.description}
          </p>
        </div>
      </>
    );
  }

  if (item.kind === "COMMENT") {
    return (
      <>
        <span className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <MessageSquare className="size-4" />
        </span>
        <div className="min-w-0 space-y-1">
          <p className="text-sm">
            <span className="font-medium">{item.payload.authorName}</span> comentou
          </p>
          <p className="text-sm whitespace-pre-line text-muted-foreground">{item.payload.body}</p>
        </div>
      </>
    );
  }

  if (item.kind === "ATTACHMENT") {
    return (
      <>
        <span className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <FileText className="size-4" />
        </span>
        <div className="min-w-0 space-y-1">
          <p className="text-sm">
            <span className="font-medium">{item.payload.uploadedByName}</span> anexou{" "}
            {item.payload.filename}
          </p>
          <p className="text-xs text-muted-foreground">{formatFileSize(item.payload.size)}</p>
        </div>
      </>
    );
  }

  return (
    <>
      <span className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <History className="size-4" />
      </span>
      <div className="min-w-0 space-y-1">
        <p className="text-sm">
          <span className="font-medium">{item.payload.actorName ?? "Alguém"}</span>{" "}
          {AUDIT_ACTION_LABELS[item.payload.action]}
        </p>
        {item.payload.changes ? (
          <ul className="space-y-0.5">
            {Object.entries(item.payload.changes).map(([field, change]) => (
              <li key={field} className="text-xs text-muted-foreground">
                {FIELD_LABELS[field] ?? field}: {showValue(change.from)} → {showValue(change.to)}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </>
  );
};

export const UnifiedTimeline = ({ clientId }: { clientId: string }) => {
  const { data: items, isLoading } = useClientTimeline(clientId);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (!items?.length) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <History />
          </EmptyMedia>
          <EmptyTitle>Nada por aqui ainda</EmptyTitle>
          <EmptyDescription>
            Atividades, alterações, comentários e arquivos deste lead aparecem juntos aqui.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <ol className="space-y-3">
      {items.map((item) => (
        <li key={`${item.kind}-${item.id}`} className="flex gap-3 border-b pb-3 last:border-0">
          <Line item={item} />
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
            {format(parseISO(item.at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
          </span>
        </li>
      ))}
    </ol>
  );
};
```

- [ ] **Step 2: Usar a timeline unificada no Resumo**

Em `page.tsx`, importar `UnifiedTimeline` de `./unified-timeline` e, no card "Linha do tempo" da aba
Resumo, trocar

```tsx
                  <ActivityTimeline activities={allActivities} isLoading={loadingActivities} limit={5} />
```

por

```tsx
                  <UnifiedTimeline clientId={client.id} />
```

A aba **Atividades** continua com o `ActivityTimeline` — ali o recorte por tipo é o que interessa, e é o
mesmo componente que as abas Visitas e Propostas usam.

- [ ] **Step 3: Verificar**

Run: `cd eloscrm-web && pnpm typecheck && pnpm lint && pnpm build`
Expected: os três limpos.

- [ ] **Step 4: Conferir na tela**

Num lead que tenha as quatro coisas — edite um campo, registre uma atividade, comente e anexe um arquivo —
abrir a aba **Resumo**.
Expected: o card "Linha do tempo" mostra os quatro tipos misturados, em ordem decrescente de data, cada um
com seu ícone; nenhum nome de campo cru e nenhum enum aparecendo.

- [ ] **Step 5: Commit**

```bash
git add "eloscrm-web/app/(app)/clients/[id]/unified-timeline.tsx" "eloscrm-web/app/(app)/clients/[id]/page.tsx"
git commit -m "feat: mostra a linha do tempo unificada no resumo do lead"
```

---

## Fechamento do plano C

```bash
cd eloscrm-api && pnpm lint && pnpm typecheck && pnpm test
cd ../eloscrm-web && pnpm lint && pnpm typecheck && pnpm build
```

## Pré-requisito de produção — CORS do bucket R2

O upload direto do browser **falha com erro opaco de CORS**, não com 4xx útil, se o bucket não permitir
PUT da origem do web. Isso é configuração de console da Cloudflare, não código:

```json
[{
  "AllowedOrigins": ["http://localhost:3000", "https://<host-do-web-em-producao>"],
  "AllowedMethods": ["PUT", "GET"],
  "AllowedHeaders": ["content-type"],
  "ExposeHeaders": ["etag"],
  "MaxAgeSeconds": 3600
}]
```

Sem isso, o ciclo funciona nos testes (que fazem PUT server-side, sem CORS) e quebra só na tela — o pior
lugar para descobrir.

## Fora de escopo (nomeado, não esquecido)

- **Faxina de anexos `PENDING`** que nunca confirmaram (linha e, às vezes, objeto órfãos).
- **Anexos em negociação e imóvel na UI** — a API já aceita `entityType: DEAL | PROPERTY | ACTIVITY`; só a
  tela do lead consome nesta fase.
- **Timeline de negociação e imóvel** — o service é específico de cliente; generalizar é mecânico, mas
  ninguém pediu ainda.
- **Pré-visualização de imagem e PDF** na aba Arquivos (hoje é baixar).
- **Versionamento de anexo** (substituir mantendo histórico).
- **Paginação real da timeline** — hoje é `limit` com teto de 100, sem cursor.
- **Retenção de PII** no histórico e nos comentários — pendência herdada das fases A e B.

> Criado em 2026-07-29 21:27 (-03) · Última modificação: 2026-07-29 21:27 (-03)
