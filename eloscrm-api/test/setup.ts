import { config } from "dotenv";
import { randomBytes } from "node:crypto";

// override: o .env de dev pode já estar no ambiente (shell, IDE) e a suíte trunca o banco inteiro,
// então o DATABASE_URL do .env.test precisa vencer sempre. Em CI não há arquivo e o env já vem pronto.
config({ path: ".env.test", override: true });

// Credencial de cifra exclusiva de cada worker; testes não carregam o .env.local da Meta.
process.env.META_WHATSAPP_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.env.META_WHATSAPP_APP_SECRET = randomBytes(32).toString("hex");
process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN = randomBytes(32).toString("hex");
