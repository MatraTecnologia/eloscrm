/**
 * Chave de comparação de telefone: **DDD + os últimos 8 dígitos**.
 *
 * Existe por causa do nono dígito. O CRM guarda o telefone com máscara e 11 dígitos nacionais
 * (`(43) 99183-4229`), enquanto o JID do WhatsApp costuma vir com 10 (`554391834229`) — mesma
 * pessoa, e nenhuma comparação direta casa. Os 8 dígitos finais são justamente a parte que o nono
 * dígito não altera.
 *
 *   "(43) 99183-4229" → 43991834229 → "43" + "91834229" → "4391834229"
 *   "554391834229"    →   4391834229 → "43" + "91834229" → "4391834229"   ✅ mesma chave
 *
 * Colisão conhecida e aceita: fixo `(43) 3324-1234` e celular `(43) 93324-1234` produzem a mesma
 * chave. Por isso quem casa conversa com lead **não auto-vincula** quando mais de um cliente
 * responde pela mesma chave — a escolha vai para o corretor.
 */
/**
 * Formata para o padrão que o CRM já usa nos leads cadastrados à mão — `(43) 99812-4470`. O
 * WhatsApp entrega só dígitos (`554398124470`), e gravar assim deixaria a ficha do lead com um
 * número que destoa de todos os outros. Fora do formato brasileiro, devolve como veio.
 */
export const formatBrPhone = (value: string | null | undefined): string | null => {
  const digits = (value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  const national =
    digits.startsWith("55") && (digits.length === 12 || digits.length === 13)
      ? digits.slice(2)
      : digits;
  if (national.length !== 10 && national.length !== 11) return value ?? null;
  const ddd = national.slice(0, 2);
  const resto = national.slice(2);
  return `(${ddd}) ${resto.slice(0, resto.length - 4)}-${resto.slice(-4)}`;
};

/**
 * Número no formato que a uazapi recebe: só dígitos, com DDI. Telefone nacional de 10 ou 11 dígitos
 * ganha o 55; o que já vem com DDI passa como está; qualquer outro tamanho não é número discável e
 * volta `null` — é o que impede um disparo de gastar tentativa em lead com telefone incompleto.
 */
export const toWaNumber = (value: string | null | undefined): string | null => {
  const digits = (value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) return digits;
  return null;
};

export const phoneKey = (value: string | null | undefined): string | null => {
  const digits = (value ?? "").replace(/\D/g, "");
  if (!digits) return null;

  // 55 só é DDI quando o que sobra é um número nacional plausível; senão pode ser o próprio DDD
  const national =
    digits.startsWith("55") && (digits.length === 12 || digits.length === 13)
      ? digits.slice(2)
      : digits;

  // sem DDD não há como comparar com segurança — melhor não ter chave do que ter uma que casa errado
  if (national.length < 10) return null;

  return national.slice(0, 2) + national.slice(-8);
};

/**
 * Número para a Cloud API: DDI + DDD + assinante, com o nono dígito no celular. Cadastro antigo
 * guarda o celular com 8 dígitos (`(43) 9918-2844`); assinante começando em 6–9 é celular, e é
 * com o 9 que ele existe hoje. Fixo (2–5) passa como está; o resto não é número brasileiro válido.
 */
export const toOfficialPhone = (value: string | null | undefined): string | null => {
  const number = toWaNumber(value);
  if (!number || !/^55[1-9]\d(?:[2-9]\d{7}|9\d{8})$/.test(number)) return null;
  return number.length === 12 && /^[6-9]$/.test(number[4]!) ? `${number.slice(0, 4)}9${number.slice(4)}` : number;
};

/**
 * As duas grafias do mesmo celular, com e sem o nono dígito. O wa_id que a Meta devolve costuma
 * vir sem o 9 (`554391834229`), enquanto a campanha grava com (`5543991834229`); sem casar as duas,
 * a resposta do lead abriria um contato novo em vez de cair no da campanha.
 */
export const officialPhoneVariants = (value: string): string[] => {
  // Só o inverso exato da inserção: celular 9[1-5] não tem grafia antiga e casaria com um fixo.
  if (/^55[1-9]\d9[6-9]\d{7}$/.test(value)) return [value, value.slice(0, 4) + value.slice(5)];
  if (/^55[1-9]\d[6-9]\d{7}$/.test(value)) return [value, `${value.slice(0, 4)}9${value.slice(4)}`];
  return [value];
};
