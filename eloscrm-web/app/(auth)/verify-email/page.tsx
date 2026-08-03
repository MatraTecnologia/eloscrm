"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CircleCheck, CircleX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AuthShell } from "../auth-shell";

/** Destino do link de confirmação. O Better Auth já validou o token e criou a sessão antes de cair aqui. */
const Outcome = () => {
  const failed = !!useSearchParams().get("error");

  if (failed) {
    return (
      <div className="space-y-4 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <CircleX className="size-6" />
        </div>
        <div className="space-y-1.5">
          <p className="font-medium">Link inválido ou expirado</p>
          <p className="text-sm text-muted-foreground">
            O link de confirmação vale por 1 hora e só pode ser usado uma vez. Tente entrar de novo para receber um
            link novo.
          </p>
        </div>
        <Button className="w-full" nativeButton={false} render={<Link href="/login">Voltar para o login</Link>} />
      </div>
    );
  }

  return (
    <div className="space-y-4 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-success/10 text-success">
        <CircleCheck className="size-6" />
      </div>
      <div className="space-y-1.5">
        <p className="font-medium">E-mail confirmado</p>
        <p className="text-sm text-muted-foreground">Sua conta está liberada. Bom trabalho.</p>
      </div>
      <Button className="w-full" nativeButton={false} render={<Link href="/dashboard">Ir para o painel</Link>} />
    </div>
  );
};

export default function VerifyEmailPage() {
  return (
    <AuthShell>
      <Suspense fallback={<div className="h-48" />}>
        <Outcome />
      </Suspense>
    </AuthShell>
  );
}
