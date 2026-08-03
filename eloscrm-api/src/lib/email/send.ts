import { Resend } from "resend";
import { env } from "../../env.js";

type Mail = { to: string; subject: string; html: string; text: string };

// Instância única e preguiçosa: sem chave o SDK nem é construído, e os testes nunca tocam a rede.
let client: Resend | null = null;
const getClient = () => {
  if (!env.RESEND_API_KEY) return null;
  client ??= new Resend(env.RESEND_API_KEY);
  return client;
};

// Sem provedor configurado (dev), o link ou código precisa aparecer em algum lugar ou o fluxo fica
// impossível de testar à mão. `console` é proibido pelo oxlint fora de scripts/.
const logToStdout = ({ to, subject, text }: Mail) => {
  if (env.NODE_ENV === "test") return;
  // O corpo carrega token de reset válido por 1 hora: em produção isso viraria credencial no log do
  // container, à vista de qualquer um com acesso ao painel. Ali sai só o registro da falha.
  if (env.NODE_ENV === "production") {
    process.stdout.write(`[email] RESEND_API_KEY ausente — "${subject}" não foi enviado para ${to}\n`);
    return;
  }
  process.stdout.write(`\n[email] RESEND_API_KEY ausente — não enviado\n  para: ${to}\n  assunto: ${subject}\n${text}\n\n`);
};

/**
 * Dispara um e-mail transacional. **Nunca lança**: as chamadas do Better Auth usam `void send(...)`
 * para não medir o tempo de envio (timing attack), e uma promise rejeitada ali derrubaria o
 * processo como unhandled rejection.
 */
export const sendEmail = async (mail: Mail): Promise<void> => {
  const resend = getClient();
  if (!resend) {
    logToStdout(mail);
    return;
  }

  try {
    await resend.emails.send({
      from: env.EMAIL_FROM,
      to: mail.to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });
  } catch {
    // Um provedor fora do ar não pode virar 500 no login; o usuário reenvia.
  }
};
