"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { renderTemplate, TEMPLATE_VARIABLES, templateVarsOf } from "@/lib/broadcast-template";
import type { BroadcastPreviewRow } from "@/lib/types";

/**
 * Texto do disparo com variáveis. A prévia usa o primeiro destinatário marcado: é a única forma de
 * a pessoa ver que "{{nome}}" vira "Ana" antes de mandar para cinquenta.
 */
export const BroadcastMessage = ({
  text,
  onChange,
  sample,
}: {
  text: string;
  onChange: (next: string) => void;
  sample: BroadcastPreviewRow | null;
}) => {
  const ref = useRef<HTMLTextAreaElement>(null);

  // insere no cursor, não no fim: quem escreve a frase e volta para pôr o nome no meio não deveria
  // ter de recortar e colar
  const insert = (key: string) => {
    const el = ref.current;
    const token = `{{${key}}}`;
    if (!el) return onChange(text + token);
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const next = text.slice(0, start) + token + text.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="bc-text">Mensagem</Label>
        <Textarea
          id="bc-text"
          ref={ref}
          rows={6}
          placeholder="Olá {{nome}}, tudo bem? Passando para falar sobre {{titulo}}…"
          value={text}
          onChange={(e) => onChange(e.target.value)}
        />
        <div className="flex flex-wrap gap-1.5">
          {TEMPLATE_VARIABLES.map((v) => (
            <Button
              key={v.key}
              type="button"
              variant="outline"
              size="xs"
              onClick={() => insert(v.key)}
            >
              {v.label}
            </Button>
          ))}
        </div>
      </div>
      {sample && text.trim() && (
        <div className="rounded-lg border bg-muted/40 p-3">
          <p className="mb-1 text-xs text-muted-foreground">
            Prévia para {sample.client.name}
          </p>
          <p className="text-sm whitespace-pre-wrap">
            {renderTemplate(text, templateVarsOf(sample))}
          </p>
        </div>
      )}
    </div>
  );
};
