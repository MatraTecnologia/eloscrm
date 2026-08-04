'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { formatCurrencyInput, parseCurrencyInput } from '@/lib/labels'
import { useCreateDeal } from '@/lib/queries/deals'
import { usePipelines } from '@/lib/queries/pipelines'
import type { ConversationClient } from '@/lib/types'
import { Handshake } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

/** Atalho da conversa para o funil: cria o negócio sem tirar o corretor do atendimento. */
export const AddToPipelineDialog = ({
  client,
}: {
  client: ConversationClient
}) => {
  const [open, setOpen] = useState(false)
  const [titulo, setTitulo] = useState('')
  const [pipelineId, setPipelineId] = useState('')
  const [stageId, setStageId] = useState('')
  // state guarda o valor já formatado (1.250.000,00); vira número só no submit, igual ao DealForm
  const [valor, setValor] = useState('')

  const { data: pipelines } = usePipelines()
  const criar = useCreateDeal()

  const pipeline = pipelines?.find(p => p.id === pipelineId)

  // preenche ao abrir, não por efeito: sincronizar estado em useEffect quebra a regra de
  // imutabilidade do React e é o padrão que os outros dialogs do projeto já seguem
  const onOpenChange = (next: boolean) => {
    if (next) {
      const padrao = pipelines?.find(p => p.isDefault) ?? pipelines?.[0]
      setPipelineId(padrao?.id ?? '')
      // o primeiro estágio é onde um negócio novo nasce; sem isto o corretor escolheria duas vezes
      setStageId(padrao?.stages[0]?.id ?? '')
      setTitulo(`Atendimento — ${client.name}`)
      setValor('')
    }
    setOpen(next)
  }

  const trocarPipeline = (id: string | null) => {
    setPipelineId(id ?? '')
    setStageId(pipelines?.find(p => p.id === id)?.stages[0]?.id ?? '')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <Handshake />
            Adicionar ao funil
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adicionar ao funil</DialogTitle>
          <DialogDescription>
            Cria um negócio para {client.name}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="deal-titulo">Título</Label>
            <Input
              id="deal-titulo"
              value={titulo}
              onChange={e => setTitulo(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Funil</Label>
            <Select value={pipelineId} onValueChange={trocarPipeline}>
              <SelectTrigger className="w-full">
                {/* sem a função, o Base UI mostra o valor cru — aqui, o cuid do funil */}
                <SelectValue placeholder="Escolha o funil">
                  {(v: string) => pipelines?.find(p => p.id === v)?.name ?? ''}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {pipelines?.map(p => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Estágio</Label>
            <Select value={stageId} onValueChange={v => setStageId(v ?? '')}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Escolha o estágio">
                  {(v: string) => pipeline?.stages.find(s => s.id === v)?.name ?? ''}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {pipeline?.stages.map(s => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="deal-valor">Valor (opcional)</Label>
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
                R$
              </span>
              <Input
                id="deal-valor"
                inputMode="numeric"
                placeholder="0,00"
                className="pl-9 text-right tabular-nums"
                value={valor}
                onChange={e => setValor(formatCurrencyInput(e.target.value))}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={() =>
              criar.mutate(
                {
                  title: titulo.trim(),
                  clientId: client.id,
                  pipelineId,
                  stageId,
                  value: parseCurrencyInput(valor) ?? null,
                },
                {
                  onSuccess: () => {
                    toast.success('Negócio criado no funil')
                    setOpen(false)
                  },
                  onError: () =>
                    toast.error('Não foi possível criar o negócio'),
                },
              )
            }
            disabled={
              !titulo.trim() || !pipelineId || !stageId || criar.isPending
            }
          >
            Criar negócio
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
