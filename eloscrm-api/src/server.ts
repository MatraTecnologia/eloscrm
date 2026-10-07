import "./load-env.js";
import { buildApp } from "./app.js";
import { scheduleAuditRetention } from "./modules/audit/retention.service.js";
import { scheduleMetaLeadSync } from "./modules/meta/meta.sync.service.js";
import { env } from "./env.js";
import { scheduleOfficialWebhookRecovery } from "./modules/whatsapp-official/webhook.service.js";
import { scheduleOnboardingRecovery } from "./modules/whatsapp-onboarding/sync-request.service.js";
import { scheduleSendRecovery } from "./modules/whatsapp-outbound/outbound.service.js";
import { scheduleCampaignRecovery } from "./modules/whatsapp-campaigns/dispatch.service.js";
import { scheduleBroadcastRecovery } from "./modules/broadcasts/broadcasts.service.js";
import { scheduleInboundAutomationRecovery } from "./modules/lead-automation/inbound-automation.service.js";
import { scheduleWhatsappRetention } from "./modules/whatsapp-maintenance/maintenance.service.js";
import { scheduleOfficialMediaRecovery } from "./modules/whatsapp-official/media.service.js";

const start = async () => {
  const app = await buildApp();
  // aqui e não em `app.ts`: os testes sobem o app por `buildApp()` e não devem falar com Redis nem
  // agendar nada. Sem REDIS_URL isto é no-op, e a purga fica por conta do `pnpm audit:purge`.
  await scheduleAuditRetention();
  // idem: sem Redis a busca de leads do Meta fica por conta do `pnpm meta:sync` ou do botão da tela
  await scheduleMetaLeadSync();
  const stopOfficialWebhookRecovery = scheduleOfficialWebhookRecovery();
  app.addHook("onClose", async () => stopOfficialWebhookRecovery());
  const stopOnboardingRecovery = scheduleOnboardingRecovery();
  app.addHook("onClose", async () => stopOnboardingRecovery());
  const stopSendRecovery = scheduleSendRecovery();
  app.addHook("onClose", async () => stopSendRecovery());
  const stopCampaignRecovery = scheduleCampaignRecovery();
  app.addHook("onClose", async () => stopCampaignRecovery());
  const stopBroadcastRecovery = scheduleBroadcastRecovery();
  app.addHook("onClose", async () => stopBroadcastRecovery());
  const stopAutomationRecovery = scheduleInboundAutomationRecovery();
  app.addHook("onClose", async () => stopAutomationRecovery());
  await scheduleWhatsappRetention();
  const stopMediaRecovery = scheduleOfficialMediaRecovery();
  app.addHook("onClose", async () => stopMediaRecovery());
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
};

start();
