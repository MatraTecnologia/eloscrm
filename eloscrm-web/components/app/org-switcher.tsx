"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { toast } from "sonner";
import { authClient, useActiveOrganization, useListOrganizations } from "@/lib/auth-client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const slugify = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

export const OrgSwitcher = () => {
  const qc = useQueryClient();
  const { data: orgs } = useListOrganizations();
  const { data: active } = useActiveOrganization();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const setActive = async (organizationId: string) => {
    await authClient.organization.setActive({ organizationId });
    await qc.invalidateQueries();
  };

  const create = async () => {
    if (!name.trim()) return;
    setSaving(true);
    const res = await authClient.organization.create({ name: name.trim(), slug: slugify(name) });
    setSaving(false);
    if (res.error) {
      toast.error("Não foi possível criar a imobiliária");
      return;
    }
    setName("");
    setOpen(false);
    if (res.data?.id) await setActive(res.data.id);
    toast.success("Imobiliária criada");
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              className="w-full justify-between text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            />
          }
        >
          <span className="truncate">{active?.name ?? "Selecione uma imobiliária"}</span>
          <ChevronsUpDown className="size-4 opacity-60" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {orgs?.map((org) => (
            <DropdownMenuItem key={org.id} onSelect={() => setActive(org.id)}>
              <span className="truncate">{org.name}</span>
              {active?.id === org.id && <Check className="ml-auto size-4" />}
            </DropdownMenuItem>
          ))}
          {orgs && orgs.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem onSelect={() => setTimeout(() => setOpen(true), 0)}>
            <Plus className="size-4" /> Criar imobiliária
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova imobiliária</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="org-name">Nome</Label>
          <Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Imobiliária Central" />
        </div>
          <DialogFooter>
            <Button onClick={create} disabled={saving || !name.trim()}>
              {saving ? "Criando..." : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
