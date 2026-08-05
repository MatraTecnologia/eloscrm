'use client'

import { ActivityDialog } from '@/components/app/activity-dialog'
import { ActivityTimeline } from '@/components/app/activity-timeline'
import { AttachmentsPanel } from '@/components/app/attachments-panel'
import { AuditFeed } from '@/components/app/audit-feed'
import { CommentFeed } from '@/components/app/comment-feed'
import { UnifiedTimeline } from '@/components/app/unified-timeline'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatCurrency, formatPhone, whatsappUrl } from '@/lib/labels'
import { useActivities } from '@/lib/queries/activities'
import { useClients } from '@/lib/queries/clients'
import { useMembers } from '@/lib/queries/members'
import { useProperties } from '@/lib/queries/properties'
import type { Deal, Stage } from '@/lib/types'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  ArrowRightLeft,
  Building2,
  CalendarPlus,
  ExternalLink,
  User,
} from 'lucide-react'
import { WhatsappIcon } from '@/components/icons/whatsapp'
import Link from 'next/link'
import { useState } from 'react'
import { DealForm } from './deal-form'
import { TransferPipelineDialog } from './transfer-pipeline-dialog'

const TAB_CLASS = 'data-active:text-primary after:bg-primary'

/**
 * Componente separado só para a busca ficar dentro da aba: o painel do Tabs não é montado enquanto
 * está escondido, então as atividades do negócio só são buscadas quando alguém abre a aba — e não
 * uma vez por card do kanban.
 */
const DealActivities = ({ deal }: { deal: Deal }) => {
  const { data: activities, isLoading } = useActivities({ dealId: deal.id })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Atividades</CardTitle>
        {/* CardAction e não flex solto: o CardHeader é grid e só abre a segunda coluna quando
            encontra um filho com data-slot=card-action */}
        <CardAction>
          <ActivityDialog
            defaultDealId={deal.id}
            defaultClientId={deal.clientId}
            trigger={
              <Button size="sm">
                <CalendarPlus className="size-4" /> Registrar atividade
              </Button>
            }
          />
        </CardAction>
      </CardHeader>
      <CardContent>
        <ActivityTimeline
          activities={activities ?? []}
          isLoading={isLoading}
          emptyMessage="Nenhuma atividade neste negócio."
        />
      </CardContent>
    </Card>
  )
}

export const DealDetailDialog = ({
  pipelineId,
  stages,
  deal,
  trigger,
  nativeButton,
}: {
  pipelineId: string
  stages: Stage[]
  deal: Deal
  trigger: React.ReactNode
  nativeButton?: boolean
}) => {
  const [open, setOpen] = useState(false)
  const [transferindo, setTransferindo] = useState(false)
  const { data: clients } = useClients({ status: 'ALL' })
  const { data: members } = useMembers()
  const { data: properties } = useProperties()

  const client = clients?.find(c => c.id === deal.clientId) ?? null
  const owner = members?.find(m => m.userId === deal.ownerId) ?? null
  const property = properties?.find(p => p.id === deal.propertyId) ?? null
  const stage = stages.find(s => s.id === deal.stageId) ?? null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        nativeButton={nativeButton}
        render={trigger as React.ReactElement<Record<string, unknown>>}
      />
      {/* o conteúdo do dialog é desmontado ao fechar (o portal do Base UI não fica montado), então
          formulário e abas nascem com o negócio atualizado a cada abertura */}
      <DialogContent className="gap-4 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="pr-8 text-base">{deal.title}</DialogTitle>
          <div className="flex flex-wrap items-center gap-2">
            {stage && (
              <Badge variant="outline" className="gap-1.5">
                <span
                  className="size-2 rounded-full"
                  style={{ background: stage.color ?? 'var(--chart-1)' }}
                />
                {stage.name}
              </Badge>
            )}
            <span className="text-sm font-medium">
              {formatCurrency(deal.value)}
            </span>
            <span className="text-xs text-muted-foreground">
              criado em{' '}
              {format(parseISO(deal.createdAt), 'dd/MM/yyyy', { locale: ptBR })}
            </span>
            {/* fica no cabeçalho, e não no formulário: trocar de funil não é editar um campo do
                negócio — é tirá-lo desta tela, já que o kanban aberto é de um funil só */}
            <Button
              variant="outline"
              size="sm"
              className="ms-auto"
              onClick={() => setTransferindo(true)}
            >
              <ArrowRightLeft className="size-3.5" /> Transferir de funil
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {client && (
              <Link
                href={`/clients/${client.id}`}
                className="flex items-center gap-1.5 hover:text-foreground hover:underline"
              >
                <User className="size-3.5" /> {client.name}
                <ExternalLink className="size-3" />
              </Link>
            )}
            {client?.phone && (
              // abre a conversa no WhatsApp, não a discagem: é por lá que o atendimento acontece,
              // e boa parte destes leads chegou justamente por mensagem
              <a
                href={whatsappUrl(client.phone)}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 hover:text-foreground hover:underline"
              >
                <WhatsappIcon className="size-3.5" />{' '}
                {formatPhone(client.phone)}
              </a>
            )}
            <span className="flex items-center gap-1.5">
              <Building2 className="size-3.5" />{' '}
              {property?.title ?? 'Sem imóvel vinculado'}
            </span>
            <span className="flex items-center gap-1.5">
              <User className="size-3.5" /> {owner?.name ?? 'Sem responsável'}
            </span>
          </div>
        </DialogHeader>

        <Tabs defaultValue="resumo">
          <TabsList variant="line">
            <TabsTrigger value="resumo" className={TAB_CLASS}>
              Resumo
            </TabsTrigger>
            <TabsTrigger value="atividades" className={TAB_CLASS}>
              Atividades
            </TabsTrigger>
            <TabsTrigger value="arquivos" className={TAB_CLASS}>
              Arquivos
            </TabsTrigger>
            <TabsTrigger value="comentarios" className={TAB_CLASS}>
              Comentários
            </TabsTrigger>
            <TabsTrigger value="historico" className={TAB_CLASS}>
              Histórico
            </TabsTrigger>
          </TabsList>

          <TabsContent value="resumo" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Dados do negócio</CardTitle>
              </CardHeader>
              <CardContent>
                <DealForm pipelineId={pipelineId} stages={stages} deal={deal} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Linha do tempo</CardTitle>
              </CardHeader>
              <CardContent>
                <UnifiedTimeline
                  entityType="DEAL"
                  entityId={deal.id}
                  limit={8}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="atividades" className="mt-4">
            <DealActivities deal={deal} />
          </TabsContent>

          <TabsContent value="arquivos" className="mt-4">
            <AttachmentsPanel entityType="DEAL" entityId={deal.id} />
          </TabsContent>

          <TabsContent value="comentarios" className="mt-4">
            <CommentFeed entityType="DEAL" entityId={deal.id} />
          </TabsContent>

          <TabsContent value="historico" className="mt-4">
            <AuditFeed entityType="DEAL" entityId={deal.id} />
          </TabsContent>
        </Tabs>

        {/* fechar o detalhe ao transferir não é cosmético: o card que renderiza este dialog pertence
            ao kanban do funil de origem e some no refetch, levando o dialog junto — melhor sair
            junto com a ação do que ser desmontado no meio dela */}
        <TransferPipelineDialog
          deals={[deal]}
          currentPipelineId={pipelineId}
          open={transferindo}
          onOpenChange={setTransferindo}
          onTransferred={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
