"use client";

import { useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { VerifyNotice } from "./verify-notice";

export const SignUpForm = () => {
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [created, setCreated] = useState(false);

  const handleSignUp = async () => {
    setLoading(true);
    const res = await authClient.signUp.email({
      name,
      email,
      password,
      callbackURL: `${window.location.origin}/verify-email`,
    });
    setLoading(false);
    if (res.error) {
      toast.error(res.error.message ?? "Não foi possível criar a conta");
      return;
    }
    // com verificação obrigatória o cadastro não abre sessão: a resposta é a mesma para e-mail novo
    // ou já cadastrado, e quem manda o usuário adiante é o link que chega na caixa de entrada
    setCreated(true);
  };

  if (created) return <VerifyNotice email={email} onBack={() => setCreated(false)} />;

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="name">Nome</Label>
        <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="email-up">E-mail</Label>
        <Input
          id="email-up"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password-up">Senha</Label>
        <Input
          id="password-up"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">Mínimo de 8 caracteres.</p>
      </div>
      <Button className="w-full" onClick={handleSignUp} disabled={loading}>
        {loading ? "Criando…" : "Criar conta"}
      </Button>
    </div>
  );
};
