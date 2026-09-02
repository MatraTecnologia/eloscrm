"use client";

import { useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { ApiError } from "@/lib/api";
import { useConnectMeta } from "@/lib/queries/meta";
import type { MetaTokenType } from "@/lib/types";

const tokenTypeLabels: Record<MetaTokenType, { title: string; hint: string }> = {
  user: {
    title: "Token de usuário",
    hint: "Gerado no Explorador da Graph API com a sua conta. Expira em até 60 dias.",
  },
  system_user: {
    title: "Token de usuário do sistema",
    hint: "Gerado no Gerenciador de Negócios para um usuário do sistema. Não expira.",
  },
};

/** Formulário de conexão. Também serve para trocar o token de uma integração já conectada. */
export const ConnectCard = ({
  replacing = false,
  onDone,
}: {
  replacing?: boolean;
  onDone?: () => void;
}) => {
  const [token, setToken] = useState("");
  const [tokenType, setTokenType] = useState<MetaTokenType>("system_user");
  const connect = useConnectMeta();

  const submit = () =>
    connect.mutate(
      { token: token.trim(), tokenType },
      {
        onSuccess: (integration) => {
          toast.success(
            `Conectado como ${integration.metaUserName}: ${integration.forms.length} formulário(s) encontrado(s)`,
          );
          setToken("");
          onDone?.();
        },
        onError: (err) => toast.error((err as unknown as ApiError).message ?? "Não foi possível conectar"),
      },
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{replacing ? "Trocar o token" : "Conectar conta do Meta"}</CardTitle>
        <CardDescription>
          O token precisa das permissões <span className="font-mono">leads_retrieval</span>,{" "}
          <span className="font-mono">pages_show_list</span> e{" "}
          <span className="font-mono">pages_manage_ads</span>, e acesso à página que roda os anúncios.
          Ele fica cifrado e nunca é exibido de novo.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <RadioGroup value={tokenType} onValueChange={(v) => setTokenType(v as MetaTokenType)}>
          {(Object.keys(tokenTypeLabels) as MetaTokenType[]).map((type) => (
            <Label key={type} className="flex items-start gap-3 rounded-md border p-3 font-normal">
              <RadioGroupItem value={type} className="mt-0.5" />
              <span>
                <span className="block text-sm font-medium">{tokenTypeLabels[type].title}</span>
                <span className="text-muted-foreground block text-sm">{tokenTypeLabels[type].hint}</span>
              </span>
            </Label>
          ))}
        </RadioGroup>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="meta-token">Token de acesso</Label>
          <Input
            id="meta-token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="EAAB…"
            autoComplete="off"
          />
        </div>

        <div className="flex justify-end">
          <Button onClick={submit} disabled={token.trim().length < 20 || connect.isPending}>
            {connect.isPending ? <Loader2 className="size-4 animate-spin" /> : <KeyRound />}
            {replacing ? "Salvar novo token" : "Conectar"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
