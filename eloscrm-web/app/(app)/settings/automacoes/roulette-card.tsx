"use client";

import { TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { LeadAutomationMember } from "@/lib/types";

export const RouletteCard = ({
  checked,
  onCheckedChange,
  members,
  ativos,
  onToggle,
}: {
  checked: boolean;
  onCheckedChange: (on: boolean) => void;
  members: LeadAutomationMember[];
  ativos: string[];
  onToggle: (userId: string, on: boolean) => void;
}) => {
  // quem tem menos negócio aberto é o próximo — mostrar a fila torna o critério compreensível
  const fila = [...members]
    .filter((m) => ativos.includes(m.userId))
    .sort((a, b) => a.openDeals - b.openDeals);
  const proximo = fila[0];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1.5">
            <CardTitle>Distribuir entre os corretores</CardTitle>
            <CardDescription>
              Cada lead novo vai para quem está com menos negócios em aberto. Empate resolve por quem
              recebeu há mais tempo, então a fila gira sozinha enquanto as cargas são parecidas.
            </CardDescription>
          </div>
          <Switch checked={checked} onCheckedChange={onCheckedChange} />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          {members.map((member) => (
            <Label
              key={member.userId}
              className="hover:bg-muted/50 flex items-center gap-3 rounded-md p-2 font-normal"
            >
              <Checkbox
                checked={ativos.includes(member.userId)}
                onCheckedChange={(on) => onToggle(member.userId, !!on)}
                disabled={!checked}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{member.name}</span>
                <span className="text-muted-foreground block truncate text-xs">{member.email}</span>
              </span>
              <Badge variant="secondary">
                {member.openDeals} {member.openDeals === 1 ? "negócio" : "negócios"}
              </Badge>
            </Label>
          ))}
        </div>

        {checked && ativos.length === 0 && (
          <p className="text-destructive flex items-center gap-1.5 text-sm">
            <TriangleAlert className="size-4 shrink-0" />
            Sem ninguém marcado, o lead é criado sem responsável.
          </p>
        )}

        {checked && proximo && (
          <p className="text-muted-foreground text-sm">
            O próximo lead vai para <span className="font-medium">{proximo.name}</span>.
          </p>
        )}
      </CardContent>
    </Card>
  );
};
