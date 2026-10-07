"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Building2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { authClient, useActiveOrganization, useListOrganizations } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const WorkspaceGate = ({ children }: { children: React.ReactNode }) => {
  const queryClient = useQueryClient();
  const organizations = useListOrganizations();
  const activeOrganization = useActiveOrganization();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const selectOrganization = async (organizationId: string) => {
    setSaving(true);
    try {
      const result = await authClient.organization.setActive({ organizationId });
      if (result.error) {
        toast.error("Não foi possível selecionar a imobiliária. Tente novamente.");
        return;
      }
      await activeOrganization.refetch();
      await queryClient.invalidateQueries();
    } catch {
      toast.error("Não foi possível selecionar a imobiliária. Tente novamente.");
    } finally {
      setSaving(false);
    }
  };

  const createOrganization = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || saving) return;
    const slug = trimmedName
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    if (!slug) {
      toast.error("Informe um nome com letras ou números.");
      return;
    }

    setSaving(true);
    try {
      const result = await authClient.organization.create({
        name: trimmedName,
        slug,
        keepCurrentActiveOrganization: true,
      });
      if (result.error || !result.data) {
        toast.error("Não foi possível criar a imobiliária. Verifique o nome e tente novamente.");
        return;
      }
      await organizations.refetch();
      const activation = await authClient.organization.setActive({ organizationId: result.data.id });
      if (activation.error) {
        toast.error("Imobiliária criada. Selecione-a para continuar.");
        return;
      }
      await activeOrganization.refetch();
      await queryClient.invalidateQueries();
      toast.success("Imobiliária criada");
    } catch {
      toast.error("Não foi possível concluir a criação. Tente novamente.");
    } finally {
      setSaving(false);
    }
  };

  const hasActiveOrganization = activeOrganization.data && organizations.data?.some(
    (organization) => organization.id === activeOrganization.data?.id,
  );

  if (hasActiveOrganization && !saving) return children;

  if (organizations.isPending || activeOrganization.isPending) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Carregando imobiliárias…</div>;
  }

  const hasOrganizations = !!organizations.data?.length;
  // Uma seleção antiga ou um vínculo removido não impede escolher outra imobiliária válida.
  const activeOrganizationUnavailable = activeOrganization.error?.status === 403 || activeOrganization.error?.status === 404;
  const hasError = organizations.error || (activeOrganization.error && !hasOrganizations && !activeOrganizationUnavailable);

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <section className="w-full max-w-md space-y-6" aria-labelledby="workspace-title">
        <div className="space-y-2">
          {hasError ? <TriangleAlert className="size-8 text-muted-foreground" /> : <Building2 className="size-8 text-muted-foreground" />}
          <h1 id="workspace-title" className="text-2xl font-semibold">
            {hasError ? "Não foi possível carregar suas imobiliárias" : hasOrganizations ? "Selecione uma imobiliária" : "Crie sua imobiliária"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {hasError
              ? "Tente novamente para continuar."
              : hasOrganizations
                ? "Escolha o workspace que deseja acessar para continuar."
                : "Você ainda não faz parte de uma imobiliária. Crie um workspace para começar."}
          </p>
        </div>
        {hasError ? (
          <Button variant="outline" onClick={() => Promise.all([organizations.refetch(), activeOrganization.refetch()])}>
            Tentar novamente
          </Button>
        ) : hasOrganizations ? (
          <div className="space-y-2">
            {organizations.data?.map((organization) => (
              <Button
                key={organization.id}
                variant="outline"
                className="w-full justify-start"
                disabled={saving}
                onClick={() => selectOrganization(organization.id)}
              >
                <Building2 className="size-4 shrink-0" />
                <span className="truncate">{organization.name}</span>
              </Button>
            ))}
            {saving && <p role="status" className="text-sm text-muted-foreground">Abrindo imobiliária…</p>}
          </div>
        ) : (
          <form onSubmit={createOrganization} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="workspace-name">Nome da imobiliária</Label>
              <Input
                id="workspace-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Imobiliária Central"
                disabled={saving}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={saving || !name.trim()}>
              {saving ? "Criando…" : "Criar imobiliária"}
            </Button>
          </form>
        )}
        <Button variant="ghost" disabled={saving} onClick={() => authClient.signOut()}>
          Sair da conta
        </Button>
      </section>
    </main>
  );
};
