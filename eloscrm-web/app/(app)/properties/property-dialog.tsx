"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useCreateProperty, useUpdateProperty } from "@/lib/queries/properties";
import {
  currencyToInput,
  formatCurrencyInput,
  parseCurrencyInput,
  propertyStatusLabels,
} from "@/lib/labels";
import type { Property, PropertyStatus } from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const statusDotStyles: Record<PropertyStatus, string> = {
  DISPONIVEL: "bg-emerald-500",
  RESERVADO: "bg-amber-500",
  VENDIDO: "bg-blue-500",
  INATIVO: "bg-slate-400",
};

export const PropertyDialog = ({ property, trigger }: { property?: Property; trigger: React.ReactNode }) => {
  const editing = !!property;
  const create = useCreateProperty();
  const update = useUpdateProperty();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(property?.title ?? "");
  const [type, setType] = useState(property?.type ?? "");
  const [address, setAddress] = useState(property?.address ?? "");
  // state guarda o preço já formatado (1.250.000,00); vira número só no submit
  const [price, setPrice] = useState(currencyToInput(property?.price));
  const [bedrooms, setBedrooms] = useState(property?.bedrooms?.toString() ?? "");
  const [area, setArea] = useState(property?.area?.toString() ?? "");
  const [status, setStatus] = useState<PropertyStatus>(property?.status ?? "DISPONIVEL");
  const [photos, setPhotos] = useState(property?.photos.join(", ") ?? "");

  const saving = create.isPending || update.isPending;

  // o state só nasce na montagem e o dialog não desmonta ao fechar: sem isto, reabrir traz o
  // rascunho anterior (ou dados desatualizados do imóvel, se ele mudou nesse meio-tempo)
  const onOpenChange = (next: boolean) => {
    if (next) {
      setTitle(property?.title ?? "");
      setType(property?.type ?? "");
      setAddress(property?.address ?? "");
      setPrice(currencyToInput(property?.price));
      setBedrooms(property?.bedrooms?.toString() ?? "");
      setArea(property?.area?.toString() ?? "");
      setStatus(property?.status ?? "DISPONIVEL");
      setPhotos(property?.photos.join(", ") ?? "");
    }
    setOpen(next);
  };

  const submit = async () => {
    if (!title.trim()) return;
    const input = {
      title: title.trim(),
      type: type.trim() || undefined,
      address: address.trim() || undefined,
      price: parseCurrencyInput(price),
      bedrooms: bedrooms.trim() ? Number(bedrooms) : undefined,
      area: area.trim() ? Number(area) : undefined,
      status,
      photos: photos.trim()
        ? photos.split(",").map((url) => url.trim()).filter(Boolean)
        : undefined,
    };
    try {
      if (editing) await update.mutateAsync({ id: property.id, input });
      else await create.mutateAsync(input);
      toast.success(editing ? "Imóvel atualizado" : "Imóvel criado");
      setOpen(false);
    } catch {
      toast.error("Não foi possível salvar o imóvel");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={trigger as React.ReactElement<Record<string, unknown>>} />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar imóvel" : "Novo imóvel"}</DialogTitle>
          <DialogDescription>
            {editing ? "Atualize os dados do imóvel na carteira." : "Cadastre um imóvel na carteira da imobiliária."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="title">Título</Label>
              <Input id="title" placeholder="Ex.: Apartamento Jardim das Flores" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="type">Tipo</Label>
              <Input id="type" placeholder="Casa, Apto…" value={type} onChange={(e) => setType(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="address">Endereço</Label>
            <Input id="address" placeholder="Rua, número, bairro" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="grid grid-cols-4 gap-3">
            {/* preço ocupa duas colunas: com o prefixo R$, valores na casa do milhão não cabem em 1/3 */}
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="price">Preço</Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  R$
                </span>
                <Input
                  id="price"
                  inputMode="numeric"
                  placeholder="0,00"
                  className="pl-9 text-right tabular-nums"
                  value={price}
                  onChange={(e) => setPrice(formatCurrencyInput(e.target.value))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bedrooms">Quartos</Label>
              <Input id="bedrooms" type="number" min={0} value={bedrooms} onChange={(e) => setBedrooms(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="area">Área (m²)</Label>
              <Input id="area" type="number" min={0} value={area} onChange={(e) => setArea(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as PropertyStatus)}>
              <SelectTrigger className="w-full">
                <SelectValue>{(v: PropertyStatus) => propertyStatusLabels[v]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Object.entries(propertyStatusLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    <span className={`size-2 rounded-full ${statusDotStyles[value as PropertyStatus]}`} />
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="photos">Fotos</Label>
            <Input id="photos" placeholder="https://…, https://…" value={photos} onChange={(e) => setPhotos(e.target.value)} />
            <p className="text-xs text-muted-foreground">URLs separadas por vírgula.</p>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={saving || !title.trim()}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
