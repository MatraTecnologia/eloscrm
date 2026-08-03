import { button, fallbackLink, greeting, greetingText, paragraph, renderEmail } from "../render.js";

type Input = { name?: string | null; url: string };

export const resetPasswordTemplate = ({ name, url }: Input) => ({
  subject: "Redefinir sua senha do elosCRM",
  html: renderEmail({
    preheader: "Link para criar uma nova senha — válido por 1 hora.",
    heading: "Redefinir sua senha",
    body: [
      paragraph(greeting(name)),
      paragraph(
        "Recebemos um pedido para redefinir a senha da sua conta no elosCRM. Clique no botão abaixo para criar uma nova. O link vale por <strong>1 hora</strong> e só pode ser usado uma vez.",
      ),
      button(url, "Criar nova senha"),
      fallbackLink(url),
    ].join(""),
    footnote:
      "Se não foi você quem pediu, ignore este e-mail — sua senha atual continua valendo e nada muda.",
  }),
  text: `${greetingText(name)}\n\nRecebemos um pedido para redefinir sua senha no elosCRM. Abra o link abaixo para criar uma nova (válido por 1 hora, uso único):\n${url}\n\nSe não foi você, ignore este e-mail — sua senha atual continua valendo.`,
});
