"use client";

import { useClients } from "@/lib/queries/clients";
import { useMembers } from "@/lib/queries/members";
import { useProperties } from "@/lib/queries/properties";

/**
 * O `changes` da auditoria guarda id em ownerId/propertyId/clientId. Sem esta tradução o histórico
 * e a linha do tempo mostram cuid na tela. As três listas já vêm do cache do TanStack Query nas
 * telas que usam os painéis, então isto não é uma requisição por feed.
 */
export const useEntityNames = () => {
  const { data: members } = useMembers();
  const { data: properties } = useProperties();
  const { data: clients } = useClients({ status: "ALL" });

  const names = new Map<string, string>();
  for (const member of members ?? []) names.set(member.userId, member.name);
  for (const property of properties ?? []) names.set(property.id, property.title);
  for (const client of clients ?? []) names.set(client.id, client.name);

  return (id: string) => names.get(id);
};
