"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app/app-sidebar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data: session, isPending, error, refetch } = useSession();

  useEffect(() => {
    if (!isPending && !session && !error) router.replace("/login");
  }, [isPending, session, error, router]);

  // Só entra aqui quem ainda não tem sessão carregada — com `session` em mãos, um erro de refetch
  // em segundo plano não pode derrubar a tela de quem está usando o app.
  if (!session) {
    // Deslogado é get-session respondendo 200 com corpo null, sem erro. Com erro (API fora do ar,
    // 5xx, rate limit) a sessão pode estar perfeitamente válida: mandar para /login aqui expulsa
    // usuário logado para uma tela onde o login também falharia.
    if (error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
          <TriangleAlert className="size-8 text-muted-foreground" />
          <div className="space-y-1">
            <p className="font-medium">Não foi possível verificar sua sessão</p>
            <p className="text-sm text-muted-foreground">
              O servidor não respondeu. Tente novamente em alguns instantes.
            </p>
          </div>
          <Button variant="outline" onClick={() => refetch()}>
            Tentar novamente
          </Button>
        </div>
      );
    }
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Carregando…</div>;
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="min-w-0">
        <header className="flex h-14 items-center gap-2 border-b px-4">
          <SidebarTrigger />
        </header>
        <main className="min-h-0 min-w-0 flex-1 p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
