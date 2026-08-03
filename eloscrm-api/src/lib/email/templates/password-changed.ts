import { alert, greeting, greetingText, paragraph, renderEmail } from "../render.js";
import { env } from "../../../env.js";

type Input = { name?: string | null };

export const passwordChangedTemplate = ({ name }: Input) => ({
  subject: "Sua senha do elosCRM foi alterada",
  html: renderEmail({
    preheader: "Aviso de segurança: a senha da sua conta acabou de mudar.",
    heading: "Sua senha foi alterada",
    body: [
      paragraph(greeting(name)),
      paragraph("A senha da sua conta no elosCRM acabou de ser redefinida com sucesso."),
      alert(
        `<strong>Não foi você?</strong> Redefina a senha de novo imediatamente em <a href="${env.WEB_ORIGIN}/forgot-password" style="color:#b91c1c;">${env.WEB_ORIGIN.replace(/^https?:\/\//, "")}/forgot-password</a> e avise o gestor da sua imobiliária.`,
      ),
    ].join(""),
  }),
  text: `${greetingText(name)}\n\nA senha da sua conta no elosCRM acabou de ser redefinida.\n\nNão foi você? Redefina a senha novamente em ${env.WEB_ORIGIN}/forgot-password e avise o gestor da sua imobiliária.`,
});
