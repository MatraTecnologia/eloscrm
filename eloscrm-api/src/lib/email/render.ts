import { env } from "../../env.js";

// Paleta espelhada de eloscrm-web/app/globals.css. Cliente de e-mail não lê CSS custom property
// nem <link>, então tudo aqui é hex literal e style inline.
const brand = {
  primary: "#2563eb",
  primaryDark: "#1d4ed8",
  onDarkAccent: "#60a5fa",
  dark: "#0f172a",
  text: "#334155",
  muted: "#64748b",
  faint: "#94a3b8",
  border: "#e2e8f0",
  surface: "#ffffff",
  canvas: "#f1f5f9",
  accentSurface: "#eff6ff",
  accentBorder: "#bfdbfe",
  danger: "#b91c1c",
  dangerSurface: "#fef2f2",
  dangerBorder: "#fecaca",
} as const;

const fontStack =
  "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** "Maria Silva" -> "Olá, Maria!"; sem nome vira uma saudação neutra. */
export const greetingText = (name?: string | null) => {
  const first = name?.trim().split(/\s+/)[0];
  return first ? `Olá, ${first}!` : "Olá!";
};

export const greeting = (name?: string | null) => escapeHtml(greetingText(name));

export const paragraph = (html: string) =>
  `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:${brand.text};">${html}</p>`;

export const muted = (html: string) =>
  `<p style="margin:0;font-size:13px;line-height:1.6;color:${brand.muted};">${html}</p>`;

// Botão "bulletproof": tabela em vez de <a> com padding, porque Outlook ignora padding em inline.
export const button = (href: string, label: string) => `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
    <tr>
      <td align="center" bgcolor="${brand.primary}" style="border-radius:10px;">
        <a href="${escapeHtml(href)}" target="_blank" style="display:inline-block;padding:14px 30px;font-family:${fontStack};font-size:15px;font-weight:600;line-height:1;color:#ffffff;text-decoration:none;border-radius:10px;">${escapeHtml(label)}</a>
      </td>
    </tr>
  </table>`;

export const codeBlock = (code: string) => `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:8px 0 20px;">
    <tr>
      <td align="center" bgcolor="${brand.accentSurface}" style="border:1px solid ${brand.accentBorder};border-radius:12px;padding:20px 12px;">
        <div style="font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:32px;font-weight:700;letter-spacing:10px;color:${brand.primaryDark};text-indent:10px;">${escapeHtml(code)}</div>
      </td>
    </tr>
  </table>`;

export const fallbackLink = (href: string) => `
  <p style="margin:0 0 4px;font-size:13px;line-height:1.6;color:${brand.muted};">Se o botão não funcionar, copie e cole este endereço no navegador:</p>
  <p style="margin:0 0 24px;font-size:13px;line-height:1.6;word-break:break-all;"><a href="${escapeHtml(href)}" target="_blank" style="color:${brand.primary};text-decoration:underline;">${escapeHtml(href)}</a></p>`;

export const alert = (html: string) => `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 24px;">
    <tr>
      <td bgcolor="${brand.dangerSurface}" style="border:1px solid ${brand.dangerBorder};border-left:4px solid ${brand.danger};border-radius:8px;padding:14px 16px;">
        <p style="margin:0;font-size:14px;line-height:1.6;color:${brand.danger};">${html}</p>
      </td>
    </tr>
  </table>`;

type ShellInput = {
  /** Texto de prévia na caixa de entrada — fica oculto no corpo. */
  preheader: string;
  heading: string;
  body: string;
  /** Rodapé específico do e-mail (ex.: "se não foi você, ignore"). */
  footnote?: string;
};

export const renderEmail = ({ preheader, heading, body, footnote }: ShellInput) => `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background-color:${brand.canvas};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${brand.canvas}" style="background-color:${brand.canvas};">
  <tr>
    <td align="center" style="padding:32px 16px;font-family:${fontStack};">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="width:100%;max-width:560px;">
        <tr>
          <td bgcolor="${brand.dark}" style="background-color:${brand.dark};border-radius:16px 16px 0 0;padding:28px 32px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding-right:12px;" valign="middle">
                  <img src="${env.WEB_ORIGIN}/icone.png" width="36" height="36" alt="" style="display:block;border:0;border-radius:8px;">
                </td>
                <td valign="middle">
                  <div style="font-family:${fontStack};font-size:22px;font-weight:700;letter-spacing:-0.3px;color:#ffffff;line-height:1.1;">elos<span style="color:${brand.onDarkAccent};">CRM</span></div>
                  <div style="font-family:${fontStack};font-size:12px;color:${brand.faint};line-height:1.4;padding-top:2px;">Conectando oportunidades</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td bgcolor="${brand.surface}" style="background-color:${brand.surface};border:1px solid ${brand.border};border-top:0;border-radius:0 0 16px 16px;padding:32px;">
            <h1 style="margin:0 0 16px;font-family:${fontStack};font-size:21px;font-weight:700;line-height:1.3;color:${brand.dark};">${escapeHtml(heading)}</h1>
            ${body}
          </td>
        </tr>
        <tr>
          <td style="padding:24px 32px 8px;text-align:center;">
            ${footnote ? `<p style="margin:0 0 12px;font-family:${fontStack};font-size:13px;line-height:1.6;color:${brand.muted};">${footnote}</p>` : ""}
            <p style="margin:0;font-family:${fontStack};font-size:12px;line-height:1.6;color:${brand.faint};">
              elosCRM · CRM para imobiliárias<br>
              <a href="${env.WEB_ORIGIN}" target="_blank" style="color:${brand.faint};text-decoration:underline;">${env.WEB_ORIGIN.replace(/^https?:\/\//, "")}</a>
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
