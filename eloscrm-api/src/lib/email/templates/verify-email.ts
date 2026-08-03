import { button, fallbackLink, greeting, greetingText, paragraph, renderEmail } from "../render.js";

type Input = { name?: string | null; url: string };

export const verifyEmailTemplate = ({ name, url }: Input) => ({
  subject: "Confirme seu e-mail no elosCRM",
  html: renderEmail({
    preheader: "Um clique para liberar seu acesso ao elosCRM.",
    heading: "Confirme seu e-mail",
    body: [
      paragraph(greeting(name)),
      paragraph(
        "Falta só confirmar este endereço para liberar seu acesso ao elosCRM. O link vale por <strong>1 hora</strong>.",
      ),
      button(url, "Confirmar e-mail"),
      fallbackLink(url),
    ].join(""),
    footnote: "Se você não criou uma conta no elosCRM, pode ignorar este e-mail.",
  }),
  text: `${greetingText(name)}\n\nConfirme seu e-mail no elosCRM abrindo o link abaixo (válido por 1 hora):\n${url}\n\nSe você não criou uma conta, ignore este e-mail.`,
});
