import type { MetaFieldDatum } from "../../lib/meta/index.js";

// nomes que o Meta usa nos campos padrão do formulário; campo personalizado vem com o nome que o
// anunciante deu, e cai em `extras`
const NAME_KEYS = ["full_name", "name", "nome", "nome_completo"];
const FIRST_KEYS = ["first_name", "primeiro_nome"];
const LAST_KEYS = ["last_name", "sobrenome"];
const EMAIL_KEYS = ["email", "e-mail", "work_email"];
const PHONE_KEYS = ["phone_number", "phone", "telefone", "celular", "whatsapp", "work_phone_number"];

const pick = (fields: MetaFieldDatum[], keys: string[]) =>
  fields.find((f) => keys.includes(f.name.toLowerCase()))?.values?.[0]?.trim() || null;

/**
 * Lê as respostas do formulário na forma que o lead do CRM entende.
 *
 * O telefone chega como veio do Meta (normalmente `+5543999140409`); quem formata é `formatBrPhone`,
 * na ingestão. O que não é nome, e-mail nem telefone vira `extras`, na ordem do formulário — é o
 * que vai para a descrição do lead, porque a pergunta personalizada ("qual bairro?") é justamente
 * o que o corretor quer ler antes de ligar.
 */
export const parseLeadFields = (fields: MetaFieldDatum[] | undefined) => {
  const list = fields ?? [];
  const first = pick(list, FIRST_KEYS);
  const last = pick(list, LAST_KEYS);
  const name = pick(list, NAME_KEYS) ?? [first, last].filter(Boolean).join(" ").trim();

  const known = new Set([...NAME_KEYS, ...FIRST_KEYS, ...LAST_KEYS, ...EMAIL_KEYS, ...PHONE_KEYS]);
  const extras = list
    .filter((f) => !known.has(f.name.toLowerCase()) && f.values?.some((v) => v?.trim()))
    .map((f) => ({ name: f.name, value: f.values.filter((v) => v?.trim()).join(", ") }));

  return {
    name: name || null,
    email: pick(list, EMAIL_KEYS),
    phone: pick(list, PHONE_KEYS),
    extras,
  };
};

export const extrasToDescription = (extras: { name: string; value: string }[]) =>
  extras.length === 0 ? null : extras.map((e) => `${e.name}: ${e.value}`).join("\n");
