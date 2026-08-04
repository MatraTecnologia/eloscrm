"use client";

import { RotateCcw, Trash2 } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useDeleteWhatsappInstance, useResetWhatsapp } from "@/lib/queries/whatsapp";
import { toast } from "sonner";

export const DangerZone = ({ removeOnly = false }: { removeOnly?: boolean }) => {
  const reset = useResetWhatsapp();
  const remove = useDeleteWhatsappInstance();

  const onError = (err: { message?: string }) => toast.error(err.message ?? "A operação falhou");

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle>Zona de risco</CardTitle>
        <CardDescription>
          Reiniciar mantém o número conectado. Remover apaga a instância no servidor de WhatsApp e
          exige ler o QR Code de novo.
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

        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button variant="destructive">
                <Trash2 />
                Remover WhatsApp
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remover a conexão de WhatsApp?</AlertDialogTitle>
              <AlertDialogDescription>
                A instância é apagada no servidor e o histórico de conexão desta imobiliária se perde.
                Para voltar a usar, será preciso conectar e ler o QR Code de novo.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() =>
                  remove.mutate(undefined, {
                    onSuccess: () => toast.success("WhatsApp removido"),
                    onError,
                  })
                }
              >
                Remover
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
};
