import "dotenv/config";
import { buildApp } from "./app.js";
import { scheduleAuditRetention } from "./modules/audit/retention.service.js";
import { scheduleMetaLeadSync } from "./modules/meta/meta.sync.service.js";
import { env } from "./env.js";

const start = async () => {
  const app = await buildApp();
  // aqui e não em `app.ts`: os testes sobem o app por `buildApp()` e não devem falar com Redis nem
  // agendar nada. Sem REDIS_URL isto é no-op, e a purga fica por conta do `pnpm audit:purge`.
  await scheduleAuditRetention();
  // idem: sem Redis a busca de leads do Meta fica por conta do `pnpm meta:sync` ou do botão da tela
  await scheduleMetaLeadSync();
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
};

start();
