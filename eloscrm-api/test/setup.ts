import { config } from "dotenv";
import { randomBytes } from "node:crypto";

// override: o .env de dev pode já estar no ambiente (shell, IDE) e a suíte trunca o banco inteiro,
// então o DATABASE_URL do .env.test precisa vencer sempre. Em CI não há arquivo e o env já vem pronto.
config({ path: ".env.test", override: true });

// Credencial de cifra exclusiva de cada worker; testes não carregam o .env.local da Meta.
process.env.META_WHATSAPP_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.env.META_WHATSAPP_APP_SECRET = randomBytes(32).toString("hex");
process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN = randomBytes(32).toString("hex");

// O hub tem uma URL só para dev e produção: a suíte nunca usa a chave do .env. A porta 9 (discard)
// garante que um fetch esquecido sem mock falhe na hora em vez de sair da máquina.
process.env.HUB_API_URL = "http://127.0.0.1:9/v1";
process.env.HUB_API_KEY = `mh_test_${randomBytes(16).toString("hex")}`;
process.env.HUB_WEBHOOK_SECRET = randomBytes(32).toString("hex");
delete process.env.HUB_WEBHOOK_SECRET_PREVIOUS;

// a suíte continua cobrindo o disparo uazapi; o desligado tem arquivo próprio
process.env.UAZAPI_BROADCASTS_ENABLED ??= "true";
