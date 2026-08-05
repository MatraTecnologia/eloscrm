"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Espera antes de um toque virar arraste. Abaixo disso, o dedo ainda está rolando ou tocando. */
const LONG_PRESS_MS = 220;

/** Movimento que cancela o long-press: quem mexeu o dedo antes do tempo queria rolar. */
const TOLERANCIA_PX = 10;

/** Com o mouse não há ambiguidade com scroll, mas 4px evita que um clique trêmulo vire arraste. */
const LIMIAR_MOUSE_PX = 4;

/** Faixa junto às bordas que dispara o auto-scroll horizontal. */
const BORDA_PX = 72;
const PASSO_PX = 14;

export type DragGhost = { dealId: string; x: number; y: number };

/**
 * Onde o cartão pode cair: uma coluna do funil aberto ou outro funil da lista lateral — soltar
 * sobre um funil manda o negócio para o primeiro estágio dele.
 */
export type DropTarget = { tipo: "stage"; id: string } | { tipo: "pipeline"; id: string };

/**
 * Arrastar cartão no kanban, com o mesmo código para mouse, dedo e caneta.
 *
 * Substituiu o drag-and-drop nativo do HTML5, que **não emite evento nenhum em touch**. O tipo de
 * entrada vem do `pointerType` do evento, não da largura da tela — largura não diz se existe
 * mouse, e é por isso que nem o `useIsMobile` nem um breakpoint serviriam aqui.
 *
 * **O gesto é acompanhado pelo `document`, não pelo cartão.** Essa é a decisão que sustenta o
 * resto: soltar o cartão numa coluna nova faz o React desmontar o elemento de origem, e um
 * `onPointerUp` preso a ele nunca dispararia. O arraste ficava eternamente "em curso", o bloqueio
 * de rolagem nunca era desfeito, e a tela só voltava a rolar depois de arrastar outro cartão —
 * que rodava a limpeza atrasada. Ouvir no documento torna o fim do gesto independente de quem
 * continua na tela.
 */
export const useKanbanDrag = ({
  onDrop,
  scrollRef,
}: {
  onDrop: (dealId: string, alvo: DropTarget) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) => {
  const [dragId, setDragId] = useState<string | null>(null);
  const [alvo, setAlvo] = useState<DropTarget | null>(null);
  /** Posição do cartão que acompanha o ponteiro. Sem ele, arrastar não mostra nada acontecendo. */
  const [ghost, setGhost] = useState<DragGhost | null>(null);

  const armado = useRef<{ id: string; x: number; y: number; touch: boolean } | null>(null);
  const arrastando = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoScroll = useRef<number | null>(null);
  // um arraste termina em `click` no cartão; sem esta marca, soltar abriria o dialog do negócio
  const acabouDeArrastar = useRef(false);
  // o callback pode mudar entre renders, e os listeners do documento são registrados uma vez só.
  // A atualização vai em efeito, não no corpo: escrever ref durante o render é o que a regra
  // `react-hooks/refs` do projeto barra.
  const onDropRef = useRef(onDrop);
  useEffect(() => {
    onDropRef.current = onDrop;
  }, [onDrop]);

  const pararAutoScroll = () => {
    if (autoScroll.current !== null) cancelAnimationFrame(autoScroll.current);
    autoScroll.current = null;
  };

  const limpar = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    armado.current = null;
    arrastando.current = false;
    pararAutoScroll();
    setDragId(null);
    setAlvo(null);
    setGhost(null);
  }, []);

  /**
   * Coluna primeiro, funil depois: os dois nunca se sobrepõem na tela, mas a ordem deixa explícito
   * que soltar dentro do quadro é sempre mover de estágio. O `data-pipeline-id` fica em cada item
   * da lista, nunca no `aside` — no elemento de fora, soltar em qualquer sobra de espaço do painel
   * viraria transferência.
   */
  const alvoSob = (x: number, y: number): DropTarget | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const stage = el?.closest("[data-stage-id]") as HTMLElement | null;
    if (stage?.dataset.stageId) return { tipo: "stage", id: stage.dataset.stageId };
    const pipeline = el?.closest("[data-pipeline-id]") as HTMLElement | null;
    if (pipeline?.dataset.pipelineId) return { tipo: "pipeline", id: pipeline.dataset.pipelineId };
    return null;
  };

  /**
   * Rola a faixa de colunas quando o ponteiro encosta na borda.
   *
   * Num celular de 375px uma coluna ocupa a tela inteira, então sem isto **não há como** levar um
   * cartão para o estágio seguinte — o destino nunca aparece.
   */
  const acompanharBorda = useCallback(
    (clientX: number) => {
      pararAutoScroll();
      const el = scrollRef.current;
      if (!el) return;

      const { left, right } = el.getBoundingClientRect();
      const direcao = clientX < left + BORDA_PX ? -1 : clientX > right - BORDA_PX ? 1 : 0;
      if (direcao === 0) return;

      const passo = () => {
        el.scrollLeft += direcao * PASSO_PX;
        autoScroll.current = requestAnimationFrame(passo);
      };
      autoScroll.current = requestAnimationFrame(passo);
    },
    [scrollRef],
  );

  const comecar = useCallback((id: string, x: number, y: number) => {
    arrastando.current = true;
    setDragId(id);
    setGhost({ dealId: id, x, y });
    setAlvo(alvoSob(x, y));
    // o dedo cobre o cartão: sem um aviso, não há como saber que a espera acabou
    navigator.vibrate?.(12);
  }, []);

  /**
   * Todo o acompanhamento do gesto vive aqui, preso ao documento e registrado uma vez só.
   *
   * O `touchmove` com `passive: false` é o único ponto onde dá para recusar a rolagem enquanto se
   * arrasta: `preventDefault` num handler do React não faz nada, porque o React os registra como
   * passivos e o `touch-action: pan-y` do cartão já autorizou o navegador a rolar.
   */
  useEffect(() => {
    const mover = (e: PointerEvent) => {
      const inicio = armado.current;
      if (!inicio) return;

      if (!arrastando.current) {
        const dx = Math.abs(e.clientX - inicio.x);
        const dy = Math.abs(e.clientY - inicio.y);
        // mexeu o dedo antes do tempo: era rolagem, não arraste
        if (inicio.touch) {
          if (dx > TOLERANCIA_PX || dy > TOLERANCIA_PX) limpar();
          return;
        }
        if (dx > LIMIAR_MOUSE_PX || dy > LIMIAR_MOUSE_PX) comecar(inicio.id, e.clientX, e.clientY);
        return;
      }

      const atual = alvoSob(e.clientX, e.clientY);
      setGhost({ dealId: inicio.id, x: e.clientX, y: e.clientY });
      setAlvo(atual);
      // sobre a lista de funis o auto-scroll não vale: no desktop ela fica à esquerda do quadro,
      // então o ponteiro está permanentemente dentro da faixa de borda e o kanban rolaria sozinho
      // enquanto se mira o funil de destino
      if (atual?.tipo === "pipeline") pararAutoScroll();
      else acompanharBorda(e.clientX);
    };

    const soltar = (e: PointerEvent) => {
      const id = armado.current?.id;
      const estavaArrastando = arrastando.current;
      const destino = estavaArrastando ? alvoSob(e.clientX, e.clientY) : null;

      limpar();
      if (!estavaArrastando) return;

      // o `click` vem logo depois e abriria o dialog do negócio recém-movido
      acabouDeArrastar.current = true;
      setTimeout(() => {
        acabouDeArrastar.current = false;
      }, 0);
      if (id && destino) onDropRef.current(id, destino);
    };

    const bloquearRolagem = (e: TouchEvent) => {
      if (arrastando.current) e.preventDefault();
    };

    document.addEventListener("pointermove", mover);
    document.addEventListener("pointerup", soltar);
    document.addEventListener("pointercancel", limpar);
    document.addEventListener("touchmove", bloquearRolagem, { passive: false });
    return () => {
      document.removeEventListener("pointermove", mover);
      document.removeEventListener("pointerup", soltar);
      document.removeEventListener("pointercancel", limpar);
      document.removeEventListener("touchmove", bloquearRolagem);
      limpar();
    };
  }, [acompanharBorda, comecar, limpar]);

  const onPointerDown = (e: React.PointerEvent, dealId: string) => {
    // só botão principal; o secundário abre menu de contexto
    if (e.button !== 0) return;
    const touch = e.pointerType !== "mouse";
    const { clientX: x, clientY: y } = e;
    armado.current = { id: dealId, x, y, touch };

    // sem `setPointerCapture`: capturar no cartão amarra o gesto a um elemento que pode desmontar
    // no meio do arraste, e é o documento que acompanha daqui em diante
    if (touch) timer.current = setTimeout(() => comecar(dealId, x, y), LONG_PRESS_MS);
  };

  return {
    dragId,
    // `overStage`/`overPipeline` separados, e não o alvo cru: o anel da coluna já compara por id no
    // quadro, e derivar aqui evita mexer no caminho de arraste que já funciona
    overStage: alvo?.tipo === "stage" ? alvo.id : null,
    overPipeline: alvo?.tipo === "pipeline" ? alvo.id : null,
    ghost,
    cardProps: (dealId: string) => ({
      onPointerDown: (e: React.PointerEvent) => onPointerDown(e, dealId),
      /** engole o clique que fecha um arraste, senão soltar abre o dialog do negócio */
      onClickCapture: (e: React.MouseEvent) => {
        if (!acabouDeArrastar.current) return;
        e.preventDefault();
        e.stopPropagation();
      },
    }),
  };
};
