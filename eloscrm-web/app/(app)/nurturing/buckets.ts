import { endOfMonth, endOfWeek, isBefore } from "date-fns";
import type { Client } from "@/lib/types";

export type BucketKey = "OVERDUE" | "WEEK" | "MONTH" | "LATER" | "UNDATED" | "ALL";

export const BUCKETS: { key: BucketKey; label: string }[] = [
  { key: "OVERDUE", label: "Atrasados" },
  { key: "WEEK", label: "Esta semana" },
  { key: "MONTH", label: "Este mês" },
  { key: "LATER", label: "Depois" },
  { key: "UNDATED", label: "Sem data" },
  { key: "ALL", label: "Todos" },
];

// avaliados nesta ordem e mutuamente exclusivos: um lead vencido cai em Atrasados e em mais lugar
// nenhum, mesmo que a data seja desta semana
export const bucketOf = (client: Client, now: Date): Exclude<BucketKey, "ALL"> => {
  if (!client.nurtureUntil) return "UNDATED";
  const until = new Date(client.nurtureUntil);
  if (isBefore(until, now)) return "OVERDUE";
  // weekStartsOn 1: a semana do CRM começa na segunda, como no resto do app
  if (isBefore(until, endOfWeek(now, { weekStartsOn: 1 }))) return "WEEK";
  if (isBefore(until, endOfMonth(now))) return "MONTH";
  return "LATER";
};
