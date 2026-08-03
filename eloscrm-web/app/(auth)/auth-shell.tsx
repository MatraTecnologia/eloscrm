import Image from "next/image";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Props = {
  title?: string;
  children: React.ReactNode;
};

/** Moldura comum das telas fora do gate de sessão (login, recuperação, convite). */
export const AuthShell = ({ title = "Conectando oportunidades", children }: Props) => (
  <div className="flex min-h-screen items-center justify-center bg-secondary p-4">
    <Card className="w-full max-w-sm">
      {/* CardHeader é grid: items-center alinha no eixo vertical, quem centraliza é justify-items */}
      <CardHeader className="justify-items-center gap-3 text-center">
        {/* logo-oficial e logo-white têm o "elos" em branco, invisível no card claro */}
        <Image src="/logo-dark.svg" alt="elosCRM" width={160} height={48} priority style={{ height: "auto" }} />
        <CardTitle className="text-base font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  </div>
);
