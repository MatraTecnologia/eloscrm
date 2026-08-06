"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { organization, useListOrganizations } from "@/lib/auth-client";
import { formatFileSize } from "@/lib/labels";
import { useDeleteOrganization, useOrgDeletionPreview } from "@/lib/queries/organization";
import type { OrgDeletionPreview } from "@/lib/types";

/** Ordem de leitura: o que o corretor reconhece primeiro, não a ordem das tabelas. */
const LINHAS: { key: keyof OrgDeletionPreview["counts"]; label: (n: number) => string }[] = [
  { key: "clients", label: (n) => (n === 1 ? "1 lead" : `${n} leads`) },
  { key: "deals", label: (n) => (n === 1 ? "1 negócio" : `${n} negócios`) },
  { key: "activities", label: (n) => (n === 1 ? "1 atividade" : `${n} atividades`) },
  { key: "properties", label: (n) => (n === 1 ? "1 imóvel" : `${n} imóveis`) },
  { key: "pipelines", label: (n) => (n === 1 ? "1 funil" : `${n} funis`) },
  { key: "conversations", label: (n) => (n === 1 ? "1 conversa" : `${n} conversas`) },
  { key: "whatsappMessages", label: (n) => (n === 1 ? "1 mensagem" : `${n} mensagens de WhatsApp`) },
  { key: "comments", label: (n) => (n === 1 ? "1 comentário" : `${n} comentários`) },
  { key: "members", label: (n) => (n === 1 ? "1 membro" : `${n} membros da equipe`) },
  { key: "auditEvents", label: (n) => (n === 1 ? "1 registro de auditoria" : `${n} registros de auditoria`) },
];

const Inventario = ({ preview }: { preview: OrgDeletionPreview }) => {
  const itens = LINHAS.filter(({ key }) => preview.counts[key] > 0).map(({ key, label }) =>
    label(preview.counts[key]),
  );

  return (
    <div className="space-y-3 text-sm">
      <div>
        <p className="font-medium">Isto será apagado agora:</p>
        <ul className="text-muted-foreground mt-1 list-disc space-y-0.5 pl-5">
          {itens.length === 0 ? (
            <li>nenhum dado cadastrado</li>
          ) : (
            itens.map((item) => <li key={item}>{item}</li>)
          )}
          {preview.storage.objects > 0 && (
            <li>
              {preview.storage.objects === 1
                ? "1 arquivo"
                : `${preview.storage.objects} arquivos`}{" "}
              ({formatFileSize(preview.storage.bytes)}) — anexos e mídias das conversas
            </li>
          )}
        </ul>
      </div>

      {preview.whatsapp && (
        <p className="text-muted-foreground">
          A conexão de WhatsApp <span className="text-foreground font-medium">{preview.whatsapp.name}</span>{" "}
          será apagada no servidor do provedor. {preview.whatsapp.connected ? "O número será desconectado e " : ""}
          será preciso ler o QR Code de novo para usar em outra imobiliária.
        </p>
      )}

      <p className="text-muted-foreground">
        A auditoria vai junto: depois disso não existe registro de quem fez o quê nesta imobiliária, e
        não há backup no aplicativo para reverter.
      </p>
    </div>
  );
};

export const DeleteOrgCard = ({ slug, name }: { slug: string; name: string }) => {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [ciente, setCiente] = useState(false);
  const router = useRouter();
  const { data: preview, isLoading } = useOrgDeletionPreview(open);
  const { data: organizacoes } = useListOrganizations();
  const remove = useDeleteOrganization();

  // as três travas juntas: o slug exato digitado, a ciência marcada e a prévia carregada — confirmar
  // sem ver o que morre é o clique que este diálogo existe para impedir
  const liberado = confirm.trim() === slug && ciente && !!preview && !remove.isPending;

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setConfirm("");
      setCiente(false);
    }
  };

  const excluir = () => {
    remove.mutate(confirm.trim(), {
      onSuccess: async () => {
        // a sessão ainda aponta para a imobiliária que não existe mais: sem trocar a org ativa, toda
        // tela passaria a responder 403 até o usuário escolher outra à mão
        const restante = organizacoes?.find((item) => item.slug !== slug);
        await organization.setActive({ organizationId: restante?.id ?? null });
        toast.success(`A imobiliária ${name} foi excluída`);
        router.replace(restante ? "/dashboard" : "/settings");
      },
      onError: (error: { message?: string }) =>
        toast.error(error.message ?? "Não foi possível excluir a imobiliária"),
    });
  };

  return (
    <Card className="border-destructive/40 max-w-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="text-destructive size-4" />
          Zona de risco
        </CardTitle>
        <CardDescription>
          Excluir a imobiliária apaga leads, negócios, conversas, arquivos e a auditoria. É imediato e
          não tem como desfazer.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogTrigger
            render={
              <Button variant="destructive">
                <Trash2 className="size-4" />
                Excluir esta imobiliária
              </Button>
            }
          />
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Excluir {name}?</DialogTitle>
              <DialogDescription>
                Esta ação é permanente. Nada aqui pode ser recuperado depois, nem por suporte.
              </DialogDescription>
            </DialogHeader>

            {isLoading || !preview ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : (
              <Inventario preview={preview} />
            )}

            <div className="space-y-2">
              <Label htmlFor="confirm-slug">
                Para confirmar, digite <span className="font-mono font-medium">{slug}</span>
              </Label>
              <Input
                id="confirm-slug"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                autoComplete="off"
                // sem placeholder com o slug: além de parecer campo preenchido, ele entregaria o
                // texto pronto dentro do próprio campo que existe para obrigar a digitar
              />
            </div>

            <Label className="flex items-start gap-2 text-sm font-normal">
              <Checkbox checked={ciente} onCheckedChange={(value) => setCiente(value === true)} />
              <span>
                Entendo que os dados desta imobiliária serão apagados agora e que esta ação não pode
                ser desfeita.
              </span>
            </Label>

            <DialogFooter>
              <DialogClose render={<Button variant="outline">Cancelar</Button>} />
              <Button variant="destructive" disabled={!liberado} onClick={excluir}>
                {remove.isPending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                Excluir permanentemente
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
};
