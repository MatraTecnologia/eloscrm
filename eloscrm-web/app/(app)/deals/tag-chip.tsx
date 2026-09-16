"use client";

import { X } from "lucide-react";
import type { DealTag } from "@/lib/types";
import { cn } from "@/lib/utils";

// Paleta fixa para etiqueta nova. Cor livre viraria um arco-íris por kanban; com dez opções bem
// separadas, o corretor distingue de longe e a criação inline no seletor não precisa perguntar cor.
export const TAG_COLORS = [
  "#2563eb",
  "#7c3aed",
  "#db2777",
  "#dc2626",
  "#ea580c",
  "#d97706",
  "#16a34a",
  "#0d9488",
  "#0891b2",
  "#64748b",
] as const;

/** Cor da próxima etiqueta: roda a paleta pela quantidade que já existe, para não repetir cedo. */
export const nextTagColor = (existing: number) => TAG_COLORS[existing % TAG_COLORS.length];

/**
 * Chip de etiqueta. Fundo e borda vêm da própria cor com alfa no sufixo — só funciona porque a API
 * garante hex de seis dígitos —, e o texto usa a cor cheia: legível nos dois temas sem uma tabela
 * de variantes por cor.
 */
export const TagChip = ({
  tag,
  onRemove,
  className,
}: {
  tag: DealTag;
  onRemove?: () => void;
  className?: string;
}) => (
  <span
    className={cn(
      "inline-flex h-5 max-w-full items-center gap-1 rounded-full border px-2 text-[11px] font-medium leading-none whitespace-nowrap",
      className,
    )}
    style={{ background: `${tag.color}1f`, borderColor: `${tag.color}66`, color: tag.color }}
  >
    <span className="truncate">{tag.name}</span>
    {onRemove && (
      <button
        type="button"
        aria-label={`Remover ${tag.name}`}
        className="-me-0.5 rounded-full opacity-70 hover:opacity-100"
        onClick={onRemove}
      >
        <X className="size-3" />
      </button>
    )}
  </span>
);
