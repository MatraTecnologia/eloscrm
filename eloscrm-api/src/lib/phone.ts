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
