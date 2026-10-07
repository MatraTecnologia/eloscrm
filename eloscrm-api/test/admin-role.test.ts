import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp } from "./helpers/app.js";
import { signIn, signUp, signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
let orgId: string;
let ownerCookie: string;
let adminCookie: string;
let memberCookie: string;
let ownerId: string;
let memberId: string;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

beforeAll(async () => {
  app = await makeApp();
  ({ cookie: ownerCookie, orgId } = await signUpWithOrg(app, `owner-${stamp}@eloscrm.test`, `admin-role-${stamp}`));
  ownerId = (await prisma.member.findFirstOrThrow({ where: { organizationId: orgId, role: "owner" } })).id;
  for (const role of ["admin", "member"]) {
    const email = `${role}-${stamp}@eloscrm.test`;
    await signUp(app, email);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const membership = await prisma.member.create({ data: { organizationId: orgId, userId: user.id, role } });
    const cookie = await signIn(app, email);
    if (role === "admin") adminCookie = cookie;
    else {
      memberCookie = cookie;
      memberId = membership.id;
    }
  }
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const post = (cookie: string, path: string, payload: Record<string, unknown>) => app.inject({
  method: "POST", url: `/api/auth/organization/${path}`, headers: { cookie }, payload: { organizationId: orgId, ...payload },
});

describe("Papel administrador", () => {
  it("dono promove corretor a admin e pode rebaixá-lo", async () => {
    expect((await post(ownerCookie, "update-member-role", { memberId, role: "admin" })).statusCode).toBe(200);
    expect((await prisma.member.findUniqueOrThrow({ where: { id: memberId } })).role).toBe("admin");
    expect((await post(ownerCookie, "update-member-role", { memberId, role: "member" })).statusCode).toBe(200);
  });

  it("admin gerencia convites e papéis de membros", async () => {
    expect((await post(adminCookie, "invite-member", { email: `invited-${stamp}@eloscrm.test`, role: "admin" })).statusCode).toBe(200);
    expect((await post(adminCookie, "update-member-role", { memberId, role: "admin" })).statusCode).toBe(200);
    expect((await post(adminCookie, "update-member-role", { memberId, role: "member" })).statusCode).toBe(200);
    expect((await post(adminCookie, "update", { data: { name: "Workspace administrado" } })).statusCode).toBe(200);
  });

  it("admin não remove nenhum dono, mesmo havendo outro dono", async () => {
    await post(ownerCookie, "update-member-role", { memberId, role: "owner" });
    const result = await post(adminCookie, "remove-member", { memberIdOrEmail: ownerId });
    expect(result.statusCode).toBeGreaterThanOrEqual(400);
    expect(result.statusCode).toBeLessThan(500);
    expect(await prisma.member.findUnique({ where: { id: ownerId } })).not.toBeNull();
    await post(ownerCookie, "update-member-role", { memberId, role: "member" });
  });

  it("admin não altera o dono nem promove alguém a dono", async () => {
    expect((await post(adminCookie, "update-member-role", { memberId: ownerId, role: "member" })).statusCode).toBe(403);
    expect((await post(adminCookie, "update-member-role", { memberId, role: "owner" })).statusCode).toBe(403);
  });

  it("admin não exclui workspace por nenhum endpoint", async () => {
    const result = await app.inject({ method: "DELETE", url: "/v1/organization", headers: { cookie: adminCookie }, payload: { confirm: `admin-role-${stamp}` } });
    expect(result.statusCode).toBe(403);
    const pluginResult = await post(adminCookie, "delete", {});
    expect(pluginResult.statusCode).toBeGreaterThanOrEqual(400);
    expect(await prisma.organization.findUnique({ where: { id: orgId } })).not.toBeNull();
  });

  it("corretor não promove membros nem remove o admin", async () => {
    expect((await post(memberCookie, "update-member-role", { memberId, role: "admin" })).statusCode).toBe(403);
    const admin = await prisma.member.findFirstOrThrow({ where: { organizationId: orgId, role: "admin" } });
    const result = await post(memberCookie, "remove-member", { memberIdOrEmail: admin.id });
    expect(result.statusCode).toBeGreaterThanOrEqual(400);
    expect(result.statusCode).toBeLessThan(500);
  });

  it("admin não gerencia membro de outro workspace", async () => {
    const foreign = await signUpWithOrg(app, `foreign-${stamp}@eloscrm.test`, `foreign-${stamp}`);
    const foreignMember = await prisma.member.findFirstOrThrow({ where: { organizationId: foreign.orgId } });
    expect((await post(adminCookie, "update-member-role", { memberId: foreignMember.id, role: "admin" })).statusCode).toBe(403);
    expect((await post(adminCookie, "remove-member", { memberIdOrEmail: foreignMember.id })).statusCode).toBeGreaterThanOrEqual(400);
    expect(await prisma.member.findUnique({ where: { id: foreignMember.id } })).not.toBeNull();
  });

  it("admin remove corretor", async () => {
    expect((await post(adminCookie, "remove-member", { memberIdOrEmail: memberId })).statusCode).toBe(200);
    expect(await prisma.member.findUnique({ where: { id: memberId } })).toBeNull();
  });
});
