"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useCreateClient, useUpdateClient } from "@/lib/queries/clients";
import { clientSourceLabels } from "@/lib/labels";
import type { Client, ClientSource } from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const ClientDialog = ({ client, trigger }: { client?: Client; trigger: React.ReactNode }) => {
  const editing = !!client;
  const create = useCreateClient();
  const update = useUpdateClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(client?.name ?? "");
  const [email, setEmail] = useState(client?.email ?? "");
  const [phone, setPhone] = useState(client?.phone ?? "");
  const [source, setSource] = useState<ClientSource>(client?.source ?? "OUTROS");
  const [notes, setNotes] = useState(client?.notes ?? "");

  const saving = create.isPending || update.isPending;

  const submit = async () => {
    if (!name.trim()) return;
    const input = {
      name: name.trim(),
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      source,
      notes: notes.trim() || undefined,
    };
    try {
      if (editing) await update.mutateAsync({ id: client.id, input });
      else await create.mutateAsync(input);
      toast.success(editing ? "Cliente atualizado" : "Cliente criado");
      setOpen(false);
    } catch {
      toast.error("Não foi possível salvar o cliente");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger as React.ReactElement<Record<string, unknown>>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Editar cliente" : "Novo cliente"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="name">Nome</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Telefone</Label>
              <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Origem</Label>
            <Select value={source} onValueChange={(v) => setSource(v as ClientSource)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(clientSourceLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="notes">Observações</Label>
            <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={saving || !name.trim()}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
