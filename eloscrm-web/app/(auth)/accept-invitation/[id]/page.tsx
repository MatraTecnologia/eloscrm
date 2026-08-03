"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Building2 } from "lucide-react";
import { toast } from "sonner";
import { authClient, useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AuthShell } from "../../auth-shell";

export default function AcceptInvitationPage() {
  const router = useRouter();
  const invitationId = String(useParams().id);
  const { data: session, isPending } = useSession();
  const [loading, setLoading] = useState(false);

  const accept = async () => {
    setLoading(true);
    const res = await authClient.organization.acceptInvitation({ invitationId });
    if (res.error) {
      setLoading(false);
      toast.error("Convite inválido, expirado ou já usado");
      return;
    }
    // sem ativar a organização recém-aceita o app abre no tenant antigo (ou vazio, se for o primeiro)
    const organizationId = res.data?.member?.organizationId;
    if (organizationId) await authClient.organization.setActive({ organizationId });
    router.replace("/dashboard");
  };

  const reject = async () => {
    setLoading(true);
    await authClient.organization.rejectInvitation({ invitationId });
    setLoading(false);
    toast.success("Convite recusado");
    router.replace("/login");
  };

  if (isPending) {
    return (
      <AuthShell title="Convite">
        <div className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-9 w-full" />
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Convite para uma imobiliária">
      <div className="space-y-4 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
          <Building2 className="size-6" />
        </div>
        {session ? (
          <>
            <p className="text-sm text-muted-foreground">
              Você foi convidado para trabalhar no elosCRM de uma imobiliária. Ao aceitar, sua conta{" "}
              <span className="font-medium text-foreground">{session.user.email}</span> passa a ver o funil do time.
            </p>
            <div className="space-y-2">
              <Button className="w-full" onClick={accept} disabled={loading}>
                {loading ? "Entrando…" : "Aceitar convite"}
              </Button>
              <Button variant="ghost" className="w-full" onClick={reject} disabled={loading}>
                Recusar
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Entre na sua conta do elosCRM para aceitar o convite. O convite é ligado ao e-mail que recebeu a
              mensagem.
            </p>
            <Button
              className="w-full"
              nativeButton={false}
              render={<Link href={`/login?next=/accept-invitation/${invitationId}`}>Entrar para aceitar</Link>}
            />
          </>
        )}
      </div>
    </AuthShell>
  );
}
