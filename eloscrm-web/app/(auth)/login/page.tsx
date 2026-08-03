"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AuthShell } from "../auth-shell";
import { SignInForm } from "./sign-in-form";
import { SignUpForm } from "./sign-up-form";

// `next` traz de volta a rota que exigiu login (hoje só o aceite de convite usa).
// Só caminho relativo: um destino absoluto viraria open redirect.
const safeNext = (value: string | null) => (value?.startsWith("/") && !value.startsWith("//") ? value : "/dashboard");

const LoginTabs = () => {
  const next = safeNext(useSearchParams().get("next"));

  return (
    <Tabs defaultValue="signin">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="signin">Entrar</TabsTrigger>
        <TabsTrigger value="signup">Criar conta</TabsTrigger>
      </TabsList>
      <TabsContent value="signin" className="pt-4">
        <SignInForm next={next} />
      </TabsContent>
      <TabsContent value="signup" className="pt-4">
        <SignUpForm />
      </TabsContent>
    </Tabs>
  );
};

export default function LoginPage() {
  return (
    <AuthShell>
      {/* useSearchParams empurra a árvore para client-side rendering: sem o boundary o build falha */}
      <Suspense fallback={<div className="h-64" />}>
        <LoginTabs />
      </Suspense>
    </AuthShell>
  );
}
