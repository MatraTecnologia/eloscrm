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
import { useBulkTransferDeals } from '@/lib/queries/deals'
import { usePipelines } from '@/lib/queries/pipelines'
import type { Deal } from '@/lib/types'
import { ArrowRight } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

/**
 * Transferir negócios para outro funil — um ou vários, mesmo diálogo.
 *
 * Não dá para reaproveitar o `MoveDealMenu`: ele lista os estágios do funil aberto, e aqui o destino
 * é justamente outro funil — a lista vem de `usePipelines`, não das props da tela.
 *
 * Um negócio só também passa pelo endpoint de lote. As regras da transferência (limpar o motivo da
 * perda, gravar funil e estágio no histórico) ficam então num lugar só, no servidor, em vez de
 * existirem em duas versões que precisam concordar.
 */
export const TransferPipelineDialog = ({
  deals,
  currentPipelineId,
  open,
  onOpenChange,
  onTransferred,
}: {
  deals: Deal[]
  currentPipelineId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onTransferred?: () => void
}) => {
  const { data: pipelines } = usePipelines()
  const transfer = useBulkTransferDeals()

  const destinos = (pipelines ?? []).filter(p => p.id !== currentPipelineId)
  const [pipelineId, setPipelineId] = useState('')
  const [stageId, setStageId] = useState('')

  const destino = destinos.find(p => p.id === pipelineId)
  const estagios = [...(destino?.stages ?? [])].sort(
    (a, b) => a.position - b.position,
  )
  const varios = deals.length > 1

  // trocar o funil invalida o estágio escolhido antes: ele pertencia ao outro
  const escolherPipeline = (id: string) => {
    setPipelineId(id)
    const stages = pipelines?.find(p => p.id === id)?.stages
    setStageId(
      [...(stages ?? [])].sort((a, b) => a.position - b.position)[0]?.id ?? '',
    )
  }

  const transferir = async () => {
    if (!pipelineId || !stageId || deals.length === 0) return
    try {
      const { transferred } = await transfer.mutateAsync({
        dealIds: deals.map(d => d.id),
        pipelineId,
        stageId,
      })
      toast.success(
        transferred === 1
          ? `Negócio transferido para ${destino?.name}`
          : `${transferred} negócios transferidos para ${destino?.name}`,
      )
      onOpenChange(false)
      onTransferred?.()
    } catch {
      toast.error(
        varios
          ? 'Não foi possível transferir os negócios'
          : 'Não foi possível transferir o negócio',
      )
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
          <DialogTitle>
            {varios
              ? `Transferir ${deals.length} negócios de funil`
              : 'Transferir de funil'}
          </DialogTitle>
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
              {varios
                ? 'Todos entram no mesmo estágio. O histórico de cada negócio guarda a transferência; atividades, comentários e arquivos seguem com eles.'
                : 'O histórico do negócio guarda a transferência; atividades, comentários e arquivos seguem com ele.'}
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={transferir}
            disabled={!pipelineId || !stageId || transfer.isPending}
          >
            <ArrowRight className="size-4" />
            {transfer.isPending ? 'Transferindo…' : 'Transferir'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
