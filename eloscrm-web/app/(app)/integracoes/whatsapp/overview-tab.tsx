"use client";

import { useState } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Check, Pencil, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useRenameWhatsapp } from "@/lib/queries/whatsapp";
import type { WhatsappInstance } from "@/lib/types";
import { toast } from "sonner";
import { jidToPhone, statusLabels } from "./labels";

const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="flex flex-wrap items-baseline justify-between gap-2 border-b py-2.5 last:border-0">
    <span className="text-muted-foreground text-sm">{label}</span>
    <span className="text-sm font-medium">{value ?? "—"}</span>
  </div>
);

const date = (value: string | null) =>
  value ? format(parseISO(value), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR }) : null;

const RenameField = ({ instance }: { instance: WhatsappInstance }) => {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(instance.name);
  const rename = useRenameWhatsapp();

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === instance.name) {
      setEditing(false);
      return;
    }
    rename.mutate(
      { name: trimmed },
      {
        onSuccess: () => {
          toast.success("Nome atualizado");
          setEditing(false);
        },
        onError: (err: { message?: string }) => toast.error(err.message ?? "Não foi possível renomear"),
      },
    );
  };

  if (!editing) {
    return (
      <span className="flex items-center gap-1.5 text-sm font-medium">
        {instance.name}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Renomear instância"
          onClick={() => {
            setName(instance.name);
            setEditing(true);
          }}
        >
          <Pencil className="size-3.5" />
        </Button>
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
        className="h-8 w-44"
        autoFocus
        disabled={rename.isPending}
      />
      <Button variant="ghost" size="icon-sm" aria-label="Salvar" onClick={save} disabled={rename.isPending}>
        <Check className="size-4" />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Cancelar" onClick={() => setEditing(false)}>
        <X className="size-4" />
      </Button>
    </span>
  );
};

type Props = { instance: WhatsappInstance; canManage: boolean };

export const OverviewTab = ({ instance, canManage }: Props) => (
  <Card>
    <CardHeader>
      <CardTitle>Visão geral</CardTitle>
      <CardDescription>Dados da conexão desta imobiliária.</CardDescription>
    </CardHeader>
    <CardContent>
      <Row
        label="Nome da instância"
        value={canManage ? <RenameField instance={instance} /> : instance.name}
      />
      <Row label="Status" value={<Badge variant="outline">{statusLabels[instance.status]}</Badge>} />
      <Row label="Número" value={jidToPhone(instance.ownerJid)} />
      <Row label="Perfil no WhatsApp" value={instance.profileName} />
      <Row label="Conta comercial" value={instance.isBusiness === null ? null : instance.isBusiness ? "Sim" : "Não"} />
      <Row label="Aparelho" value={instance.plataform} />
      <Row label="Conectado em" value={date(instance.createdAt)} />
      <Row label="Última mudança de estado" value={date(instance.lastStatusAt)} />
      {instance.lastDisconnectAt && (
        <Row
          label="Última desconexão"
          value={
            <span className="text-right">
              {date(instance.lastDisconnectAt)}
              {instance.lastDisconnectReason && (
                <span className="text-muted-foreground block text-xs font-normal">
                  {instance.lastDisconnectReason}
                </span>
              )}
            </span>
          }
        />
      )}
      {/* últimos 4 dígitos só: identifica a instância no painel da uazapi sem expor o token */}
      <Row
        label="Token"
        value={instance.tokenLast4 ? <code className="text-xs">••••{instance.tokenLast4}</code> : null}
      />
    </CardContent>
  </Card>
);
