'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  currencyToInput,
  formatCurrencyInput,
  parseCurrencyInput,
} from '@/lib/labels'
import { useClients } from '@/lib/queries/clients'
import { useCreateDeal, useUpdateDeal } from '@/lib/queries/deals'
import type { Deal, Stage } from '@/lib/types'
import { useState } from 'react'
import { toast } from 'sonner'

export const DealDialog = ({
  pipelineId,
  stages,
  deal,
  defaultStageId,
  trigger,
  nativeButton,
}: {
  pipelineId: string
  stages: Stage[]
  deal?: Deal
  defaultStageId?: string
  trigger: React.ReactNode
  nativeButton?: boolean
}) => {
  const editing = !!deal
  const create = useCreateDeal()
  const update = useUpdateDeal()
  const { data: clients } = useClients()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState(deal?.title ?? '')
  const [clientId, setClientId] = useState(deal?.clientId ?? '')
  const [stageId, setStageId] = useState(
    deal?.stageId ?? defaultStageId ?? stages[0]?.id ?? '',
  )
  // state guarda o valor já formatado (1.250.000,00); vira número só no submit
  const [value, setValue] = useState(currencyToInput(deal?.value))

  const saving = create.isPending || update.isPending

  // o state só nasce na montagem e o dialog não desmonta ao fechar: sem isto, reabrir traz o
  // rascunho anterior (ou dados desatualizados do negócio, se ele mudou nesse meio-tempo)
  const onOpenChange = (next: boolean) => {
    if (next) {
      setTitle(deal?.title ?? '')
      setClientId(deal?.clientId ?? '')
      setStageId(deal?.stageId ?? defaultStageId ?? stages[0]?.id ?? '')
      setValue(currencyToInput(deal?.value))
    }
    setOpen(next)
  }

  const submit = async () => {
    if (!title.trim() || !clientId || !stageId) return
    const input = {
      title: title.trim(),
      clientId,
      pipelineId,
      stageId,
      value: parseCurrencyInput(value),
    }
    try {
      if (editing) await update.mutateAsync({ id: deal.id, input })
      else await create.mutateAsync(input)
      toast.success(editing ? 'Negócio atualizado' : 'Negócio criado')
      setOpen(false)
    } catch {
      toast.error('Não foi possível salvar o negócio')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        nativeButton={nativeButton}
        render={trigger as React.ReactElement<Record<string, unknown>>}
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {editing ? 'Editar negócio' : 'Novo negócio'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="deal-title">Título</Label>
            <Input
              id="deal-title"
              value={title}
              onChange={e => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Cliente</Label>
            <Select value={clientId} onValueChange={v => setClientId(v ?? '')}>
              <SelectTrigger className="w-full">
                {/* sem a função, o trigger mostra o id cru em vez do nome */}
                <SelectValue>
                  {(v: string) =>
                    clients?.find(c => c.id === v)?.name ??
                    'Selecione um cliente'
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {clients?.map(c => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Estágio</Label>
              <Select value={stageId} onValueChange={v => setStageId(v ?? '')}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) =>
                      stages.find(s => s.id === v)?.name ?? 'Estágio'
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {stages.map(s => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="deal-value">Valor</Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  R$
                </span>
                <Input
                  id="deal-value"
                  inputMode="numeric"
                  placeholder="0,00"
                  className="pl-9 text-right tabular-nums"
                  value={value}
                  onChange={e => setValue(formatCurrencyInput(e.target.value))}
                />
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={submit}
            disabled={saving || !title.trim() || !clientId || !stageId}
          >
            {saving ? 'Salvando…' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
