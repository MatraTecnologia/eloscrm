import { AtSign, Mail, MessageCircle, Pencil, Phone } from "lucide-react";
import { clientSourceLabels } from "@/lib/labels";
import type { Client } from "@/lib/types";
import { ClientAvatar } from "../client-avatar";
import { ClientDialog } from "../client-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const LeadHeader = ({
  client,
  stageName,
  interest,
  budget,
}: {
  client: Client;
  stageName: string | null;
  interest: string | null;
  budget: string;
}) => {
  const digits = client.phone?.replace(/\D/g, "");

  return (
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
      <div className="flex items-start gap-4">
        <ClientAvatar id={client.id} name={client.name} className="size-16" textClassName="text-lg" />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold">{client.name}</h1>
            {stageName && (
              <Badge variant="outline" className="border-primary/20 bg-primary/10 text-primary">
                {stageName}
              </Badge>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {client.phone && (
              <span className="flex items-center gap-1.5">
                <Phone className="size-3.5" /> {client.phone}
              </span>
            )}
            {client.email && (
              <span className="flex items-center gap-1.5">
                <Mail className="size-3.5" /> {client.email}
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <AtSign className="size-3.5" /> {clientSourceLabels[client.source]}
            </span>
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {interest && (
              <>
                Interesse: <span className="font-medium text-foreground">{interest}</span>
                {" · "}
              </>
            )}
            Orçamento: <span className="font-medium text-foreground">{budget}</span>
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {digits && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Conversar no WhatsApp"
            nativeButton={false}
            render={<a href={`https://wa.me/55${digits}`} target="_blank" rel="noreferrer" />}
          >
            <MessageCircle className="size-4 text-success" />
          </Button>
        )}
        {client.phone && (
          <Button variant="ghost" size="icon" aria-label="Ligar" nativeButton={false} render={<a href={`tel:${client.phone}`} />}>
            <Phone className="size-4" />
          </Button>
        )}
        {client.email && (
          <Button variant="ghost" size="icon" aria-label="Enviar e-mail" nativeButton={false} render={<a href={`mailto:${client.email}`} />}>
            <Mail className="size-4" />
          </Button>
        )}
        <ClientDialog
          client={client}
          trigger={
            <Button variant="ghost" size="icon" aria-label="Editar cliente">
              <Pencil className="size-4" />
            </Button>
          }
        />
      </div>
    </div>
  );
};
