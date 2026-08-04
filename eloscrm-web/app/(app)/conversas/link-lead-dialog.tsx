"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useCandidates,
  useCreateClientFromConversation,
  useLinkClient,
} from "@/lib/queries/conversations";
import { formatPhone } from "@/lib/labels";
import type { Conversation } from "@/lib/types";
import { toast } from "sonner";

/**
 * Uma tela só para os dois caminhos, porque a decisão é a mesma: de quem é esta conversa. Quando o
 * telefone casa com leads existentes, escolher vem antes de criar — criar um segundo lead com o
 * mesmo número é o erro que essa lista evita.
 */
export const LinkLeadDialog = ({ conversation }: { conversation: Conversation }) => {
  const [open, setOpen] = useState(false);
  const [nome, setNome] = useState("");
  const { data: candidatos } = useCandidates(conversation.id, open);
  const criar = useCreateClientFromConversation();
  const vincular = useLinkClient();

  const onOpenChange = (next: boolean) => {
    // o sugerido vem do perfil do WhatsApp; o corretor corrige antes de gravar
    if (next) setNome(conversation.contactName ?? conversation.waName ?? "");
    setOpen(next);
  };

  const erro = () => toast.error("Não foi possível concluir");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <UserPlus />
            Criar ou vincular lead
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>De quem é esta conversa?</DialogTitle>
          <DialogDescription>
            {formatPhone(conversation.phone) || conversation.phone}
          </DialogDescription>
        </DialogHeader>

        {candidatos && candidatos.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">
              {candidatos.length === 1
                ? "Um lead já usa este telefone"
                : `${candidatos.length} leads usam este telefone`}
            </span>
            {candidatos.map((c) => (
              <button
                key={c.id}
                type="button"
                className="hover:bg-muted flex items-center justify-between rounded-md border p-2 text-left text-sm"
                onClick={() =>
                  vincular.mutate(
                    { conversationId: conversation.id, clientId: c.id },
                    {
                      onSuccess: () => {
                        toast.success(`Conversa ligada a ${c.name}`);
                        setOpen(false);
                      },
                      onError: erro,
                    },
                  )
                }
              >
                <span>{c.name}</span>
                <span className="text-muted-foreground text-xs">{formatPhone(c.phone)}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-2 border-t pt-3">
          <Label htmlFor="novo-lead">Ou criar um lead novo</Label>
          <Input
            id="novo-lead"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Nome do lead"
          />
        </div>

        <DialogFooter>
          <Button
            onClick={() =>
              criar.mutate(
                { conversationId: conversation.id, name: nome.trim() },
                {
                  onSuccess: (lead) => {
                    toast.success(`Lead ${lead.name} criado`);
                    setOpen(false);
                  },
                  onError: erro,
                },
              )
            }
            disabled={!nome.trim() || criar.isPending}
          >
            Criar lead
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
