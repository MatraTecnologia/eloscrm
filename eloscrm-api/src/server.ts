import "dotenv/config";
import { buildApp } from "./app.js";
import { env } from "./env.js";

const start = async () => {
  const app = await buildApp();
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
};

start();
