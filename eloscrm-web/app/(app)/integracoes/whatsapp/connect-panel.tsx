"use client";

import { useState } from "react";
import { QrCode, RefreshCw, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useConnectWhatsapp } from "@/lib/queries/whatsapp";
import type { WhatsappInstance } from "@/lib/types";
import { toast } from "sonner";

type Props = { instance: WhatsappInstance; canManage: boolean };

export const ConnectPanel = ({ instance, canManage }: Props) => {
  const [phone, setPhone] = useState("");
  const connect = useConnectWhatsapp();

  const start = (usePhone: boolean) =>
    connect.mutate(
      { phone: usePhone ? phone.replace(/\D/g, "") : undefined },
      { onError: (err: { message?: string }) => toast.error(err.message ?? "Não foi possível iniciar a conexão") },
    );

  if (instance.qrcode) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Leia o QR Code</CardTitle>
          <CardDescription>
            No celular: WhatsApp → Configurações → Aparelhos conectados → Conectar aparelho.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          {/* data URI vindo da uazapi: next/image não agrega nada aqui */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={instance.qrcode}
            alt="QR Code para conectar o WhatsApp"
            className="size-64 rounded-lg border bg-white p-2"
          />
          <p className="text-muted-foreground text-sm">O código expira em cerca de um minuto.</p>
          {canManage && (
            <Button variant="outline" onClick={() => start(false)} disabled={connect.isPending}>
              <RefreshCw />
              Gerar novo código
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  if (instance.paircode) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Código de pareamento</CardTitle>
          <CardDescription>Digite este código no WhatsApp do aparelho informado.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          <span className="font-mono text-3xl tracking-[0.3em]">{instance.paircode}</span>
          {canManage && (
            <Button variant="outline" onClick={() => start(false)} disabled={connect.isPending}>
              <RefreshCw />
              Gerar novo código
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  if (instance.status === "connecting") {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10">
          <Spinner />
          <p className="text-muted-foreground text-sm">Conectando ao WhatsApp…</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Conectar o aparelho</CardTitle>
        <CardDescription>
          Escolha ler um QR Code na tela ou receber um código de pareamento no celular.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Button onClick={() => start(false)} disabled={!canManage || connect.isPending}>
          <QrCode />
          Gerar QR Code
        </Button>
        <div className="flex flex-col gap-2">
          <Label htmlFor="wa-phone">Ou receber código no número (com DDI e DDD)</Label>
          <div className="flex gap-2">
            <Input
              id="wa-phone"
              inputMode="numeric"
              placeholder="5543999140409"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={!canManage}
            />
            <Button
              variant="outline"
              onClick={() => start(true)}
              disabled={!canManage || connect.isPending || phone.replace(/\D/g, "").length < 10}
            >
              <Smartphone />
              Enviar código
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
