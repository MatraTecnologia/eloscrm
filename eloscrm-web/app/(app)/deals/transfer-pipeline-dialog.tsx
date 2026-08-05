'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useUpdateDeal } from '@/lib/queries/deals'
import { usePipelines } from '@/lib/queries/pipelines'
import type { Deal } from '@/lib/types'
import { ArrowRight } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

/**
 * Transferir o negócio para outro funil.
 *
 * Não dá para reaproveitar o `MoveDealMenu`: ele lista os estágios do funil aberto, e aqui o destino
 * é justamente outro funil — a lista vem de `usePipelines`, não das props da tela.
 *
 * Escolher o estágio de destino é obrigatório e não tem default silencioso além do primeiro: a API
 * recusa a troca sem ele, porque um negócio apontando para estágio de outro funil sumiria de todas
 * as colunas do kanban.
 */
export const TransferPipelineDialog = ({
  deal,
  currentPipelineId,
  open,
  onOpenChange,
  onTransferred,
}: {
  deal: Deal
  currentPipelineId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onTransferred?: () => void
}) => {
  const { data: pipelines } = usePipelines()
  const update = useUpdateDeal()

  const destinos = (pipelines ?? []).filter(p => p.id !== currentPipelineId)
  const [pipelineId, setPipelineId] = useState('')
  const [stageId, setStageId] = useState('')

  const destino = destinos.find(p => p.id === pipelineId)
  const estagios = [...(destino?.stages ?? [])].sort(
    (a, b) => a.position - b.position,
  )

  // trocar o funil invalida o estágio escolhido antes: ele pertencia ao outro
  const escolherPipeline = (id: string) => {
    setPipelineId(id)
    const primeiro = pipelines?.find(p => p.id === id)?.stages
    setStageId(
      [...(primeiro ?? [])].sort((a, b) => a.position - b.position)[0]?.id ??
        '',
    )
  }

  const transferir = async () => {
    if (!pipelineId || !stageId) return
    try {
      await update.mutateAsync({ id: deal.id, input: { pipelineId, stageId } })
      toast.success(`Negócio transferido para ${destino?.name}`)
      onOpenChange(false)
      onTransferred?.()
    } catch {
      toast.error('Não foi possível transferir o negócio')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        // reabrir não pode trazer o destino da vez anterior
        if (next) {
          setPipelineId('')
          setStageId('')
        }
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Transferir de funil</DialogTitle>
        </DialogHeader>

        {destinos.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Esta imobiliária só tem um funil. Crie outro para poder transferir
            negócios entre eles.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="transfer-pipeline">Funil de destino</Label>
              <Select
                value={pipelineId}
                onValueChange={v => escolherPipeline(v ?? '')}
              >
                <SelectTrigger id="transfer-pipeline" className="w-full">
                  {/* sem a função, o Base UI mostra o valor cru — aqui, o cuid do funil */}
                  <SelectValue placeholder="Escolha o funil">
                    {(v: string) => destinos.find(p => p.id === v)?.name ?? ''}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {destinos.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="transfer-stage">Estágio de entrada</Label>
              <Select
                value={stageId}
                onValueChange={v => setStageId(v ?? '')}
                disabled={!pipelineId}
              >
                <SelectTrigger id="transfer-stage" className="w-full">
                  <SelectValue placeholder="Escolha o estágio">
                    {(v: string) => estagios.find(s => s.id === v)?.name ?? ''}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {estagios.map(stage => (
                    <SelectItem key={stage.id} value={stage.id}>
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ background: stage.color ?? 'var(--chart-1)' }}
                      />
                      {stage.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <p className="text-xs text-muted-foreground">
              O histórico do negócio guarda a transferência; atividades,
              comentários e arquivos seguem com ele.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={transferir}
            disabled={!pipelineId || !stageId || update.isPending}
          >
            <ArrowRight className="size-4" />
            {update.isPending ? 'Transferindo…' : 'Transferir'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
