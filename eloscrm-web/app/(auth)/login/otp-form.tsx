"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

type Props = { next: string; initialEmail: string; onBack: () => void };

/** Login sem senha: código de 6 dígitos por e-mail, válido por 10 minutos. */
export const OtpForm = ({ next, initialEmail, onBack }: Props) => {
  const router = useRouter();
  const [email, setEmail] = useState(initialEmail);
  const [otp, setOtp] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const requestCode = async () => {
    setLoading(true);
    const res = await authClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" });
    setLoading(false);
    if (res.error) {
      toast.error("Não foi possível enviar o código. Confira o e-mail digitado.");
      return;
    }
    setSent(true);
    toast.success("Código enviado");
  };

  const confirm = async (code: string) => {
    setLoading(true);
    const res = await authClient.signIn.emailOtp({ email, otp: code });
    setLoading(false);
    if (res.error) {
      setOtp("");
      toast.error("Código inválido ou expirado");
      return;
    }
    router.replace(next);
  };

  return (
    <div className="space-y-3">
      {sent ? (
        <div className="space-y-3">
          <div className="space-y-1.5 text-center">
            <p className="text-sm text-muted-foreground">
              Enviamos um código de 6 dígitos para <span className="font-medium text-foreground">{email}</span>.
            </p>
          </div>
          <div className="flex justify-center">
            {/* o envio dispara sozinho no sexto dígito: digitar e ainda ter que clicar é atrito à toa */}
            <InputOTP maxLength={6} value={otp} onChange={setOtp} onComplete={confirm} disabled={loading}>
              <InputOTPGroup>
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <InputOTPSlot key={i} index={i} className="size-11 text-base" />
                ))}
              </InputOTPGroup>
            </InputOTP>
          </div>
          <Button variant="ghost" className="w-full" onClick={requestCode} disabled={loading}>
            Reenviar código
          </Button>
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="email-otp">E-mail</Label>
            <Input
              id="email-otp"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <Button className="w-full" onClick={requestCode} disabled={loading || !email.trim()}>
            {loading ? "Enviando…" : "Enviar código"}
          </Button>
        </>
      )}
      <Button variant="ghost" className="w-full" onClick={onBack}>
        <ArrowLeft className="size-4" /> Entrar com senha
      </Button>
    </div>
  );
};
