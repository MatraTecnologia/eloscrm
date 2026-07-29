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
    // Pendente de revisão: os hosts de produção são subdomínios do mesmo domínio registrável, o
    // que os torna same-site — ali o Lax bastaria, e o None só expõe o cookie às restrições de
    // cookie de terceiros. Conferir contra os hosts no ar antes de trocar.
    ...(isProduction && { defaultCookieAttributes: { sameSite: "none", secure: true } }),
    // O rate limit é por IP do cliente, e atrás de um proxy reverso o x-forwarded-for chega como
    // cadeia ("cliente, proxy"). O Better Auth não confia em cadeia sem trustedProxies configurado:
    // não resolve IP nenhum e passa a contar tudo num balde único por rota — com os limites padrão
    // isso é 3 logins a cada 10s no sistema inteiro. x-real-ip é o header de IP único que o Traefik
    // (Easypanel) põe; o x-forwarded-for fica de fallback para quando não houver proxy na frente.
    ipAddress: { ipAddressHeaders: ["x-real-ip", "x-forwarded-for"] },
  },
  session: {
    // O web valida a sessão a cada carga de página; sem o cache é uma ida ao Postgres por carga.
    // 60s em vez dos 5min do exemplo da doc: quase todo o ganho, com 1/5 da janela em que uma
    // sessão revogada continua sendo aceita.
    cookieCache: { enabled: true, maxAge: 60 },
  },
  rateLimit: {
    // Só vale em produção — o Better Auth desliga o rate limit fora dela.
    // get-session é chamado em toda carga de página: dentro do balde geral (100 req/10s) o app
    // limitaria os próprios usuários muito antes de limitar qualquer abuso.
    customRules: { "/get-session": false },
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
