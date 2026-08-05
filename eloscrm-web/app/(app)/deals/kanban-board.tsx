"use client";

import { useRef, useState } from "react";
import { ArrowRightLeft, Building2, Plus, Settings2, Trash2, User } from "lucide-react";
import { WhatsappIcon } from "@/components/icons/whatsapp";
import { toast } from "sonner";
import { useDeals, useDeleteDeal, useUpdateDeal } from "@/lib/queries/deals";
import { useClients } from "@/lib/queries/clients";
import { useMembers } from "@/lib/queries/members";
import { useProperties } from "@/lib/queries/properties";
import { formatCurrency, formatPhone } from "@/lib/labels";
import type { Deal, Pipeline, Stage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { DealDetailDialog } from "./deal-detail-dialog";
import { DealFormDialog } from "./deal-form-dialog";
import { LostReasonDialog } from "./lost-reason-dialog";
import { MoveDealMenu } from "./move-deal-menu";
import { useKanbanDrag } from "./use-kanban-drag";
import { StageManagerDialog } from "./stage-manager-dialog";
import { TransferPipelineDialog } from "./transfer-pipeline-dialog";

export const KanbanBoard = ({ pipeline }: { pipeline: Pipeline }) => {
  const { data: deals, isLoading } = useDeals(pipeline.id);
  const { data: clients } = useClients({ status: "ALL" });
  const { data: members } = useMembers();
  const { data: properties } = useProperties();
  const move = useUpdateDeal();
  const remove = useDeleteDeal();
  // negócio arrastado para estágio de perda espera aqui até alguém dizer o motivo
  const [pendingLoss, setPendingLoss] = useState<{ deal: Deal; stage: Stage } | null>(null);
  const [marcados, setMarcados] = useState<string[]>([]);
  const [transferindoLote, setTransferindoLote] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const stages = [...pipeline.stages].sort((a, b) => a.position - b.position);

  // A seleção é filtrada pelos negócios em tela, não guardada como verdade: trocar de funil no
  // painel ao lado não desmonta este componente, e negócio transferido some da lista. Derivar no
  // render evita a barra dizendo "3 selecionados" de cartões que não estão mais aqui.
  const selecionados = (deals ?? []).filter((deal) => marcados.includes(deal.id));
  const alternarMarcado = (id: string) =>
    setMarcados((atual) =>
      atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id],
    );
  const clientsById = new Map((clients ?? []).map((c) => [c.id, c] as const));
  const memberNames = new Map((members ?? []).map((m) => [m.userId, m.name] as const));
  const propertyTitles = new Map((properties ?? []).map((p) => [p.id, p.title] as const));

  const moveDeal = async (id: string, input: { stageId: string; lostReason?: string | null }) => {
    try {
      await move.mutateAsync({ id, input });
    } catch {
      toast.error("Não foi possível mover o negócio");
    }
  };

  /** Destino escolhido — por arraste ou pelo menu "Mover para". A regra é a mesma nos dois. */
  const enviarPara = async (id: string, stageId: string) => {
    const deal = deals?.find((d) => d.id === id);
    if (!deal || deal.stageId === stageId) return;

    const target = stages.find((stage) => stage.id === stageId);
    const from = stages.find((stage) => stage.id === deal.stageId);
    if (target?.isLost) {
      setPendingLoss({ deal, stage: target });
      return;
    }
    // saiu da perda: o motivo antigo deixaria o negócio reaberto carregando um "perdido porque…"
    // que não vale mais. O texto continua no histórico.
    const reopened = from?.isLost && deal.lostReason ? { lostReason: null } : {};
    await moveDeal(id, { stageId, ...reopened });
  };

  const { dragId, overStage, ghost, cardProps } = useKanbanDrag({ onDrop: enviarPara, scrollRef });
  const ghostDeal = ghost ? deals?.find((d) => d.id === ghost.dealId) : null;

  const handleDelete = async (deal: Deal) => {
    try {
      await remove.mutateAsync(deal.id);
      toast.success("Negócio removido");
    } catch {
      toast.error("Não foi possível remover o negócio");
    }
  };

  return (
    <div className="flex h-full min-w-0 flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{pipeline.name}</h2>
        <div className="flex gap-2">
          <StageManagerDialog
            pipeline={pipeline}
            trigger={
              <Button variant="outline">
                <Settings2 className="size-4" /> Gerenciar estágios
              </Button>
            }
          />
          <DealFormDialog
            pipelineId={pipeline.id}
            stages={stages}
            trigger={
              <Button>
                <Plus className="size-4" /> Novo negócio
              </Button>
            }
          />
        </div>
      </div>

      {selecionados.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
          <span className="text-sm font-medium">
            {selecionados.length === 1
              ? "1 negócio selecionado"
              : `${selecionados.length} negócios selecionados`}
          </span>
          <div className="ms-auto flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setMarcados([])}>
              Limpar seleção
            </Button>
            <Button size="sm" onClick={() => setTransferindoLote(true)}>
              <ArrowRightLeft className="size-4" /> Transferir de funil
            </Button>
          </div>
        </div>
      )}

      <div ref={scrollRef} className="flex min-w-0 flex-1 gap-3 overflow-x-auto pb-2">
        {stages.map((stage) => {
          const stageDeals = deals?.filter((d) => d.stageId === stage.id) ?? [];
          const stageTotal = stageDeals.reduce((sum, deal) => sum + Number(deal.value ?? 0), 0);
          return (
            <div
              key={stage.id}
              // o hit-test do arraste acha a coluna por este atributo, com elementFromPoint —
              // não há mais onDragOver/onDrop, que só existiam para mouse
              data-stage-id={stage.id}
              className={cn(
                "flex w-72 shrink-0 flex-col rounded-xl bg-muted/40 transition-shadow",
                overStage === stage.id && "ring-2 ring-primary ring-inset",
              )}
            >
              <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: stage.color ?? "var(--chart-1)" }}
                  />
                  <span className="truncate text-sm font-medium">{stage.name}</span>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {stageTotal > 0 && (
                    <span className="text-xs text-muted-foreground">{formatCurrency(stageTotal)}</span>
                  )}
                  <span className="rounded bg-background px-1.5 text-xs text-muted-foreground">
                    {stageDeals.length}
                  </span>
                </div>
              </div>
              <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
                {isLoading && <Skeleton className="h-16 w-full" />}
                {!isLoading && stageDeals.length === 0 && (
                  <div className="rounded-lg border border-dashed py-6 text-center text-xs text-muted-foreground">
                    Nenhum negócio neste estágio
                  </div>
                )}
                {stageDeals.map((deal) => {
                  const client = clientsById.get(deal.clientId);
                  const ownerName = deal.ownerId ? memberNames.get(deal.ownerId) : null;
                  const propertyTitle = deal.propertyId ? propertyTitles.get(deal.propertyId) : null;
                  return (
                    // o botão de excluir fica fora do trigger do DealDetailDialog: aninhar um trigger
                    // dentro do outro faria o clique na lixeira abrir também o modal do negócio
                    <div key={deal.id} className="group/card relative">
                      <DealDetailDialog
                        pipelineId={pipeline.id}
                        stages={stages}
                        deal={deal}
                        nativeButton={false}
                        trigger={
                          <div
                            {...cardProps(deal.id)}
                            // `pan-y` deixa a coluna rolar com o dedo começando no cartão e ainda
                            // assim entrega o movimento do arraste; `none` mataria a rolagem, que
                            // é a maior parte do uso
                            style={{ touchAction: "pan-y" }}
                            className={cn(
                              // `pt-10` reserva a faixa dos controles, que ficam numa linha própria
                              // acima do título: sobrepostos ao nome, eles disputavam a mesma linha
                              // e o texto encolhia para caber
                              "cursor-grab touch-pan-y rounded-lg border bg-card p-3 pt-10 shadow-sm transition-colors select-none hover:border-primary/50 active:cursor-grabbing",
                              dragId === deal.id && "opacity-30",
                              // a caixa marcada é pequena para uma coluna cheia; a borda diz de
                              // longe quais cartões vão junto na transferência
                              marcados.includes(deal.id) && "border-primary ring-1 ring-primary",
                            )}
                          >
                            {/* espaço para os três controles do canto: marcar, mover e excluir */}
                            <div className="text-sm font-medium">{deal.title}</div>
                            {client && (
                              <div className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
                                <User className="size-3 shrink-0" />
                                <span className="truncate">{client.name}</span>
                              </div>
                            )}
                            {client?.phone && (
                              // lead que entra pelo WhatsApp só tem nome e telefone; sem ele no
                              // card, falar com a pessoa exige abrir o negócio e depois a ficha.
                              // Aqui é só exibição: o card inteiro é o gatilho do negócio e a área
                              // do arraste, então um link dentro competiria com os dois.
                              <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                                <WhatsappIcon className="size-3 shrink-0" />
                                <span className="truncate tabular-nums">
                                  {formatPhone(client.phone)}
                                </span>
                              </div>
                            )}
                            {propertyTitle && (
                              <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                                <Building2 className="size-3 shrink-0" />
                                <span className="truncate">{propertyTitle}</span>
                              </div>
                            )}
                            <div className="mt-1.5 flex items-center justify-between gap-2">
                              {/* != null e não truthy: valor 0 é um valor definido, só ausente é undefined */}
                              <span className="text-xs font-medium">
                                {deal.value != null ? formatCurrency(deal.value) : ""}
                              </span>
                              {ownerName && (
                                // só as iniciais: o nome inteiro empurraria o valor para fora do card
                                <span
                                  title={ownerName}
                                  className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground"
                                >
                                  {ownerName
                                    .split(" ")
                                    .slice(0, 2)
                                    .map((part) => part[0])
                                    .join("")
                                    .toUpperCase()}
                                </span>
                              )}
                            </div>
                            {stage.isLost && deal.lostReason && (
                              <p className="mt-1.5 line-clamp-2 border-t pt-1.5 text-xs text-muted-foreground">
                                {deal.lostReason}
                              </p>
                            )}
                          </div>
                        }
                      />
                      {/* Faixa de controles, irmã do trigger e nunca filha: aninhado, o clique de
                          marcar ou excluir abriria também o negócio. Como irmã, o `pointerdown`
                          também não chega ao cartão e não arma o arraste. Fica sobre o `pt-10` que
                          o cartão reserva, então nada disputa espaço com o título. */}
                      <div className="absolute inset-x-2 top-1.5 z-10 flex items-center gap-1">
                        <label
                          // rótulo em volta da caixa: no celular, acertar 18px de quadradinho é
                          // frustrante. Com o `label` e a área extra que o próprio checkbox já
                          // reserva, o alvo passa de 30x26 — e vira 100px quando está marcado,
                          // porque aí o texto "Selecionado" também alterna
                          className={cn(
                            "flex cursor-pointer items-center gap-1.5 rounded-md py-1 pe-2 ps-1 text-xs transition-opacity",
                            "opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within/card:opacity-100 [@media(hover:hover)]:group-hover/card:opacity-100",
                            // com algo selecionado, todas as caixas ficam à vista: esconder as
                            // demais no mouse deixaria o corretor sem ver o que dá para incluir
                            selecionados.length > 0 && "[@media(hover:hover)]:opacity-100",
                            marcados.includes(deal.id)
                              ? "text-primary"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          <Checkbox
                            checked={marcados.includes(deal.id)}
                            onCheckedChange={() => alternarMarcado(deal.id)}
                            aria-label={`Selecionar ${deal.title}`}
                            className="size-[18px] rounded-[5px] bg-card"
                          />
                          {marcados.includes(deal.id) && (
                            <span className="font-medium">Selecionado</span>
                          )}
                        </label>

                        <div className="ms-auto flex items-center gap-0.5">
                          <MoveDealMenu
                            deal={deal}
                            stages={stages}
                            onMove={(stageId) => enviarPara(deal.id, stageId)}
                          />
                          <AlertDialog>
                            <AlertDialogTrigger
                              render={
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={`Excluir ${deal.title}`}
                                  className="opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within/card:opacity-100 [@media(hover:hover)]:group-hover/card:opacity-100"
                                >
                                  <Trash2 className="size-3.5 text-destructive" />
                                </Button>
                              }
                            />
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Excluir negócio</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Tem certeza que deseja excluir &quot;{deal.title}&quot;? Essa ação
                                  não pode ser desfeita.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                <AlertDialogAction
                                  variant="destructive"
                                  onClick={() => handleDelete(deal)}
                                >
                                  Excluir
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {ghost && ghostDeal && (
        // fora do fluxo e sem capturar ponteiro: `elementFromPoint` precisa enxergar a coluna por
        // baixo, senão o alvo do arraste seria sempre o próprio fantasma
        <div
          className="pointer-events-none fixed z-50 w-64 -translate-x-1/2 -translate-y-1/2 rotate-2 rounded-lg border bg-card p-3 shadow-lg"
          style={{ left: ghost.x, top: ghost.y }}
        >
          <div className="text-sm font-medium">{ghostDeal.title}</div>
          {ghostDeal.value != null && (
            <div className="mt-1 text-xs font-medium">{formatCurrency(ghostDeal.value)}</div>
          )}
        </div>
      )}

      <TransferPipelineDialog
        deals={selecionados}
        currentPipelineId={pipeline.id}
        open={transferindoLote}
        onOpenChange={setTransferindoLote}
        onTransferred={() => setMarcados([])}
      />

      {pendingLoss && (
        <LostReasonDialog
          open
          dealTitle={pendingLoss.deal.title}
          stageName={pendingLoss.stage.name}
          saving={move.isPending}
          onCancel={() => setPendingLoss(null)}
          onConfirm={async (reason) => {
            const { deal, stage } = pendingLoss;
            setPendingLoss(null);
            await moveDeal(deal.id, { stageId: stage.id, lostReason: reason });
          }}
        />
      )}
    </div>
  );
};
