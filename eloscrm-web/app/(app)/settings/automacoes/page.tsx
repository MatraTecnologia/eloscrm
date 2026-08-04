"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useLeadAutomation } from "@/lib/queries/lead-automation";
import { AutomationForm } from "./automation-form";

export default function AutomacoesPage() {
  const { data, isLoading } = useLeadAutomation();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-fit -ml-2"
          nativeButton={false}
          render={<Link href="/settings" />}
        >
          <ArrowLeft />
          Configurações
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">Automação de leads</h1>
          <p className="text-muted-foreground text-sm">
            O que acontece sozinho quando alguém manda mensagem no WhatsApp da imobiliária.
          </p>
        </div>
      </div>

      {isLoading || !data ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        // montado só com os dados em mãos: o formulário copia o estado inicial na primeira
        // renderização, e assim não há efeito sincronizando o que veio da API
        <AutomationForm inicial={data} />
      )}
    </div>
  );
}
