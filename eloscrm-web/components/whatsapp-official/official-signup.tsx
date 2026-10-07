"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { OfficialOnboarding, OfficialOnboardingConfig } from "@/lib/types";

type FacebookSdk = {
  init: (options: { appId: string; version: string; xfbml: boolean; autoLogAppEvents: boolean }) => void;
  login: (callback: (response: { authResponse?: { code?: string } }) => void, options: Record<string, unknown>) => void;
};
declare global { interface Window { FB?: FacebookSdk } }
const allowedOrigins = new Set(["https://www.facebook.com", "https://web.facebook.com", "https://business.facebook.com"]);

export const OfficialSignup = ({ config }: { config: Extract<OfficialOnboardingConfig, { available: true }> }) => {
  const queryClient = useQueryClient();
  const [attempt, setAttempt] = useState<OfficialOnboarding | null>(null);
  const [busy, setBusy] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const [sdkFailed, setSdkFailed] = useState(false);
  const [phoneId, setPhoneId] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const flow = useRef<{ active: boolean; submitting: boolean; code?: string; wabaId?: string }>({ active: false, submitting: false });
  const mounted = useRef(true);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; flow.current = { active: false, submitting: false }; if (timeout.current) clearTimeout(timeout.current); };
  }, []);

  useEffect(() => {
    const finish = async () => {
      const current = flow.current;
      if (!attempt || !current.active || current.submitting || !current.code || !current.wabaId) return;
      current.submitting = true;
      if (timeout.current) clearTimeout(timeout.current);
      const input = { code: current.code, wabaId: current.wabaId };
      current.code = undefined;
      try {
        // Código não entra no cache de mutations ou no log do navegador.
        const { data } = await api.post<OfficialOnboarding>(`/whatsapp/onboarding/${attempt.id}/exchange`, input);
        if (!mounted.current) return;
        setAttempt(data);
        setPhoneId(data.candidates.length === 1 ? data.candidates[0].id : "");
      } catch (error) {
        // A primeira chamada pode ter concluído ou falhado antes de uma resposta repetida.
        try {
          let { data } = await api.get<OfficialOnboarding>(`/whatsapp/onboarding/${attempt.id}`);
          for (let index = 0; data.status === "exchanging" && index < 15 && mounted.current; index++) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            ({ data } = await api.get<OfficialOnboarding>(`/whatsapp/onboarding/${attempt.id}`));
          }
          if (!mounted.current) return;
          setAttempt(data);
          setPhoneId(data.candidates.length === 1 ? data.candidates[0].id : "");
          if (data.status === "verified") return;
          if (data.status === "completed") {
            await queryClient.invalidateQueries({ queryKey: ["whatsapp-official"] });
            setAttempt(null);
            return;
          }
          if ((error as { code?: string }).code === "OFFICIAL_ATTEMPT_UNAVAILABLE") {
            setValidationError(data.status === "exchanging" ? "A autorização ainda está sendo validada. Aguarde e consulte o status antes de iniciar outro cadastro." : "Este cadastro não foi concluído. Inicie outro cadastro para obter uma nova autorização.");
            return;
          }
        } catch { /* Mantém a falha original se a consulta de estado estiver indisponível. */ }
        if (mounted.current) {
          const message = (error as { message?: string }).message ?? "Não foi possível validar a conexão";
          setValidationError(message);
          toast.error(message);
        }
      } finally { flow.current = { active: false, submitting: false }; if (mounted.current) setBusy(false); }
    };
    const onMessage = (event: MessageEvent) => {
      if (!allowedOrigins.has(event.origin) || !flow.current.active || typeof event.data !== "string") return;
      try {
        const data = JSON.parse(event.data);
        if (data.type !== "WA_EMBEDDED_SIGNUP" || data.event !== "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" || !/^\d{1,40}$/.test(data.data?.waba_id)) return;
        flow.current.wabaId = data.data.waba_id;
        void finish();
      } catch { /* Mensagens fora do contrato não participam do cadastro. */ }
    };
    window.addEventListener("message", onMessage);
    // Callback e postMessage podem chegar em qualquer ordem.
    const onCode = () => { void finish(); };
    window.addEventListener("eloscrm:official-signup-code", onCode);
    return () => { window.removeEventListener("message", onMessage); window.removeEventListener("eloscrm:official-signup-code", onCode); };
  }, [attempt, queryClient]);

  const prepare = async () => {
    if (window.location.protocol !== "https:") { toast.error("A conexão com a Meta exige acesso ao elosCRM por HTTPS."); return; }
    setBusy(true);
    setValidationError(null);
    try {
      const { data } = await api.post<OfficialOnboarding>("/whatsapp/onboarding", {});
      if (mounted.current) { setAttempt(data); setPhoneId(""); }
    } catch (error) { toast.error((error as { message?: string }).message ?? "Não foi possível iniciar a conexão"); }
    finally { if (mounted.current) setBusy(false); }
  };
  const connect = () => {
    if (!attempt || attempt.status !== "pending" || busy || flow.current.active || !window.FB || !sdkReady) return;
    if (Date.parse(attempt.expiresAt) <= Date.now()) { setAttempt(null); toast.error("O cadastro expirou; inicie novamente."); return; }
    flow.current = { active: true, submitting: false };
    setBusy(true);
    window.FB.login(response => {
      if (!mounted.current || !flow.current.active || flow.current.submitting) return;
      if (!response.authResponse?.code) { flow.current.active = false; setBusy(false); toast.error("A conexão foi cancelada na Meta."); return; }
      flow.current.code = response.authResponse.code;
      timeout.current = setTimeout(() => {
        flow.current = { active: false, submitting: false };
        if (mounted.current) { setBusy(false); toast.error("A Meta não confirmou o cadastro em Coexistence. Inicie novamente."); setAttempt(null); }
      }, 20_000);
      window.dispatchEvent(new Event("eloscrm:official-signup-code"));
    }, { config_id: config.configId, response_type: "code", override_default_response_type: true,
      extras: { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" },
    });
  };
  const activate = async () => {
    if (!attempt || !phoneId) return;
    setBusy(true);
    try {
      await api.post(`/whatsapp/onboarding/${attempt.id}/activate`, { phoneNumberId: phoneId });
      if (!mounted.current) return;
      setAttempt(null);
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-official"] });
      toast.success("Conexão salva. Acompanhe abaixo o início da sincronização.");
    } catch (error) { if (mounted.current) toast.error((error as { message?: string }).message ?? "Não foi possível concluir a conexão"); }
    finally { if (mounted.current) setBusy(false); }
  };
  const refreshAttempt = async () => {
    if (!attempt || busy) return;
    setBusy(true);
    try {
      const { data } = await api.get<OfficialOnboarding>(`/whatsapp/onboarding/${attempt.id}`);
      setAttempt(data);
      setPhoneId(data.candidates.length === 1 ? data.candidates[0].id : "");
      if (data.status === "verified") setValidationError(null);
      if (data.status === "failed" || data.status === "uncertain") setValidationError("Este cadastro não foi concluído. Inicie outro cadastro para obter uma nova autorização.");
      if (data.status === "completed") {
        await queryClient.invalidateQueries({ queryKey: ["whatsapp-official"] });
        setAttempt(null);
        setValidationError(null);
      }
    } catch { toast.error("Não foi possível consultar o cadastro. Tente novamente."); }
    finally { if (mounted.current) setBusy(false); }
  };

  return <div className="flex flex-col items-start gap-3">
    {attempt && <Script src="https://connect.facebook.net/pt_BR/sdk.js" strategy="afterInteractive" onReady={() => {
      if (!window.FB) { setSdkFailed(true); return; }
      window.FB.init({ appId: config.appId, version: config.graphVersion, xfbml: false, autoLogAppEvents: false });
      setSdkReady(true);
    }} onError={() => setSdkFailed(true)} />}
    {!attempt && <Button onClick={prepare} disabled={busy}>{busy ? "Preparando conexão…" : "Conectar WhatsApp Business"}</Button>}
    {attempt?.status === "pending" && <>
      <Button onClick={connect} disabled={busy || !sdkReady}>{busy ? "Aguardando a Meta…" : sdkReady ? "Continuar com a Meta" : "Carregando conexão…"}</Button>
      <p className="text-muted-foreground text-sm">Selecione o número que já usa no WhatsApp Business e confirme a conexão no celular.</p>
      {sdkFailed && <p role="alert" className="text-destructive text-sm">Não foi possível carregar a Meta. Verifique o bloqueador de rastreadores e recarregue a página.</p>}
    </>}
    {attempt?.status === "verified" && <div className="flex flex-col gap-3">
      <label htmlFor="official-phone" className="text-sm font-medium">Número da imobiliária</label>
      <select id="official-phone" className="border-input bg-background h-9 rounded-md border px-3 text-sm" value={phoneId} onChange={event => setPhoneId(event.target.value)} disabled={busy}>
        <option value="">Selecione o número autorizado</option>
        {attempt.candidates.map(phone => <option key={phone.id} value={phone.id}>{phone.displayPhoneNumber}{phone.verifiedName ? ` · ${phone.verifiedName}` : ""}</option>)}
      </select>
      <Button disabled={busy || !phoneId} onClick={activate}>{busy ? "Salvando conexão…" : "Concluir conexão"}</Button>
    </div>}
    {validationError && <p role="alert" className="text-destructive text-sm">{validationError}</p>}
    {attempt?.status === "exchanging" && <Button variant="outline" onClick={refreshAttempt} disabled={busy}>Consultar status do cadastro</Button>}
    {attempt && !busy && attempt.status !== "exchanging" && <Button variant="ghost" size="sm" onClick={() => { setAttempt(null); setValidationError(null); }}>Iniciar outro cadastro</Button>}
  </div>;
};
