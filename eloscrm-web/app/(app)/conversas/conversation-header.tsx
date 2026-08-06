"use client";

import Link from "next/link";
import { Archive, ArchiveRestore, ExternalLink, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useArchiveConversation, useDeleteConversation } from "@/lib/queries/conversations";
import { formatPhone, leadTemperatureLabels } from "@/lib/labels";
import type { Conversation } from "@/lib/types";
import { toast } from "sonner";
import { AddToPipelineDialog } from "./add-to-pipeline-dialog";
import { LinkLeadDialog } from "./link-lead-dialog";

type Props = {
  conversation: Conversation;
  /** Fecha a conversa aberta: sem isto a tela buscaria uma conversa que não existe mais e piscaria 404. */
  onDeleted: () => void;
};

export const ConversationHeader = ({ conversation, onDeleted }: Props) => {
  const archive = useArchiveConversation();
  const remove = useDeleteConversation();
  const nome = conversation.client?.name ?? conversation.contactName ?? conversation.waName ?? "Sem nome";
  const arquivada = Boolean(conversation.archivedAt);

  // Fecha no ato do clique, não em callback: `useConversationMutation` devolve a promise da
  // invalidação no próprio `onSuccess`, e o callback passado ao `mutate` só roda depois dela — a
  // conversa já apagada ficaria na tela até o refetch do detalhe ir e voltar em 404 (duas vezes,
  // por causa do `retry: 1` do QueryClient). Fechando antes, a query do detalhe fica desabilitada e
  // a invalidação não a refaz. Se o DELETE falhar, o toast diz, e a conversa continua na lista.
  const excluir = () => {
    remove.mutate(conversation.id, {
      onSuccess: () => toast.success("Conversa excluída"),
      onError: () => toast.error("Não foi possível excluir"),
    });
    onDeleted();
  };

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

        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button variant="ghost" size="icon-sm" aria-label="Excluir conversa">
                <Trash2 className="text-destructive" />
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir conversa</AlertDialogTitle>
              {/* O aviso é o ponto da tela: o corretor precisa saber o que sai, o que fica e que
                  existe caminho reversível. Sem a linha do WhatsApp, "excluir" soa como apagar do
                  aparelho do lead — e sem a de reaparecer, como bloquear o contato. */}
              <AlertDialogDescription>
                Todo o histórico de {nome} sai do CRM: mensagens, mídias e reações. Essa ação não
                pode ser desfeita.
                <br />
                Nada é apagado no WhatsApp — o lead continua com a conversa no aparelho dele. Se ele
                escrever de novo, a conversa reaparece aqui vazia.
                <br />
                Para tirar da lista sem perder o histórico, arquive.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={excluir}>
                Excluir
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
};
