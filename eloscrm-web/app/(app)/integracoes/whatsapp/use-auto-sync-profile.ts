"use client";

import { useEffect, useRef } from "react";
import { useSyncWhatsapp } from "@/lib/queries/whatsapp";
import type { WhatsappInstance } from "@/lib/types";

/**
 * Completa o perfil logo depois de conectar.
 *
 * O webhook de conexão manda pouco — em `connected` vêm só `name` e `status`. `profileName`, foto,
 * `isBusiness` e `plataform` só existem em `GET /instance/status`, ou seja, no Sincronizar. Sem isto,
 * quem acabou de ler o QR fica olhando "Conectado" sem foto nem nome, e nada completa sozinho: o
 * `refetchInterval` cai de 3s para 30s justamente ao conectar, e refetch não sincroniza — só relê o
 * estado local.
 *
 * **Uma tentativa por instância.** Conta no WhatsApp sem nome de perfil é possível, e nesse caso
 * `profileName` continua nulo depois do sync: sem a trava, a condição seguiria verdadeira para
 * sempre e cada refetch dispararia outra chamada à uazapi. Falhou, resta o botão manual.
 *
 * Só gestor sincroniza (o service exige), e é ele quem acabou de ler o QR — o corretor que abrir a
 * tela antes disso vê o perfil vazio até alguém sincronizar.
 */
export const useAutoSyncProfile = (instance: WhatsappInstance | null | undefined, canManage: boolean) => {
  const { mutate } = useSyncWhatsapp();
  const attempted = useRef<string | null>(null);

  const id = instance?.id;
  const status = instance?.status;
  const hasProfile = Boolean(instance?.profileName);
  const remoteDeleted = Boolean(instance?.remoteDeletedAt);

  useEffect(() => {
    if (!id || !canManage || remoteDeleted) return;
    if (status !== "connected" || hasProfile) return;
    if (attempted.current === id) return;
    attempted.current = id;
    mutate(undefined);
  }, [id, status, hasProfile, remoteDeleted, canManage, mutate]);
};
