import { config } from "dotenv";

// Variáveis do processo prevalecem; em desenvolvimento, .env.local complementa o .env.
config({ path: process.env.NODE_ENV === "production" ? ".env" : [".env.local", ".env"], quiet: true });
