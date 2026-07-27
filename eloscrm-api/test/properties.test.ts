import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let cookie = "";
let orgId = "";
let cookieB = "";

beforeAll(async () => {
  app = await makeApp();
  ({ cookie, orgId } = await signUpWithOrg(app, `properties-a-${stamp}@eloscrm.test`, `properties-a-${stamp}`));
  ({ cookie: cookieB } = await signUpWithOrg(app, `properties-b-${stamp}@eloscrm.test`, `properties-b-${stamp}`));
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("properties", () => {
  it("bloqueia sem sessão (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/properties" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });

  it("valida corpo inválido no POST (422)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/properties",
      headers: { cookie },
      payload: { type: "Apartamento" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION");
  });

  it("cria, lista, busca, filtra, atualiza e remove um imóvel", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/properties",
      headers: { cookie },
      payload: {
        title: "Apartamento Centro",
        address: "Rua das Flores, 100",
        price: 350000,
        bedrooms: 3,
        photos: ["foto1.jpg", "foto2.jpg"],
      },
    });
    expect(created.statusCode).toBe(201);
    const property = created.json();
    expect(property.id).toBeTruthy();
    expect(property.organizationId).toBe(orgId);
    expect(property.status).toBe("DISPONIVEL");
    expect(Number(property.price)).toBe(350000);
    expect(property.bedrooms).toBe(3);
    expect(property.photos).toEqual(["foto1.jpg", "foto2.jpg"]);

    const list = await app.inject({ method: "GET", url: "/v1/properties", headers: { cookie } });
    expect(list.statusCode).toBe(200);
    expect(list.json().some((p: { id: string }) => p.id === property.id)).toBe(true);

    const byId = await app.inject({ method: "GET", url: `/v1/properties/${property.id}`, headers: { cookie } });
    expect(byId.statusCode).toBe(200);
    expect(byId.json().title).toBe("Apartamento Centro");

    const filteredByQ = await app.inject({ method: "GET", url: "/v1/properties?q=centro", headers: { cookie } });
    expect(filteredByQ.json().some((p: { id: string }) => p.id === property.id)).toBe(true);

    const filteredByStatus = await app.inject({
      method: "GET",
      url: "/v1/properties?status=DISPONIVEL",
      headers: { cookie },
    });
    expect(filteredByStatus.json().some((p: { id: string }) => p.id === property.id)).toBe(true);

    const patched = await app.inject({
      method: "PATCH",
      url: `/v1/properties/${property.id}`,
      headers: { cookie },
      payload: { status: "RESERVADO" },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().status).toBe("RESERVADO");

    const removed = await app.inject({ method: "DELETE", url: `/v1/properties/${property.id}`, headers: { cookie } });
    expect(removed.statusCode).toBe(204);

    const gone = await app.inject({ method: "GET", url: `/v1/properties/${property.id}`, headers: { cookie } });
    expect(gone.statusCode).toBe(404);
    expect(gone.json().error.code).toBe("NOT_FOUND");
  });

  it("não vaza imóvel entre organizações (cross-tenant → 404)", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/properties",
      headers: { cookie },
      payload: { title: "Casa Privada A" },
    });
    const propertyA = created.json();

    const byB = await app.inject({
      method: "GET",
      url: `/v1/properties/${propertyA.id}`,
      headers: { cookie: cookieB },
    });
    expect(byB.statusCode).toBe(404);

    const listB = await app.inject({ method: "GET", url: "/v1/properties", headers: { cookie: cookieB } });
    expect(listB.json().some((p: { id: string }) => p.id === propertyA.id)).toBe(false);
  });
});
