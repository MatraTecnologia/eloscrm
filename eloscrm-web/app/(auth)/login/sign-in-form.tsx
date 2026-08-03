"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OtpForm } from "./otp-form";
import { VerifyNotice } from "./verify-notice";

type Props = { next: string };

export const SignInForm = ({ next }: Props) => {
  const router = useRouter();
  const [mode, setMode] = useState<"password" | "otp">("password");
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [unverified, setUnverified] = useState(false);

  const handleSignIn = async () => {
    setLoading(true);
    const res = await authClient.signIn.email({ email, password });
    setLoading(false);
    if (res.error) {
      // 403 é o e-mail não confirmado. A API não reenvia nada aqui — quem oferece o reenvio é o
      // VerifyNotice, para não transformar tentativa de login em disparo automático de e-mail.
      if (res.error.status === 403) {
        setUnverified(true);
        return;
      }
      toast.error("E-mail ou senha inválidos");
      return;
    }
    router.replace(next);
  };

  if (unverified) return <VerifyNotice email={email} onBack={() => setUnverified(false)} />;

  if (mode === "otp") {
    return <OtpForm next={next} initialEmail={email} onBack={() => setMode("password")} />;
  }

  return (
    <div className="space-y-3">
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
      <div className="space-y-1.5">
        <Label htmlFor="password">Senha</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <Button className="w-full" onClick={handleSignIn} disabled={loading}>
        {loading ? "Entrando…" : "Entrar"}
      </Button>
      <div className="flex items-center justify-between text-sm">
        <Link href="/forgot-password" className="text-muted-foreground underline-offset-4 hover:underline">
          Esqueci minha senha
        </Link>
        <button
          type="button"
          onClick={() => setMode("otp")}
          className="text-primary underline-offset-4 hover:underline"
        >
          Entrar com código
        </button>
      </div>
    </div>
  );
};
