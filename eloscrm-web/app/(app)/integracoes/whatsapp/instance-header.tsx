"use client";

import { formatDistanceToNow, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { PlugZap, RefreshCw, Unplug } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useConnectWhatsapp, useDisconnectWhatsapp, useSyncWhatsapp } from "@/lib/queries/whatsapp";
import type { WhatsappInstance } from "@/lib/types";
import { toast } from "sonner";
import { jidToPhone, statusLabels, statusVariants } from "./labels";

type Props = { instance: WhatsappInstance; canManage: boolean };

export const InstanceHeader = ({ instance, canManage }: Props) => {
  const sync = useSyncWhatsapp();
  const disconnect = useDisconnectWhatsapp();
  const connect = useConnectWhatsapp();

  const onError = (err: { message?: string }) => toast.error(err.message ?? "A operação falhou");
  const phone = jidToPhone(instance.ownerJid);
  const initials = (instance.profileName ?? instance.name).slice(0, 2).toUpperCase();

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-4">
        <Avatar className="size-12">
          {instance.profilePicUrl && <AvatarImage src={instance.profilePicUrl} alt="" />}
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>

        <div className="min-w-40 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{instance.profileName ?? instance.name}</span>
            <Badge variant={statusVariants[instance.status]}>{statusLabels[instance.status]}</Badge>
            {instance.isBusiness && <Badge variant="outline">Business</Badge>}
          </div>
          <p className="text-muted-foreground text-sm">
            {phone ?? "Número ainda não identificado"}
            {instance.lastStatusAt && (
              <>
                {" · atualizado "}
                {formatDistanceToNow(parseISO(instance.lastStatusAt), { addSuffix: true, locale: ptBR })}
              </>
            )}
          </p>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => sync.mutate(undefined, { onError })} disabled={sync.isPending}>
            <RefreshCw />
            Sincronizar
          </Button>
          {canManage &&
            (instance.status === "connected" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => disconnect.mutate(undefined, { onError })}
                disabled={disconnect.isPending}
              >
                <Unplug />
                Desconectar
              </Button>
            ) : (
              instance.status === "hibernated" && (
                <Button size="sm" onClick={() => connect.mutate({}, { onError })} disabled={connect.isPending}>
                  <PlugZap />
                  Reconectar
                </Button>
              )
            ))}
        </div>
      </CardContent>
    </Card>
  );
};
