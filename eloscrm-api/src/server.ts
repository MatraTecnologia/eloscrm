import "dotenv/config";
import { buildApp } from "./app.js";
import { scheduleAuditRetention } from "./modules/audit/retention.service.js";
import { env } from "./env.js";

const start = async () => {
  const app = await buildApp();
  // aqui e não em `app.ts`: os testes sobem o app por `buildApp()` e não devem falar com Redis nem
  // agendar nada. Sem REDIS_URL isto é no-op, e a purga fica por conta do `pnpm audit:purge`.
  await scheduleAuditRetention();
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
};

start();
