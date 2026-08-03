import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { emailOTP, organization } from "better-auth/plugins";
import { prisma } from "./prisma.js";
import { env } from "../env.js";
import { sendEmail } from "./email/send.js";
import { verifyEmailTemplate } from "./email/templates/verify-email.js";
import { resetPasswordTemplate } from "./email/templates/reset-password.js";
import { otpCodeTemplate } from "./email/templates/otp-code.js";
import { passwordChangedTemplate } from "./email/templates/password-changed.js";
import { changeEmailTemplate } from "./email/templates/change-email.js";
import { orgInvitationTemplate } from "./email/templates/org-invitation.js";

const isProduction = env.NODE_ENV === "production";

const OTP_EXPIRES_IN_SECONDS = 600;

export const auth = betterAuth({
  appName: "elosCRM",
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  // "http://localhost" existe só para o web de dev falar com a API; em produção seria uma
  // origem confiável a mais sem nenhum uso.
  trustedOrigins: isProduction ? [env.WEB_ORIGIN] : [env.WEB_ORIGIN, "http://localhost"],
  advanced: {
    // Sem prefixo próprio os cookies se chamam "better-auth.session_token"/"session_data" — o nome
    // que TODO projeto Better Auth usa. Cookie em localhost não é isolado por porta: outro app em
    // localhost:XXXX grava no mesmo jar e, com Domain/Path diferente do nosso (host-only), passam a
    // existir dois cookies homônimos. O navegador manda os dois, o servidor lê o primeiro, a
    // assinatura HMAC falha contra o nosso secret e get-session responde null — o login "entra" e
    // volta para /login até limpar os dados do site. Reproduzido: cookie estranho antes do válido
    // derruba a sessão; depois, não.
    cookiePrefix: "eloscrm",
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
  emailAndPassword: {
    enabled: true,
    // Sem isto qualquer endereço digitado no cadastro vira conta válida. Consequência: o sign-up
    // não devolve mais sessão, e o sign-in de quem não confirmou responde 403 (o front trata).
    requireEmailVerification: true,
    // Redefinir senha é o caminho de quem perdeu o acesso — deixar as outras sessões vivas manteria
    // um invasor logado justamente no cenário em que a senha foi comprometida.
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      // `url` já é o endpoint da API que consome o token e só então redireciona para o `redirectTo`
      // pedido pelo cliente — montar a URL do web à mão aqui pularia a validação do token.
      const mail = resetPasswordTemplate({ name: user.name, url });
      void sendEmail({ to: user.email, ...mail });
    },
    onPasswordReset: async ({ user }) => {
      const mail = passwordChangedTemplate({ name: user.name });
      void sendEmail({ to: user.email, ...mail });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    // Quem acabou de confirmar já provou que é dono do endereço; mandar para o login de novo seria
    // um passo a mais sem ganho nenhum.
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      const mail = verifyEmailTemplate({ name: user.name, url });
      void sendEmail({ to: user.email, ...mail });
    },
  },
  user: {
    changeEmail: {
      enabled: true,
      // Com verificação obrigatória, todo usuário com sessão tem o e-mail confirmado: a troca passa
      // sempre por este link, enviado ao endereço **atual**, que é quem autoriza a mudança.
      sendChangeEmailConfirmation: async ({ user, newEmail, url }) => {
        const mail = changeEmailTemplate({ name: user.name, newEmail, url });
        void sendEmail({ to: user.email, ...mail });
      },
    },
  },
  plugins: [
    organization({
      sendInvitationEmail: async ({ id, email, role, organization: org, inviter }) => {
        const mail = orgInvitationTemplate({
          organizationName: org.name,
          inviterName: inviter.user.name,
          role,
          url: `${env.WEB_ORIGIN}/accept-invitation/${id}`,
        });
        void sendEmail({ to: email, ...mail });
      },
    }),
    emailOTP({
      expiresIn: OTP_EXPIRES_IN_SECONDS,
      // O código é atalho de login para quem já tem conta. Sem isto, digitar um e-mail desconhecido
      // na tela de código criaria uma conta sem nome pela porta dos fundos.
      disableSignUp: true,
      // A confirmação de e-mail do cadastro continua por link (o OTP aqui é só para login e
      // recuperação); ligar overrideDefaultEmailVerification trocaria o link por código.
      sendVerificationOTP: async ({ email, otp, type }) => {
        const mail = otpCodeTemplate({ otp, type, expiresInMinutes: OTP_EXPIRES_IN_SECONDS / 60 });
        void sendEmail({ to: email, ...mail });
      },
    }),
  ],
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
