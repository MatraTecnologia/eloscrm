"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCreateTag, useDeleteTag, useTags, useUpdateTag } from "@/lib/queries/tags";
import { cn } from "@/lib/utils";
import { nextTagColor, TAG_COLORS } from "./tag-chip";

const erroDe = (e: unknown) =>
  (e as { code?: string })?.code === "TAG_NAME_TAKEN"
    ? "Já existe uma etiqueta com esse nome"
    : "Não foi possível salvar a etiqueta";

/** Bolinha que abre a paleta. É o mesmo controle na linha de cada etiqueta e no campo de nova. */
const ColorSwatch = ({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (color: string) => void;
  label: string;
}) => (
  <Popover>
    <PopoverTrigger
      render={
        <button
          type="button"
          aria-label={label}
          className="size-6 shrink-0 rounded-full border-2 border-background ring-1 ring-border"
          style={{ background: value }}
        />
      }
    />
    <PopoverContent className="w-auto p-2" align="start">
      <div className="grid grid-cols-5 gap-1.5">
        {TAG_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={color}
            className={cn(
              "size-6 rounded-full transition-transform hover:scale-110",
              color === value && "ring-2 ring-foreground ring-offset-2 ring-offset-popover",
            )}
            style={{ background: color }}
            onClick={() => onChange(color)}
          />
        ))}
      </div>
    </PopoverContent>
  </Popover>
);

export const TagManagerDialog = ({ trigger }: { trigger: React.ReactNode }) => {
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string>(TAG_COLORS[0]);
  const { data: tags } = useTags();
  const create = useCreateTag();
  const update = useUpdateTag();
  const remove = useDeleteTag();

  const add = async () => {
    if (!newName.trim()) return;
    try {
      await create.mutateAsync({ name: newName.trim(), color: newColor });
      setNewName("");
      setNewColor(nextTagColor((tags?.length ?? 0) + 1));
    } catch (e) {
      toast.error(erroDe(e));
    }
  };

  const rename = async (id: string, name: string, current: string) => {
    if (!name.trim() || name.trim() === current) return;
    try {
      await update.mutateAsync({ id, input: { name: name.trim() } });
    } catch (e) {
      toast.error(erroDe(e));
    }
  };

  const recolor = async (id: string, color: string) => {
    try {
      await update.mutateAsync({ id, input: { color } });
    } catch {
      toast.error("Não foi possível trocar a cor");
    }
  };

  const excluir = async (id: string) => {
    try {
      await remove.mutateAsync(id);
    } catch {
      toast.error("Não foi possível excluir a etiqueta");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setNewName("");
          setNewColor(nextTagColor(tags?.length ?? 0));
        }
        setOpen(next);
      }}
    >
      <DialogTrigger render={trigger as React.ReactElement<Record<string, unknown>>} />
      <DialogContent className="flex max-h-[85dvh] flex-col gap-4 overflow-y-hidden sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Etiquetas</DialogTitle>
          <DialogDescription>
            Valem para todos os funis. Excluir uma etiqueta só a tira dos negócios.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="-mr-2 min-h-0 flex-1 scroll-fade">
          <div className="space-y-2 pr-3">
            {tags?.length === 0 && (
              <div className="rounded-lg border border-dashed py-6 text-center text-xs text-muted-foreground">
                Nenhuma etiqueta ainda
              </div>
            )}
            {tags?.map((tag) => (
              <div key={tag.id} className="flex items-center gap-2 rounded-lg border p-2">
                <ColorSwatch
                  value={tag.color}
                  label={`Cor de ${tag.name}`}
                  onChange={(color) => recolor(tag.id, color)}
                />
                <Input
                  defaultValue={tag.name}
                  className="h-8 flex-1"
                  onBlur={(e) => rename(tag.id, e.target.value, tag.name)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={`Excluir ${tag.name}`}
                  onClick={() => excluir(tag.id)}
                >
                  <Trash2 className="size-4 text-muted-foreground" />
                </Button>
              </div>
            ))}
          </div>
        </ScrollArea>
        <div className="flex shrink-0 items-center gap-2 border-t pt-4">
          <ColorSwatch value={newColor} label="Cor da nova etiqueta" onChange={setNewColor} />
          <Input
            placeholder="Nova etiqueta"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
            }}
          />
          <Button onClick={add} disabled={!newName.trim() || create.isPending}>
            <Plus className="size-4" /> Adicionar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
