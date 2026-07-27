import { buildApp } from "../../src/app.js";

export const makeApp = async () => {
  const app = await buildApp();
  await app.ready();
  return app;
};
