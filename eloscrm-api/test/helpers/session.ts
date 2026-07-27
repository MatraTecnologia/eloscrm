import type { FastifyInstance } from "fastify";

export const asCookie = (raw: string | string[] | undefined) =>
  Array.isArray(raw) ? raw.join("; ") : String(raw);

export const signUp = async (app: FastifyInstance, email: string) => {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { email, password: "senha123456", name: "Corretor Teste" },
  });
  return asCookie(res.headers["set-cookie"]);
};

export const signUpWithOrg = async (app: FastifyInstance, email: string, slug: string) => {
  const cookie = await signUp(app, email);
  const created = await app.inject({
    method: "POST",
    url: "/api/auth/organization/create",
    headers: { cookie },
    payload: { name: slug, slug },
  });
  const orgId: string = created.json().id ?? created.json().organization?.id;
  const activated = await app.inject({
    method: "POST",
    url: "/api/auth/organization/set-active",
    headers: { cookie },
    payload: { organizationId: orgId },
  });
  const activeCookie = activated.headers["set-cookie"] ? asCookie(activated.headers["set-cookie"]) : cookie;
  return { cookie: activeCookie, orgId };
};
