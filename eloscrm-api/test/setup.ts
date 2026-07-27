import { config } from "dotenv";

// override: o .env de dev pode já estar no ambiente (shell, IDE) e a suíte trunca o banco inteiro,
// então o DATABASE_URL do .env.test precisa vencer sempre. Em CI não há arquivo e o env já vem pronto.
config({ path: ".env.test", override: true });
