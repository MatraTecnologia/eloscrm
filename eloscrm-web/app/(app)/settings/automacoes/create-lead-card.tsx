"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

export const CreateLeadCard = ({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: (on: boolean) => void;
}) => (
  <Card>
    <CardHeader>
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1.5">
          <CardTitle>Criar lead automaticamente</CardTitle>
          <CardDescription>
            Quando um número desconhecido mandar mensagem no WhatsApp, o lead é cadastrado com o
            nome do perfil e a origem WhatsApp.
          </CardDescription>
        </div>
        <Switch checked={checked} onCheckedChange={onCheckedChange} />
      </div>
    </CardHeader>
    <CardContent>
      <p className="text-muted-foreground text-sm">
        Quando o telefone já pertence a mais de um lead — o que acontece quando um fixo e um celular
        terminam nos mesmos oito dígitos — nada é criado, e a conversa continua pedindo que alguém
        escolha de quem ela é.
      </p>
    </CardContent>
  </Card>
);
