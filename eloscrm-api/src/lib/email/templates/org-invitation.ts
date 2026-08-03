import { button, escapeHtml, fallbackLink, paragraph, renderEmail } from "../render.js";

type Input = { organizationName: string; inviterName: string; role: string; url: string };

// Espelha eloscrm-web/lib/labels.ts — o e-mail sai da API e não tem acesso àquele mapa.
const labels: Record<string, string> = { owner: "Dono", admin: "Gestor", member: "Corretor" };
const roleLabel = (role: string) => labels[role] ?? role;

export const orgInvitationTemplate = ({ organizationName, inviterName, role, url }: Input) => ({
  subject: `${inviterName} convidou você para o elosCRM da ${organizationName}`,
  html: renderEmail({
    preheader: `Convite para trabalhar no funil de vendas da ${organizationName}.`,
    heading: `Convite para a ${escapeHtml(organizationName)}`,
    body: [
      paragraph(
        `<strong>${escapeHtml(inviterName)}</strong> convidou você para entrar no elosCRM da <strong>${escapeHtml(organizationName)}</strong> como <strong>${escapeHtml(roleLabel(role))}</strong>.`,
      ),
      paragraph(
        "Aceitando o convite você passa a ver os clientes, imóveis e negociações da imobiliária no mesmo funil que o time.",
      ),
      button(url, "Aceitar convite"),
      fallbackLink(url),
    ].join(""),
    footnote: "Se você não esperava este convite, pode ignorar este e-mail.",
  }),
  text: `${inviterName} convidou você para entrar no elosCRM da ${organizationName} como ${roleLabel(role)}.\n\nAceite o convite pelo link abaixo:\n${url}\n\nSe você não esperava este convite, ignore este e-mail.`,
});
