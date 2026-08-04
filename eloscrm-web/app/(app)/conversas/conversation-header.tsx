"use client";

import Link from "next/link";
import { Archive, ArchiveRestore, ExternalLink } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useArchiveConversation } from "@/lib/queries/conversations";
import { formatPhone, leadTemperatureLabels } from "@/lib/labels";
import type { Conversation } from "@/lib/types";
import { toast } from "sonner";
import { AddToPipelineDialog } from "./add-to-pipeline-dialog";
import { LinkLeadDialog } from "./link-lead-dialog";

export const ConversationHeader = ({ conversation }: { conversation: Conversation }) => {
  const archive = useArchiveConversation();
  const nome = conversation.client?.name ?? conversation.contactName ?? conversation.waName ?? "Sem nome";
  const arquivada = Boolean(conversation.archivedAt);

  return (
    <div className="flex flex-wrap items-center gap-3 border-b p-3">
      <Avatar className="size-10">
        {conversation.photoUrl && <AvatarImage src={conversation.photoUrl} alt="" />}
        <AvatarFallback>{nome.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>

      <div className="min-w-40 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{nome}</span>
          {conversation.client && (
            <Badge variant="outline">
              {leadTemperatureLabels[conversation.client.temperature]}
            </Badge>
          )}
        </div>
        <span className="text-muted-foreground text-sm">
          {formatPhone(conversation.phone) || conversation.phone || "—"}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {conversation.client ? (
          <>
            <AddToPipelineDialog client={conversation.client} />
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href={`/clients/${conversation.client.id}`} />}
            >
              <ExternalLink />
              Abrir lead
            </Button>
          </>
        ) : (
          <LinkLeadDialog conversation={conversation} />
        )}

        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={arquivada ? "Desarquivar conversa" : "Arquivar conversa"}
          onClick={() =>
            archive.mutate(
              { id: conversation.id, archived: !arquivada },
              { onError: () => toast.error("Não foi possível arquivar") },
            )
          }
        >
          {arquivada ? <ArchiveRestore /> : <Archive />}
        </Button>
      </div>
    </div>
  );
};
