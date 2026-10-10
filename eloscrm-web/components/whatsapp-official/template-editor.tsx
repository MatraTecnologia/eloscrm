"use client";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

export type TemplateDraft = { name: string; language: string; category: string; header: string; body: string; footer: string; examples: string[] };
export const TemplateEditor = ({ busy, onSave, onCancel }: { busy: boolean; onSave: (draft: TemplateDraft) => void; onCancel: () => void }) => {
  const [draft, setDraft] = useState<TemplateDraft>({ name: "", language: "pt_BR", category: "MARKETING", header: "", body: "", footer: "", examples: [] });
  const placeholders = [...new Set([...draft.body.matchAll(/\{\{(\d+)\}\}/g)].map(match => match[1]))];
  const variables = [...new Set(placeholders.map(Number))];
  const body = draft.body.trim();
  const errors = [
    !/^[a-z0-9_]{1,512}$/.test(draft.name) && "Informe um nome com letras minúsculas, números e sublinhado.",
    !body && "Escreva a mensagem do template.",
    (placeholders.some((value, index) => value !== String(index + 1)) || /[{}]/.test(body.replace(/\{\{[1-9]\d*\}\}/g, ""))) && "Use variáveis na ordem {{1}}, {{2}}, sem pular números nem usar zeros à esquerda.",
    /^\{\{\d+\}\}|\{\{\d+\}\}$/.test(body) && "Inclua texto fixo antes da primeira variável e depois da última.",
    variables.length > 10 && "Este editor aceita até 10 variáveis.",
    variables.some(number => !draft.examples[number - 1]?.trim()) && "Preencha um exemplo para cada variável.",
    (draft.header.includes("{{") || draft.footer.includes("{{")) && "Neste editor, cabeçalho e rodapé devem ter texto fixo.",
  ].filter((message): message is string => typeof message === "string");
  const invalid = errors.length > 0;
  const preview = draft.body.replace(/\{\{(\d+)\}\}/g, (match, number) => draft.examples[Number(number) - 1] || match);
  return <form className="grid gap-6 rounded-lg border p-4 lg:grid-cols-[minmax(0,1fr)_320px]" onSubmit={event => { event.preventDefault(); if (!invalid && !busy) onSave({ ...draft, examples: draft.examples.slice(0, variables.length) }); }}>
    <fieldset disabled={busy} className="min-w-0 space-y-4">
      <legend className="mb-3 font-medium">Novo template de texto</legend>
      <label className="block space-y-1 text-sm">Nome<Input value={draft.name} maxLength={512} placeholder="confirmacao_visita" onChange={event => setDraft({ ...draft, name: event.target.value })} /><span className="text-xs text-muted-foreground">Somente letras minúsculas, números e sublinhado.</span></label>
      <div className="grid grid-cols-2 gap-3"><label className="space-y-1 text-sm">Categoria<select className="h-9 w-full rounded-md border bg-background px-2" value={draft.category} onChange={event => setDraft({ ...draft, category: event.target.value })}><option value="UTILITY">Utilidade</option><option value="MARKETING">Marketing</option></select></label><label className="space-y-1 text-sm">Idioma<select className="h-9 w-full rounded-md border bg-background px-2" value={draft.language} onChange={event => setDraft({ ...draft, language: event.target.value })}><option value="pt_BR">Português (Brasil)</option><option value="en_US">Inglês (EUA)</option><option value="es">Espanhol</option></select></label></div>
      <p className="text-xs text-muted-foreground">{draft.category === "UTILITY" ? "Utilidade: confirmação ou atualização de uma solicitação específica do cliente, como uma visita agendada. Ofertas de imóveis e prospecção são Marketing." : "Marketing: ofertas de imóveis, campanhas e prospecção. Use conteúdo autorizado pelo destinatário."} A Meta pode alterar a categoria, o que afeta o custo dos envios.</p>
      <label className="block space-y-1 text-sm">Cabeçalho opcional<Input maxLength={60} value={draft.header} onChange={event => setDraft({ ...draft, header: event.target.value })} /></label>
      <label className="block space-y-1 text-sm">Mensagem<Textarea rows={6} maxLength={1024} value={draft.body} placeholder="Olá {{1}}, sua visita está confirmada para {{2}}." onChange={event => setDraft({ ...draft, body: event.target.value })} /><span className="text-xs text-muted-foreground">{draft.body.length}/1024 · Use {"{{1}}, {{2}}"} para personalizar o envio.</span></label>
      {variables.filter(number => number >= 1 && number <= 10).map(number => <label key={number} className="block space-y-1 text-sm">Exemplo para {`{{${number}}}`}<Input value={draft.examples[number - 1] ?? ""} maxLength={200} placeholder={number > 1 ? "08/10 às 14h" : "Maria"} onChange={event => { const examples = [...draft.examples]; examples[number - 1] = event.target.value; setDraft({ ...draft, examples }); }} /></label>)}
      <label className="block space-y-1 text-sm">Rodapé opcional<Input maxLength={60} value={draft.footer} onChange={event => setDraft({ ...draft, footer: event.target.value })} /></label>
      {invalid && <div aria-live="polite" className="space-y-1 text-xs text-muted-foreground"><p className="font-medium">Para enviar à Meta:</p><ul className="list-disc space-y-1 pl-4">{errors.map(message => <li key={message}>{message}</li>)}</ul></div>}
      <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" onClick={onCancel}>Cancelar</Button><Button type="submit" disabled={invalid || busy}>{busy ? "Enviando…" : "Enviar para aprovação"}</Button></div>
    </fieldset>
    <aside className="space-y-3"><h3 className="text-sm font-medium">Prévia da mensagem</h3><div className="space-y-2 rounded-lg bg-muted p-4 text-sm">{draft.header && <p className="break-words font-semibold">{draft.header}</p>}<p className="whitespace-pre-wrap break-words">{preview || "O texto aparecerá aqui."}</p>{draft.footer && <p className="break-words text-xs text-muted-foreground">{draft.footer}</p>}</div><p className="text-xs text-muted-foreground">Use exemplos fictícios e coerentes com o idioma. Evite mensagens compostas principalmente por variáveis. A aprovação depende da análise de conteúdo pela Meta; somente templates aprovados podem ser enviados.</p></aside>
  </form>;
};
