"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CircleX } from "lucide-react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "../auth-shell";

const MIN_LENGTH = 8;

const InvalidToken = () => (
  <div className="space-y-4 text-center">
    <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
      <CircleX className="size-6" />
    </div>
    <div className="space-y-1.5">
      <p className="font-medium">Link inválido ou expirado</p>
      <p className="text-sm text-muted-foreground">
        O link de redefinição vale por 1 hora e só pode ser usado uma vez. Peça um novo para continuar.
      </p>
    </div>
    <Button className="w-full" nativeButton={false} render={<Link href="/forgot-password">Pedir novo link</Link>} />
  </div>
);

const ResetForm = () => {
  const router = useRouter();
  const params = useSearchParams();
  // a API redireciona para cá com ?token=… quando o token vale, e com ?error=… quando não vale
  const token = params.get("error") ? null : params.get("token");

  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(false);

  if (!token) return <InvalidToken />;

  const tooShort = password.length > 0 && password.length < MIN_LENGTH;
  const mismatch = confirmation.length > 0 && password !== confirmation;

  const submit = async () => {
    setLoading(true);
    const res = await authClient.resetPassword({ newPassword: password, token });
    setLoading(false);
    if (res.error) {
      toast.error(res.error.message ?? "Não foi possível redefinir a senha");
      return;
    }
    toast.success("Senha redefinida. Entre com a nova senha.");
    router.replace("/login");
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Escolha uma nova senha. Ao confirmar, as outras sessões abertas são encerradas.
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="password">Nova senha</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">Mínimo de {MIN_LENGTH} caracteres.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirmation">Repita a nova senha</Label>
        <Input
          id="confirmation"
          type="password"
          autoComplete="new-password"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          aria-invalid={mismatch}
        />
        {mismatch && <p className="text-xs text-destructive">As senhas não coincidem.</p>}
      </div>
      <Button
        className="w-full"
        onClick={submit}
        disabled={loading || tooShort || mismatch || password.length < MIN_LENGTH || !confirmation}
      >
        {loading ? "Salvando…" : "Salvar nova senha"}
      </Button>
    </div>
  );
};

export default function ResetPasswordPage() {
  return (
    <AuthShell title="Nova senha">
      {/* useSearchParams empurra a árvore para client-side rendering: sem o boundary o build falha */}
      <Suspense fallback={<div className="h-56" />}>
        <ResetForm />
      </Suspense>
    </AuthShell>
  );
}
