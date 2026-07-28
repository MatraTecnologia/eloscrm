import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { organization } from "better-auth/plugins";
import { prisma } from "./prisma.js";
import { env } from "../env.js";

const isProduction = env.NODE_ENV === "production";

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  // "http://localhost" existe só para o web de dev falar com a API; em produção seria uma
  // origem confiável a mais sem nenhum uso.
  trustedOrigins: isProduction ? [env.WEB_ORIGIN] : [env.WEB_ORIGIN, "http://localhost"],
  advanced: {
    // Em produção web e API ficam em hosts distintos: com o SameSite=Lax padrão o navegador
    // não devolve o cookie de sessão nas requisições do front e todo request autenticado dá 401.
    // Exige https nos dois lados. Em dev fica no Lax, que funciona em http://localhost.
    ...(isProduction && { defaultCookieAttributes: { sameSite: "none", secure: true } }),
  },
  emailAndPassword: { enabled: true },
  user: {
    changeEmail: {
      enabled: true,
      // Não há provedor de e-mail no projeto: sem isto o Better Auth só troca o endereço depois
      // que o novo for verificado por link, e o link nunca sai. Com a flag, a troca é imediata —
      // mas só para quem tem emailVerified false, que é todo mundo enquanto não houver verificação.
      // Ao ligar verificação de e-mail um dia, isto precisa de um sendVerificationEmail junto.
      updateEmailWithoutVerification: true,
    },
  },
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
