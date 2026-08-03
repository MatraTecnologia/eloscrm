"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "../auth-shell";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    setLoading(true);
    const res = await authClient.requestPasswordReset({
      email,
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (res.error) {
      toast.error("Não foi possível enviar agora. Tente em alguns minutos.");
      return;
    }
    // a API responde igual para e-mail cadastrado ou não; a tela repete isso e não confirma nada
    setSent(true);
  };

  return (
    <AuthShell title="Recuperar acesso">
      {sent ? (
        <div className="space-y-4 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <MailCheck className="size-6" />
          </div>
          <div className="space-y-1.5">
            <p className="font-medium">Confira sua caixa de entrada</p>
            <p className="text-sm text-muted-foreground">
              Se existir uma conta para <span className="font-medium text-foreground">{email}</span>, o link para criar
              uma nova senha já está a caminho. Ele vale por 1 hora.
            </p>
          </div>
          <Button
            variant="outline"
            className="w-full"
            nativeButton={false}
            render={<Link href="/login">Voltar para o login</Link>}
          />
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Informe o e-mail da sua conta e enviamos um link para criar uma nova senha.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <Button className="w-full" onClick={submit} disabled={loading || !email.trim()}>
            {loading ? "Enviando…" : "Enviar link"}
          </Button>
          <Button
            variant="ghost"
            className="w-full"
            nativeButton={false}
            render={
              <Link href="/login">
                <ArrowLeft className="size-4" /> Voltar
              </Link>
            }
          />
        </div>
      )}
    </AuthShell>
  );
}
