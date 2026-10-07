"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ImportedAudience, ImportPreview } from "@/lib/import-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const RecipientImport = ({ onChange }: { onChange: (value: ImportedAudience | null, selectedCount: number) => void }) => {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportPreview | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [search, setSearch] = useState("");
  const update = (rows: ImportPreview | null, ids: number[]) => onChange(rows && ids.length ? { recipients: rows.rows.filter(row => ids.includes(row.row) && !row.error && row.normalizedPhone).map(row => ({ phone: row.normalizedPhone!, name: row.name })) } : null, ids.length);
  const upload = useMutation({ mutationFn: async () => {
    if (!file || file.size > 1024 * 1024) throw { message: "Escolha um arquivo de até 1 MiB" };
    const content = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]!); reader.onerror = () => reject({ message: "Não foi possível ler o arquivo" }); reader.readAsDataURL(file); });
    return (await api.post<ImportPreview>("/broadcasts/imports/preview", { filename: file.name, content })).data;
  }, onSuccess: rows => { const ids = rows.rows.filter(row => !row.error).slice(0, 200).map(row => row.row); setResult(rows); setSelected(ids); update(rows, ids); } });
  const toggle = (id: number) => { const ids = selected.includes(id) ? selected.filter(value => value !== id) : selected.length < 200 ? [...selected, id] : selected; setSelected(ids); update(result, ids); };
  return <section className="min-w-0 space-y-3">
    <div className="space-y-1 text-sm"><p>{"Excel .xlsx, CSV UTF-8 ou JSON. Até 1 MiB e 1000 linhas por arquivo; selecione até 200 destinatários por disparo. No Excel, usamos a primeira aba."}</p><p>Use as colunas <code>phone</code> e <code>name</code> (opcional). Telefone com DDD e número, com ou sem DDI 55. Salve telefones como texto para preservar os dígitos.</p><div className="flex flex-wrap gap-3">{["xlsx", "csv", "json"].map(format => <a key={format} className="text-primary underline" href={`/examples/broadcast-recipients.${format}`} download>Baixar exemplo {format.toUpperCase()}</a>)}</div></div>
    <div className="flex flex-wrap items-end gap-2"><label className="min-w-0 flex-1 text-sm">Arquivo de destinatários<Input aria-label="Arquivo de destinatários" type="file" accept=".xlsx,.csv,.json" disabled={upload.isPending} onChange={event => { setFile(event.target.files?.[0] ?? null); setResult(null); setSelected([]); onChange(null, 0); upload.reset(); }} /></label><Button variant="outline" disabled={!file || upload.isPending} onClick={() => upload.mutate()}>{upload.isPending ? "Analisando…" : "Analisar arquivo"}</Button></div>
    {upload.isError && <p role="alert" className="text-sm text-destructive">{upload.error.message ?? "Não foi possível analisar o arquivo"}</p>}
    {result && <>
      <p role="status" className="text-sm">{result.valid} válidos · {result.invalid} inválidos ou repetidos · {selected.length}/200 selecionados</p>
      {result.valid > 200 && <p className="text-sm text-muted-foreground">{"O arquivo possui mais de 200 números válidos. Revise a seleção; os demais não receberão neste disparo."}</p>}
      <div className="flex flex-wrap gap-2"><Input className="max-w-sm" placeholder="Buscar nome ou telefone" aria-label="Buscar destinatários importados" value={search} onChange={event => setSearch(event.target.value)} /><Button variant="outline" size="sm" onClick={() => { setSelected([]); update(result, []); }}>Desmarcar todos</Button><Button variant="outline" size="sm" onClick={() => { const ids = result.rows.filter(row => !row.error).slice(0, 200).map(row => row.row); setSelected(ids); update(result, ids); }}>Selecionar primeiros 200 válidos</Button></div>
      <div role="region" aria-label="Destinatários importados" tabIndex={0} className="max-h-80 overflow-auto rounded-md border"><table className="w-full min-w-[640px] text-left text-sm"><thead className="sticky top-0 bg-background"><tr><th className="p-2">Selecionar</th><th className="p-2">Linha</th><th className="p-2">Nome</th><th className="p-2">Telefone</th><th className="p-2">Validação</th></tr></thead><tbody>{result.rows.filter(row => `${row.name} ${row.phone} ${row.normalizedPhone ?? ""}`.toLowerCase().includes(search.toLowerCase())).map(row => <tr key={row.row} className="border-t"><td className="p-2"><input type="checkbox" aria-label={`Selecionar linha ${row.row}`} checked={selected.includes(row.row)} disabled={!!row.error || (!selected.includes(row.row) && selected.length >= 200)} onChange={() => toggle(row.row)} /></td><td className="p-2">{row.row}</td><td className="p-2">{row.name || "Sem nome"}</td><td className="whitespace-nowrap p-2">{row.normalizedPhone ?? row.phone}</td><td className={`p-2 ${row.error ? "text-destructive" : "text-muted-foreground"}`}>{row.error ?? "Válido"}</td></tr>)}</tbody></table></div>
      <p className="text-xs text-muted-foreground">A lista será salva somente no disparo, sem criar leads ou cards. A validação do formato não confirma que o número existe no WhatsApp.</p>
    </>}
  </section>;
};
