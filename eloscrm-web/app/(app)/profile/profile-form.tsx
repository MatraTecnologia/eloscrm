"use client";

import { useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const ProfileForm = ({
  user,
  onSaved,
}: {
  user: { name: string; email: string };
  onSaved: () => void;
}) => {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [saving, setSaving] = useState(false);

  const nameChanged = name.trim() !== user.name;
  const emailChanged = email.trim().toLowerCase() !== user.email.toLowerCase();
  const canSave = !!name.trim() && !!email.trim() && (nameChanged || emailChanged);

  const submit = async () => {
    setSaving(true);
    // nome e e-mail vivem em endpoints diferentes do Better Auth; só chama o que mudou
    if (nameChanged) {
      const res = await authClient.updateUser({ name: name.trim() });
      if (res.error) {
        setSaving(false);
        toast.error("Não foi possível salvar o nome");
        return;
      }
    }
    if (emailChanged) {
      const res = await authClient.changeEmail({ newEmail: email.trim() });
      if (res.error) {
        setSaving(false);
        toast.error(
          res.error.code === "USER_ALREADY_EXISTS" || res.error.status === 422
            ? "Já existe uma conta com esse e-mail"
            : "Não foi possível alterar o e-mail",
        );
        return;
      }
    }
    setSaving(false);
    onSaved();
    toast.success("Dados atualizados");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dados pessoais</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="max-w-md space-y-1.5">
          <Label htmlFor="profile-name">Nome</Label>
          <Input
            id="profile-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Seu nome completo"
          />
        </div>
        <div className="max-w-md space-y-1.5">
          <Label htmlFor="profile-email">E-mail</Label>
          <Input
            id="profile-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="voce@imobiliaria.com"
          />
          <p className="text-xs text-muted-foreground">
            É com este e-mail que você entra no elosCRM.
          </p>
        </div>
        <Button onClick={submit} disabled={saving || !canSave}>
          {saving ? "Salvando…" : "Salvar alterações"}
        </Button>
      </CardContent>
    </Card>
  );
};
