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
 * Arrastar cartão no kanban, com o mesmo código para mouse, dedo e caneta.
 *
 * Substituiu o drag-and-drop nativo do HTML5, que **não emite evento nenhum em touch**. O tipo de
 * entrada vem do `pointerType` do evento, não da largura da tela: um iPad em paisagem passa dos
 * 768px do `useIsMobile` e continua sendo toque.
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
  onDrop: (dealId: string, stageId: string) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) => {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
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
    setOverStage(null);
    setGhost(null);
  }, []);

  const stageSob = (x: number, y: number) =>
    (document.elementFromPoint(x, y)?.closest("[data-stage-id]") as HTMLElement | null)?.dataset
      .stageId ?? null;

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
    setOverStage(stageSob(x, y));
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

      setGhost({ dealId: inicio.id, x: e.clientX, y: e.clientY });
      setOverStage(stageSob(e.clientX, e.clientY));
      acompanharBorda(e.clientX);
    };

    const soltar = (e: PointerEvent) => {
      const id = armado.current?.id;
      const estavaArrastando = arrastando.current;
      const destino = estavaArrastando ? stageSob(e.clientX, e.clientY) : null;

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
    overStage,
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
