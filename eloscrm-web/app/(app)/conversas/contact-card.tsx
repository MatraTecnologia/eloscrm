"use client";

import { MessageCircle, UserRound } from "lucide-react";
import { formatPhone, phoneNationalDigits } from "@/lib/labels";
import { cn } from "@/lib/utils";
import type { SharedContact } from "@/lib/types";

const iniciais = (nome: string) =>
  nome
    .split(/\s+/)
    .slice(0, 2)
    .map((parte) => parte[0] ?? "")
    .join("")
    .toUpperCase();

/**
 * Cartão de contato compartilhado.
 *
 * Antes disto a bolha mostrava o vCard resumido pelo provedor — `Ryan Varela / X-Wa-Biz-Name: Ryan /
 * Phone: +55 43 …`, cabeçalho de protocolo e tudo. O que o corretor faz com um contato indicado é
 * ligar ou chamar no WhatsApp, então é isso que o cartão oferece: nome, telefone legível e o atalho
 * para abrir a conversa no número.
 */
export const ContactCard = ({
  contacts,
  mine,
}: {
  contacts: SharedContact[];
  mine: boolean;
}) => (
  <div className="flex w-64 flex-col gap-2 sm:w-72">
    {contacts.map((contato, indice) => {
      const telefone = contato.phones[0] ?? null;
      const nacional = phoneNationalDigits(telefone);

      return (
        <div
          key={`${contato.name}-${indice}`}
          className={cn(
            "flex flex-col gap-2 rounded-md p-2",
            mine ? "bg-primary-foreground/15" : "bg-background/60",
          )}
        >
          <div className="flex items-center gap-2">
            <span className="bg-current/10 flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-medium">
              {iniciais(contato.name) || <UserRound className="size-4" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{contato.name}</span>
              {/* o nome comercial só aparece quando diz algo além do nome já mostrado */}
              {contato.business && contato.business !== contato.name && (
                <span className="block truncate text-xs opacity-70">{contato.business}</span>
              )}
            </span>
          </div>

          {contato.phones.length > 0 && (
            <div className="flex flex-col gap-0.5">
              {contato.phones.map((phone) => (
                <span key={phone} className="text-xs opacity-80">
                  {formatPhone(phone)}
                </span>
              ))}
            </div>
          )}

          {nacional && (
            <a
              href={`https://wa.me/55${nacional}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-1.5 rounded border border-current/20 py-1 text-xs font-medium hover:bg-current/10"
            >
              <MessageCircle className="size-3.5" />
              Conversar
            </a>
          )}
        </div>
      );
    })}
  </div>
);
