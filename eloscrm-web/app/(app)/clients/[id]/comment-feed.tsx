"use client";

import { useState } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { MessageSquare, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/lib/auth-client";
import { useComments, useCreateComment, useDeleteComment, useUpdateComment } from "@/lib/queries/comments";
import { useMembers } from "@/lib/queries/members";
import type { AuditEntity } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

export const CommentFeed = ({ entityType, entityId }: { entityType: AuditEntity; entityId: string }) => {
  const { data: session } = useSession();
  const { data: comments, isLoading } = useComments(entityType, entityId);
  const create = useCreateComment();
  const update = useUpdateComment();
  const remove = useDeleteComment();
  const { data: members } = useMembers();
  const myRole = members?.find((member) => member.userId === session?.user.id)?.role ?? null;
  // a API deixa gestor remover comentário de qualquer um; editar segue só do autor
  const canManage = myRole === "owner" || myRole === "admin";

  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const submit = async () => {
    const body = draft.trim();
    if (!body) return;
    try {
      await create.mutateAsync({ entityType, entityId, body });
      setDraft("");
    } catch {
      toast.error("Não foi possível publicar o comentário");
    }
  };

  const saveEdit = async (id: string) => {
    const body = editDraft.trim();
    if (!body) return;
    try {
      await update.mutateAsync({ id, body });
      setEditingId(null);
    } catch {
      toast.error("Não foi possível salvar a edição");
    }
  };

  const del = async (id: string) => {
    try {
      await remove.mutateAsync(id);
    } catch {
      // a API recusa quem não é autor nem gestor; a mensagem explica em vez de sumir com o botão
      toast.error("Você não pode remover este comentário");
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Textarea
          rows={3}
          placeholder="Escreva um comentário para a equipe…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="flex justify-end">
          <Button size="sm" onClick={submit} disabled={create.isPending || !draft.trim()}>
            {create.isPending ? "Publicando…" : "Comentar"}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : !comments?.length ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MessageSquare />
            </EmptyMedia>
            <EmptyTitle>Nenhum comentário</EmptyTitle>
            <EmptyDescription>Registre aqui o que a equipe precisa saber sobre este lead.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ol className="space-y-3">
          {comments.map((comment) => (
            <li key={comment.id} className="rounded-lg border p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{comment.authorName}</p>
                  <p className="text-xs text-muted-foreground">
                    {format(parseISO(comment.createdAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                    {comment.editedAt ? " · editado" : ""}
                  </p>
                </div>
                {(comment.authorId === session?.user.id || canManage) && editingId !== comment.id && (
                  <div className="flex shrink-0 gap-1">
                    {comment.authorId === session?.user.id && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Editar comentário"
                        onClick={() => {
                          setEditingId(comment.id);
                          setEditDraft(comment.body);
                        }}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remover comentário"
                      disabled={remove.isPending}
                      onClick={() => del(comment.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                )}
              </div>

              {editingId === comment.id ? (
                <div className="mt-2 space-y-2">
                  <Textarea rows={3} value={editDraft} onChange={(e) => setEditDraft(e.target.value)} />
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                      Cancelar
                    </Button>
                    <Button size="sm" onClick={() => saveEdit(comment.id)} disabled={update.isPending}>
                      Salvar
                    </Button>
                  </div>
                </div>
              ) : (
                // whitespace-pre-line: o corpo vem de textarea e pode ter quebras de linha
                <p className="mt-2 text-sm whitespace-pre-line">{comment.body}</p>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};
