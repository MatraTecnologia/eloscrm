"use client";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

export type TemplateDraft = { name: string; language: string; category: string; header: string; body: string; footer: string; examples: string[] };
export const TemplateEditor = ({ busy, onSave, onCancel }: { busy: boolean; onSave: (draft: TemplateDraft) => void; onCancel: () => void }) => {
  const [draft, setDraft] = useState<TemplateDraft>({ name: "", language: "pt_BR", category: "UTILITY", header: "", body: "", footer: "", examples: [] });
  const variables = [...new Set([...draft.body.matchAll(/\{\{(\d+)\}\}/g)].map(match => Number(match[1])))].sort((a, b) => a - b);
  const invalid = !/^[a-z0-9_]{1,512}$/.test(draft.name) || !draft.body.trim() || variables.some((value, index) => value !== index + 1 || !draft.examples[index]?.trim()) || /[{}]/.test(draft.body.replace(/\{\{\d+\}\}/g, "")) || draft.header.includes("{{") || draft.footer.includes("{{") || variables.length > 10;
  const preview = draft.body.replace(/\{\{(\d+)\}\}/g, (match, number) => draft.examples[Number(number) - 1] || match);
  return <form className="grid gap-6 rounded-lg border p-4 lg:grid-cols-[minmax(0,1fr)_320px]" onSubmit={event => { event.preventDefault(); if (!invalid && !busy) onSave({ ...draft, examples: draft.examples.slice(0, variables.length) }); }}>
    <fieldset disabled={busy} className="min-w-0 space-y-4">
      <legend className="mb-3 font-medium">Novo template de texto</legend>
      <label className="block space-y-1 text-sm">Nome<Input value={draft.name} maxLength={512} placeholder="confirmacao_visita" onChange={event => setDraft({ ...draft, name: event.target.value })} /><span className="text-xs text-muted-foreground">Somente letras minúsculas, números e sublinhado.</span></label>
      <div className="grid grid-cols-2 gap-3"><label className="space-y-1 text-sm">Categoria<select className="h-9 w-full rounded-md border bg-background px-2" value={draft.category} onChange={event => setDraft({ ...draft, category: event.target.value })}><option value="UTILITY">Utilidade</option><option value="MARKETING">Marketing</option></select></label><label className="space-y-1 text-sm">Idioma<select className="h-9 w-full rounded-md border bg-background px-2" value={draft.language} onChange={event => setDraft({ ...draft, language: event.target.value })}><option value="pt_BR">Português (Brasil)</option><option value="en_US">Inglês (EUA)</option><option value="es">Espanhol</option></select></label></div>
      <label className="block space-y-1 text-sm">Cabeçalho opcional<Input maxLength={60} value={draft.header} onChange={event => setDraft({ ...draft, header: event.target.value })} /></label>
      <label className="block space-y-1 text-sm">Mensagem<Textarea rows={6} maxLength={1024} value={draft.body} placeholder="Olá {{1}}, sua visita está confirmada para {{2}}." onChange={event => setDraft({ ...draft, body: event.target.value })} /><span className="text-xs text-muted-foreground">{draft.body.length}/1024 · Use {"{{1}}, {{2}}"} para personalizar o envio.</span></label>
      {variables.map((number, index) => <label key={number} className="block space-y-1 text-sm">Exemplo para {`{{${number}}}`}<Input value={draft.examples[index] ?? ""} maxLength={200} placeholder={index ? "08/10 às 14h" : "Maria"} onChange={event => { const examples = [...draft.examples]; examples[index] = event.target.value; setDraft({ ...draft, examples }); }} /></label>)}
      <label className="block space-y-1 text-sm">Rodapé opcional<Input maxLength={60} value={draft.footer} onChange={event => setDraft({ ...draft, footer: event.target.value })} /></label>
      <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" onClick={onCancel}>Cancelar</Button><Button type="submit" disabled={invalid || busy}>{busy ? "Enviando…" : "Enviar para aprovação"}</Button></div>
    </fieldset>
    <aside className="space-y-3"><h3 className="text-sm font-medium">Prévia da mensagem</h3><div className="space-y-2 rounded-lg bg-muted p-4 text-sm">{draft.header && <p className="break-words font-semibold">{draft.header}</p>}<p className="whitespace-pre-wrap break-words">{preview || "O texto aparecerá aqui."}</p>{draft.footer && <p className="break-words text-xs text-muted-foreground">{draft.footer}</p>}</div><p className="text-xs text-muted-foreground">Os exemplos ajudam a Meta a avaliar o conteúdo. O template só poderá ser enviado após a aprovação.</p></aside>
  </form>;
};
