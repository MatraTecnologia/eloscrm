"use client";

import { useSession } from "@/lib/auth-client";
import { ProfileForm } from "./profile-form";
import { PasswordForm } from "./password-form";
import { Skeleton } from "@/components/ui/skeleton";

export default function ProfilePage() {
  // única página de (app) que não depende de organização: quem ainda não tem imobiliária
  // precisa conseguir mexer na própria conta
  const { data: session, isPending, refetch } = useSession();
  const user = session?.user;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Minha conta</h1>
        <p className="text-muted-foreground">Seus dados de acesso ao elosCRM.</p>
      </div>

      {isPending && <Skeleton className="h-64 w-full" />}

      {!isPending && user && (
        <>
          {/* key: o formulário guarda rascunho em state e precisa renascer quando a sessão
              recarrega com os dados novos, senão o campo continua mostrando o valor antigo */}
          <ProfileForm
            key={`${user.name}-${user.email}`}
            user={{ name: user.name, email: user.email }}
            onSaved={refetch}
          />
          <PasswordForm />
        </>
      )}
    </div>
  );
}
