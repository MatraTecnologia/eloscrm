"use client";

import { useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { ClientAvatar } from "@/app/(app)/clients/client-avatar";
import { NurtureDialog } from "@/components/app/nurture-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatPhone } from "@/lib/labels";
import { useClients } from "@/lib/queries/clients";
import type { Client } from "@/lib/types";

export const LinkClientDialog = ({ trigger }: { trigger: ReactNode }) => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Client | null>(null);
  const { data: clients, isLoading } = useClients({ status: "ACTIVE", q });

  const pick = (client: Client) => {
    setSelected(client);
    setOpen(false);
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (next) setQ("");
          setOpen(next);
        }}
      >
        <DialogTrigger render={trigger as React.ReactElement<Record<string, unknown>>} />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Trazer lead existente</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome, e-mail ou telefone"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="max-h-80 space-y-1 overflow-y-auto">
              {isLoading && <p className="py-6 text-center text-sm text-muted-foreground">Carregando…</p>}
              {!isLoading && clients?.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">Nenhum lead ativo encontrado.</p>
              )}
              {clients?.map((client) => (
                <button
                  key={client.id}
                  type="button"
                  onClick={() => pick(client)}
                  className="flex w-full items-center gap-2.5 rounded-md p-2 text-left text-sm hover:bg-muted"
                >
                  <ClientAvatar id={client.id} name={client.name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{client.name}</span>
                    {client.phone && (
                      <span className="block truncate text-xs text-muted-foreground">{formatPhone(client.phone)}</span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {selected && (
        <NurtureDialog
          client={selected}
          open
          onOpenChange={(next) => {
            if (!next) setSelected(null);
          }}
          onDone={() => setSelected(null)}
        />
      )}
    </>
  );
};
