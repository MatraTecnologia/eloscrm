import { button, escapeHtml, fallbackLink, greeting, greetingText, paragraph, renderEmail } from "../render.js";

type Input = { name?: string | null; newEmail: string; url: string };

/** Vai para o endereço **atual** — é ele que autoriza a troca. */
export const changeEmailTemplate = ({ name, newEmail, url }: Input) => ({
  subject: "Confirme a troca do seu e-mail no elosCRM",
  html: renderEmail({
    preheader: `Pedido para trocar o e-mail da conta para ${newEmail}.`,
    heading: "Confirme a troca de e-mail",
    body: [
      paragraph(greeting(name)),
      paragraph(
        `Chegou um pedido para trocar o e-mail da sua conta no elosCRM para <strong>${escapeHtml(newEmail)}</strong>. A troca só acontece depois que você confirmar aqui.`,
      ),
      button(url, "Confirmar troca"),
      fallbackLink(url),
    ].join(""),
    footnote: "Se não foi você quem pediu, ignore este e-mail — nada será alterado.",
  }),
  text: `${greetingText(name)}\n\nChegou um pedido para trocar o e-mail da sua conta no elosCRM para ${newEmail}. Confirme pelo link abaixo:\n${url}\n\nSe não foi você, ignore este e-mail — nada será alterado.`,
});
