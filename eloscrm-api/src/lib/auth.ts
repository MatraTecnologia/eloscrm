import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { organization } from "better-auth/plugins";
import { prisma } from "./prisma.js";
import { env } from "../env.js";

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: [env.WEB_ORIGIN, "http://localhost"],
  emailAndPassword: { enabled: true },
  plugins: [organization()],
  databaseHooks: {
    session: {
      create: {
        // Sem isto a sessão nasce sem activeOrganizationId e o app inteiro fica vazio até o
        // usuário escolher a imobiliária no switcher — a cada login. Elege a organização mais
        // antiga do usuário; quem tem várias troca pelo switcher normalmente.
        before: async (session) => {
          const membership = await prisma.member.findFirst({
            where: { userId: session.userId },
            orderBy: { createdAt: "asc" },
            select: { organizationId: true },
          });
          return { data: { ...session, activeOrganizationId: membership?.organizationId ?? null } };
        },
      },
    },
  },
});
