'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  useAddStage,
  useDeleteStage,
  useReorderStages,
  useUpdateStage,
} from '@/lib/queries/pipelines'
import type { Pipeline } from '@/lib/types'
import { cn } from '@/lib/utils'
import { ArrowDown, ArrowUp, Plus, Trash2, Trophy, XCircle } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

export const StageManagerDialog = ({
  pipeline,
  trigger,
}: {
  pipeline: Pipeline
  trigger: React.ReactNode
}) => {
  const [open, setOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const addStage = useAddStage()
  const updateStage = useUpdateStage()
  const deleteStage = useDeleteStage()
  const reorder = useReorderStages()

  const stages = [...pipeline.stages].sort((a, b) => a.position - b.position)

  const add = async () => {
    if (!newName.trim()) return
    try {
      await addStage.mutateAsync({
        pipelineId: pipeline.id,
        input: { name: newName.trim() },
      })
      setNewName('')
    } catch {
      toast.error('Não foi possível adicionar o estágio')
    }
  }

  const rename = async (id: string, name: string, current: string) => {
    if (!name.trim() || name.trim() === current) return
    try {
      await updateStage.mutateAsync({ id, input: { name: name.trim() } })
    } catch {
      toast.error('Não foi possível renomear')
    }
  }

  const move = async (index: number, dir: -1 | 1) => {
    const target = index + dir
    if (target < 0 || target >= stages.length) return
    const ids = stages.map(s => s.id)
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    await reorder.mutateAsync({ pipelineId: pipeline.id, stageIds: ids })
  }

  const remove = async (id: string) => {
    try {
      await deleteStage.mutateAsync(id)
    } catch (e) {
      const code = (e as { code?: string })?.code
      toast.error(
        code === 'STAGE_HAS_DEALS'
          ? 'Mova os negócios deste estágio antes de excluir'
          : code === 'LAST_STAGE'
            ? 'O pipeline precisa de ao menos um estágio'
            : 'Não foi possível excluir',
      )
    }
  }

  const toggleFlag = async (
    id: string,
    field: 'isWon' | 'isLost',
    value: boolean,
  ) => {
    const patch =
      field === 'isWon'
        ? { isWon: value, isLost: false }
        : { isLost: value, isWon: false }
    await updateStage.mutateAsync({ id, input: patch })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        // o nome do novo estágio é rascunho: não deve sobreviver ao fechar
        if (next) setNewName('')
        setOpen(next)
      }}
    >
      <DialogTrigger
        render={trigger as React.ReactElement<Record<string, unknown>>}
      />
      {/* O popup rola por padrão (`overflow-y-auto`), o que empurrava o campo de novo estágio para
          fora da tela em funil com muitos estágios — justamente o caso em que se quer adicionar
          mais um. Aqui quem rola é só a lista: `overflow-y-hidden` desliga a rolagem do popup
          (mesmo grupo do utilitário padrão, senão não sobrescreve) e o flex-col dá ao meio uma
          altura que pode encolher. */}
      <DialogContent className="flex max-h-[85dvh] flex-col gap-4 overflow-y-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Estágios de {pipeline.name}</DialogTitle>
        </DialogHeader>
        {/* `ScrollArea` e não um `overflow-y-auto` qualquer: é ele que marca de que lado ainda há
            conteúdo escondido, e é disso que o `scroll-fade` vive. */}
        <ScrollArea className="-mr-2 min-h-0 flex-1 scroll-fade">
          <div className="space-y-2 pr-3">
            {stages.map((stage, i) => (
              <div
                key={stage.id}
                className="flex items-center gap-2 rounded-lg border p-2"
              >
                <div className="flex flex-col">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                  >
                    <ArrowUp className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    onClick={() => move(i, 1)}
                    disabled={i === stages.length - 1}
                  >
                    <ArrowDown className="size-3.5" />
                  </Button>
                </div>
                <Input
                  defaultValue={stage.name}
                  className="h-8 flex-1"
                  onBlur={e => rename(stage.id, e.target.value, stage.name)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  }}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn('size-8', stage.isWon && 'text-success')}
                  title="Marcar como ganho"
                  onClick={() => toggleFlag(stage.id, 'isWon', !stage.isWon)}
                >
                  <Trophy className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn('size-8', stage.isLost && 'text-destructive')}
                  title="Marcar como perdido"
                  onClick={() => toggleFlag(stage.id, 'isLost', !stage.isLost)}
                >
                  <XCircle className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={() => remove(stage.id)}
                >
                  <Trash2 className="size-4 text-muted-foreground" />
                </Button>
              </div>
            ))}
          </div>
        </ScrollArea>
        <div className="flex shrink-0 gap-2 border-t pt-4">
          <Input
            placeholder="Novo estágio"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') add()
            }}
          />
          <Button
            onClick={add}
            disabled={!newName.trim() || addStage.isPending}
          >
            <Plus className="size-4" /> Adicionar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
