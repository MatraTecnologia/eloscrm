"use client";
import { useSyncExternalStore } from "react";
import type { OfficialSendInput } from "@/lib/messaging-types";

type Draft = { mode: "text" | "template" | "media"; text: string; templateId: string; values: Record<string, string>; file: File | null; busy: boolean; uncertainRequest: boolean };
const empty: Draft = { mode: "text", text: "", templateId: "", values: {}, file: null, busy: false, uncertainRequest: false };
const drafts = new Map<string, ReturnType<typeof createEntry>>();
const createEntry = (mode: Draft["mode"]) => {
  let snapshot = { ...empty, mode };
  let locked = false;
  let pending: OfficialSendInput | null = null;
  const listeners = new Set<() => void>();
  return {
    isLocked: () => locked,
    setLocked: (value: boolean) => { locked = value; },
    getPending: () => pending,
    setPending: (value: OfficialSendInput | null) => { pending = value; },
    get: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    update: (patch: Partial<Draft>) => { snapshot = { ...snapshot, ...patch }; listeners.forEach(listener => listener()); },
  };
};

// Somente em memória, isolado por sessão, imobiliária e conversa. A troca de tela não perde a chave do envio.
export const useComposerDraft = (scope: string, mode: Draft["mode"]) => {
  let entry = drafts.get(scope);
  if (!entry) { entry = createEntry(mode); drafts.set(scope, entry); }
  const draft = useSyncExternalStore(entry.subscribe, entry.get, () => empty);
  return { draft, entry };
};
