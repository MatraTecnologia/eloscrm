import { createEnv } from '@t3-oss/env-core'
import * as z from 'zod'

export const env = createEnv({
  server: {
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    DATABASE_URL: z.string().url(),
    BETTER_AUTH_SECRET: z.string().min(10),
    BETTER_AUTH_URL: z.string().url(),
    WEB_ORIGIN: z.string().url(),
    PORT: z.coerce.number().default(3333),

    // Cloudflare R2
    R2_ENDPOINT: z.url().trim(),
    R2_ACCESS_KEY_ID: z.string().trim().min(1),
    R2_SECRET_ACCESS_KEY: z.string().trim().min(1),
    R2_PRIVATE_BUCKET_NAME: z.string().trim().min(1),

    // Resend. Opcional de propósito: sem a chave o mailer não envia nada e imprime o conteúdo no
    // stdout — é o que mantém dev, teste e CI rodando sem credencial de provedor.
    RESEND_API_KEY: z.string().trim().min(1).optional(),
    // onboarding@resend.dev é o remetente de teste do Resend, que funciona sem domínio verificado.
    EMAIL_FROM: z.string().trim().min(1).default("elosCRM <onboarding@resend.dev>"),

    // uazapi (WhatsApp). Opcionais pelo mesmo motivo do RESEND_API_KEY: sem elas a API sobe normal e
    // só as rotas de WhatsApp respondem 503 — dev, teste e CI não ganham pré-requisito novo.
    UAZAPI_BASE_URL: z.url().trim().optional(),
    UAZAPI_ADMIN_TOKEN: z.string().trim().min(1).optional(),
    // openssl rand -hex 32
    UAZAPI_TOKEN_ENCRYPTION_KEY: z
      .string()
      .trim()
      .regex(/^[0-9a-f]{64}$/, "deve ser hex de 32 bytes (openssl rand -hex 32)")
      .optional(),
    // URL pública desta API, usada só para montar a URL do webhook entregue à uazapi. O fallback
    // para BETTER_AUTH_URL só serve em produção: em dev ele é localhost e a uazapi não alcança —
    // ali é preciso um túnel (cloudflared/ngrok) apontado aqui, senão o status só muda via sync.
    PUBLIC_API_URL: z.url().trim().optional(),
    // Caminho de um arquivo JSONL com a trilha bruta da integração (o que sai para a uazapi, o que
    // volta, e o corpo cru dos webhooks). Vazio = desligado. Ferramenta de diagnóstico: serve para
    // descobrir o formato real do envelope, que a spec da uazapi não documenta.
    UAZAPI_DEBUG_LOG: z.string().trim().min(1).optional(),
    // Fila das conversas de WhatsApp. Sem ela o processamento é inline — o que mantém teste e CI
    // sem infra, mas em produção devolve o problema que a fila existe para resolver.
    REDIS_URL: z.string().trim().min(1).optional(),
    // Quanto tempo o log de auditoria fica. A tabela cresce a cada ação e nada mais a poda: sem isto
    // ela só aumenta. 365 dias cobre o ciclo de uma negociação imobiliária com folga, e é também o
    // teto do dado pessoal que o snapshot de um registro apagado carrega.
    AUDIT_RETENTION_DAYS: z.coerce.number().int().min(30).max(3650).default(365),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
})
