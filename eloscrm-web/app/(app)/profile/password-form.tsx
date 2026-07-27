"use client";

import { useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// mesmo mínimo que o Better Auth aplica no servidor (emailAndPassword.minPasswordLength, default 8):
// validar aqui evita o round-trip que voltaria como erro genérico, sem apontar o campo
const MIN_PASSWORD = 8;

export const PasswordForm = () => {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [revokeOtherSessions, setRevokeOtherSessions] = useState(true);
  const [saving, setSaving] = useState(false);

  const tooShort = !!newPassword && newPassword.length < MIN_PASSWORD;
  const mismatch = !!confirmation && confirmation !== newPassword;
  const canSave =
    !!currentPassword && newPassword.length >= MIN_PASSWORD && confirmation === newPassword;

  const submit = async () => {
    setSaving(true);
    const res = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions,
    });
    setSaving(false);
    if (res.error) {
      toast.error(
        res.error.code === "INVALID_PASSWORD"
          ? "A senha atual está incorreta"
          : "Não foi possível alterar a senha",
      );
      return;
    }
    setCurrentPassword("");
    setNewPassword("");
    setConfirmation("");
    toast.success("Senha alterada");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Senha</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="max-w-md space-y-1.5">
          <Label htmlFor="current-password">Senha atual</Label>
          <Input
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </div>
        <div className="max-w-md space-y-1.5">
          <Label htmlFor="new-password">Nova senha</Label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <p className={tooShort ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
            Pelo menos {MIN_PASSWORD} caracteres.
          </p>
        </div>
        <div className="max-w-md space-y-1.5">
          <Label htmlFor="confirm-password">Confirmar nova senha</Label>
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
          />
          {mismatch && <p className="text-xs text-destructive">As senhas não conferem.</p>}
        </div>
        <Label className="flex max-w-md items-center gap-2 font-normal">
          <Checkbox
            checked={revokeOtherSessions}
            onCheckedChange={(checked) => setRevokeOtherSessions(!!checked)}
          />
          Desconectar os outros dispositivos
        </Label>
        <Button onClick={submit} disabled={saving || !canSave}>
          {saving ? "Alterando…" : "Alterar senha"}
        </Button>
      </CardContent>
    </Card>
  );
};
