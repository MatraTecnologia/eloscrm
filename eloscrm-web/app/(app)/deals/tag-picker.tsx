"use client";

import { useState } from "react";
import { Plus, Tags } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useCreateTag, useTags } from "@/lib/queries/tags";
import { nextTagColor, TagChip } from "./tag-chip";

/**
 * Seletor de etiquetas do negócio: marca e desmarca entre as da imobiliária, e cria na hora o que
 * ainda não existe. Guarda só ids — o formulário manda `tagIds` e a API devolve as etiquetas
 * resolvidas.
 */
export const TagPicker = ({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) => {
  const { data: tags } = useTags();
  const createTag = useCreateTag();
  const [draft, setDraft] = useState("");

  const selected = (tags ?? []).filter((tag) => value.includes(tag.id));
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  // o botão de criar fica fora do filtro do cmdk, senão sumiria junto com os itens que não casam —
  // e é justamente quando nada casa que criar faz sentido
  const nome = draft.trim();
  const jaExiste = (tags ?? []).some((tag) => tag.name.toLowerCase() === nome.toLowerCase());
  const podeCriar = nome.length > 0 && !jaExiste;

  const criar = async () => {
    if (!podeCriar) return;
    try {
      const tag = await createTag.mutateAsync({
        name: nome,
        color: nextTagColor(tags?.length ?? 0),
      });
      onChange([...value, tag.id]);
      setDraft("");
    } catch {
      toast.error("Não foi possível criar a etiqueta");
    }
  };

  return (
    <div className="space-y-2">
      <Popover>
        <PopoverTrigger render={<Button variant="outline" className="w-full justify-start" />}>
          <Tags className="size-4" />
          {selected.length === 0
            ? "Adicionar etiquetas"
            : selected.length === 1
              ? "1 etiqueta"
              : `${selected.length} etiquetas`}
        </PopoverTrigger>
        <PopoverContent className="w-64 p-0" align="start">
          <Command>
            <CommandInput
              placeholder="Buscar ou criar…"
              value={draft}
              onValueChange={setDraft}
              onKeyDown={(e) => {
                // Enter com texto que não existe cria; com item na lista, o cmdk já seleciona
                if (e.key === "Enter" && podeCriar) {
                  e.preventDefault();
                  criar();
                }
              }}
            />
            <CommandList>
              <CommandEmpty>Nenhuma etiqueta.</CommandEmpty>
              <CommandGroup>
                {(tags ?? []).map((tag) => (
                  <CommandItem
                    key={tag.id}
                    value={tag.name}
                    data-checked={value.includes(tag.id)}
                    onSelect={() => toggle(tag.id)}
                  >
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: tag.color }}
                    />
                    <span className="truncate">{tag.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
            {podeCriar && (
              <div className="border-t p-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start"
                  disabled={createTag.isPending}
                  onClick={criar}
                >
                  <Plus className="size-4" /> Criar &quot;{nome}&quot;
                </Button>
              </div>
            )}
          </Command>
        </PopoverContent>
      </Popover>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((tag) => (
            <TagChip key={tag.id} tag={tag} onRemove={() => toggle(tag.id)} />
          ))}
        </div>
      )}
    </div>
  );
};
