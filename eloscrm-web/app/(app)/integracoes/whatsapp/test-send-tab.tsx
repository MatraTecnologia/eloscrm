"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useTestSendWhatsapp } from "@/lib/queries/whatsapp";
import type { WhatsappInstance } from "@/lib/types";
import { toast } from "sonner";

const MAX = 1000;

export const TestSendTab = ({ instance }: { instance: WhatsappInstance }) => {
  const [number, setNumber] = useState("");
  const [text, setText] = useState("Mensagem de teste enviada pelo elosCRM.");
  const send = useTestSendWhatsapp();

  const digits = number.replace(/\D/g, "");
  const connected = instance.status === "connected";
  const canSend = connected && digits.length >= 10 && text.trim().length > 0;

  const submit = () =>
    send.mutate(
      { number: digits, text: text.trim() },
      {
        onSuccess: () => toast.success("Mensagem enviada"),
        onError: (err: { message?: string }) => toast.error(err.message ?? "Não foi possível enviar"),
      },
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Envio de teste</CardTitle>
        <CardDescription>
          Confirma que o número conectado realmente envia. Use um aparelho ao qual você tenha acesso
          para verificar a chegada.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!connected && (
          <Alert>
            <AlertTitle>WhatsApp não está conectado</AlertTitle>
            <AlertDescription>Conecte o número antes de enviar uma mensagem de teste.</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor="test-number">Número de destino (com DDI e DDD)</Label>
          <Input
            id="test-number"
            inputMode="numeric"
            placeholder="5543999140409"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            disabled={!connected}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="test-text">Mensagem</Label>
          <Textarea
            id="test-text"
            rows={3}
            maxLength={MAX}
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={!connected}
          />
          <span className="text-muted-foreground text-xs">
            {text.length}/{MAX}
          </span>
        </div>

        <div>
          <Button onClick={submit} disabled={!canSend || send.isPending}>
            <Send />
            {send.isPending ? "Enviando…" : "Enviar teste"}
          </Button>
        </div>

        {/* enviar para quem nunca falou com este número esbarra no limite do WhatsApp, não num
            problema da conexão — sem esta nota o gestor culparia o CRM */}
        <p className="text-muted-foreground text-xs">
          Falha ao enviar para um contato novo pode ser limite do próprio WhatsApp. Confira a aba
          Diagnóstico antes de concluir que a conexão está com problema.
        </p>
      </CardContent>
    </Card>
  );
};
