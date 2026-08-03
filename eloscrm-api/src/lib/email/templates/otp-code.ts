import { codeBlock, muted, paragraph, renderEmail } from "../render.js";

type OtpType = "sign-in" | "email-verification" | "forget-password" | "change-email";

type Input = { otp: string; type: OtpType; expiresInMinutes: number };

const copy: Record<OtpType, { subject: string; heading: string; intro: string }> = {
  "sign-in": {
    subject: "Seu código de acesso ao elosCRM",
    heading: "Seu código de acesso",
    intro: "Use o código abaixo para entrar no elosCRM.",
  },
  "email-verification": {
    subject: "Seu código de confirmação do elosCRM",
    heading: "Confirme seu e-mail",
    intro: "Use o código abaixo para confirmar este endereço de e-mail.",
  },
  "forget-password": {
    subject: "Seu código para redefinir a senha do elosCRM",
    heading: "Código para redefinir a senha",
    intro: "Use o código abaixo para criar uma nova senha no elosCRM.",
  },
  "change-email": {
    subject: "Seu código para trocar o e-mail do elosCRM",
    heading: "Código para trocar o e-mail",
    intro: "Use o código abaixo para confirmar a troca do e-mail da sua conta no elosCRM.",
  },
};

export const otpCodeTemplate = ({ otp, type, expiresInMinutes }: Input) => {
  const { subject, heading, intro } = copy[type];
  return {
    subject,
    html: renderEmail({
      preheader: `Código ${otp} — expira em ${expiresInMinutes} minutos.`,
      heading,
      body: [
        paragraph(intro),
        codeBlock(otp),
        muted(
          `O código expira em <strong>${expiresInMinutes} minutos</strong> e vale para uma única tentativa de uso.`,
        ),
      ].join(""),
      footnote:
        "Nunca compartilhe este código. A equipe do elosCRM jamais vai pedir por telefone, WhatsApp ou e-mail.",
    }),
    text: `${intro}\n\nCódigo: ${otp}\n\nExpira em ${expiresInMinutes} minutos. Nunca compartilhe este código.`,
  };
};
