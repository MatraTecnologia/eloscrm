"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, RotateCcw, Trash2 } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { formatFileSize } from "@/lib/labels";
import {
  useDeleteWhatsappInstance,
  useResetWhatsapp,
  useWhatsappDeletionPreview,
} from "@/lib/queries/whatsapp";
import type { WhatsappDeletionPreview } from "@/lib/types";
import { toast } from "sonner";

const plural = (n: number, um: string, muitos: string) => `${n} ${n === 1 ? um : muitos}`;

const Inventario = ({ preview }: { preview: WhatsappDeletionPreview }) => (
  <div className="space-y-3 text-sm">
    <div>
      <p className="font-medium">Isto será apagado agora:</p>
      <ul className="text-muted-foreground mt-1 list-disc space-y-0.5 pl-5">
        <li>
          a conexão <span className="text-foreground font-medium">{preview.instance.name}</span> no
          servidor do provedor
        </li>
        {preview.conversations > 0 ? (
          <li>
            {plural(preview.conversations, "conversa", "conversas")} e{" "}
            {plural(preview.messages, "mensagem", "mensagens")} do atendimento
          </li>
        ) : (
          <li>nenhuma conversa (nada foi recebido nesta conexão ainda)</li>
        )}
        {preview.storage.objects > 0 && (
          <li>
            {plural(preview.storage.objects, "mídia", "mídias")} ({formatFileSize(preview.storage.bytes)})
            — fotos, áudios e documentos das conversas
          </li>
        )}
        <li>o histórico de conexão desta imobiliária</li>
      </ul>
    </div>

    <p className="text-muted-foreground">
      Os leads e negócios <span className="text-foreground font-medium">continuam</span> — o que sai é o
      atendimento de WhatsApp. {preview.instance.connected ? "O número será desconectado e " : ""}
      será preciso ler o QR Code de novo para voltar a usar.
    </p>
  </div>
);

export const DangerZone = ({ removeOnly = false }: { removeOnly?: boolean }) => {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [ciente, setCiente] = useState(false);
  const reset = useResetWhatsapp();
  const remove = useDeleteWhatsappInstance();
  const { data: preview, isLoading } = useWhatsappDeletionPreview(open);

  const onError = (err: { message?: string }) => toast.error(err.message ?? "A operação falhou");

  // Conexão com conversa exige digitar o nome; sem conversa nenhuma, o checkbox basta. A cerimônia
  // acompanha o que se perde — pedir o nome para apagar uma instância vazia é atrito sem risco.
  const exigeNome = (preview?.conversations ?? 0) > 0;
  const nome = preview?.instance.name ?? "";
  const liberado =
    !!preview && ciente && !remove.isPending && (!exigeNome || confirm.trim() === nome);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setConfirm("");
      setCiente(false);
    }
  };

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="text-destructive size-4" />
          Zona de risco
        </CardTitle>
        <CardDescription>
          Reiniciar mantém o número conectado. Remover apaga a conexão no servidor de WhatsApp e leva
          as conversas desta imobiliária.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {!removeOnly && (
          <Button
            variant="outline"
            onClick={() =>
              reset.mutate(undefined, {
                onSuccess: () => toast.success("Instância reiniciada"),
                onError,
              })
            }
            disabled={reset.isPending}
          >
            <RotateCcw />
            Reiniciar conexão
          </Button>
        )}

        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogTrigger
            render={
              <Button variant="destructive">
                <Trash2 />
                Remover WhatsApp
              </Button>
            }
          />
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Remover a conexão de WhatsApp?</DialogTitle>
              <DialogDescription>
                Esta ação é permanente: o atendimento apagado aqui não volta, e não há backup no
                aplicativo.
              </DialogDescription>
            </DialogHeader>

            {isLoading || !preview ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-20 w-full" />
              </div>
            ) : (
              <Inventario preview={preview} />
            )}

            {exigeNome && (
              <div className="space-y-2">
                <Label htmlFor="confirm-instance">
                  Para confirmar, digite <span className="font-mono font-medium">{nome}</span>
                </Label>
                <Input
                  id="confirm-instance"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  autoComplete="off"
                />
              </div>
            )}

            <Label className="flex items-start gap-2 text-sm font-normal">
              <Checkbox checked={ciente} onCheckedChange={(value) => setCiente(value === true)} />
              <span>
                Entendo que as conversas e mídias desta conexão serão apagadas e que não é possível
                desfazer.
              </span>
            </Label>

            <DialogFooter>
              <DialogClose render={<Button variant="outline">Cancelar</Button>} />
              <Button
                variant="destructive"
                disabled={!liberado}
                onClick={() =>
                  remove.mutate(undefined, {
                    onSuccess: () => {
                      toast.success("WhatsApp removido");
                      onOpenChange(false);
                    },
                    onError,
                  })
                }
              >
                {remove.isPending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 />}
                Remover permanentemente
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
};
