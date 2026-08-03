"use client";

import { useState } from "react";
import { MailCheck } from "lucide-react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

type Props = { email: string; onBack: () => void };

/** Estado de espera: a conta existe, mas o login só abre depois da confirmação do e-mail. */
export const VerifyNotice = ({ email, onBack }: Props) => {
  const [sending, setSending] = useState(false);

  const resend = async () => {
    setSending(true);
    const res = await authClient.sendVerificationEmail({
      email,
      callbackURL: `${window.location.origin}/verify-email`,
    });
    setSending(false);
    if (res.error) {
      toast.error("Não foi possível reenviar agora. Tente em alguns minutos.");
      return;
    }
    toast.success("E-mail de confirmação reenviado");
  };

  return (
    <div className="space-y-4 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <MailCheck className="size-6" />
      </div>
      <div className="space-y-1.5">
        <p className="font-medium">Confirme seu e-mail</p>
        <p className="text-sm text-muted-foreground">
          Enviamos um link de confirmação para <span className="font-medium text-foreground">{email}</span>. Abra o
          link para liberar o acesso.
        </p>
      </div>
      <div className="space-y-2">
        <Button variant="outline" className="w-full" onClick={resend} disabled={sending}>
          {sending ? "Reenviando…" : "Reenviar e-mail"}
        </Button>
        <Button variant="ghost" className="w-full" onClick={onBack}>
          Voltar
        </Button>
      </div>
    </div>
  );
};
