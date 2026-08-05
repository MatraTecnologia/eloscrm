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
 * Três coisas aqui existem por terem faltado na primeira versão e deixado o arraste inutilizável
 * no dedo — cada uma está comentada onde acontece: o `touchmove` não-passivo, o fantasma que
 * acompanha o ponteiro, e o aviso de que o long-press pegou.
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

  // refs porque os handlers de pointer leem isto fora do ciclo de render
  const armado = useRef<{ id: string; x: number; y: number; touch: boolean } | null>(null);
  const arrastando = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoScroll = useRef<number | null>(null);
  // um arraste termina em `click` no cartão; sem esta marca, soltar abriria o dialog do negócio
  const acabouDeArrastar = useRef(false);

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

  /**
   * O que faz o arraste no dedo funcionar de verdade.
   *
   * `preventDefault` num `onPointerMove` do React **não** cancela a rolagem: o React registra esses
   * listeners como passivos, e o `touch-action: pan-y` do cartão já autorizou o navegador a rolar.
   * O resultado era arrastar na diagonal e ver a coluna rolar em vez do cartão sair do lugar.
   *
   * Um `touchmove` próprio, com `passive: false`, é o único ponto onde dá para recusar a rolagem —
   * e só enquanto o arraste está em curso, para o toque comum continuar rolando normalmente.
   */
  useEffect(() => {
    const bloquearRolagem = (e: TouchEvent) => {
      if (arrastando.current) e.preventDefault();
    };
    document.addEventListener("touchmove", bloquearRolagem, { passive: false });
    return () => document.removeEventListener("touchmove", bloquearRolagem);
  }, []);

  useEffect(() => limpar, [limpar]);

  /**
   * Rola a faixa de colunas quando o ponteiro encosta na borda.
   *
   * Num celular de 375px uma coluna ocupa a tela inteira, então sem isto **não há como** levar um
   * cartão para o estágio seguinte — o destino nunca aparece.
   */
  const acompanharBorda = (clientX: number) => {
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
  };

  const stageSob = (x: number, y: number) =>
    (document.elementFromPoint(x, y)?.closest("[data-stage-id]") as HTMLElement | null)?.dataset
      .stageId ?? null;

  const comecar = (id: string, x: number, y: number) => {
    arrastando.current = true;
    setDragId(id);
    setGhost({ dealId: id, x, y });
    setOverStage(stageSob(x, y));
    // o dedo cobre o cartão: sem um aviso, não há como saber que a espera acabou e já dá para mover
    navigator.vibrate?.(12);
  };

  const onPointerDown = (e: React.PointerEvent, dealId: string) => {
    // só botão principal; o secundário abre menu de contexto
    if (e.button !== 0) return;
    const touch = e.pointerType !== "mouse";
    const { clientX: x, clientY: y } = e;
    armado.current = { id: dealId, x, y, touch };
    e.currentTarget.setPointerCapture(e.pointerId);

    // no toque o arraste nasce de um long-press: o dedo parado distingue "quero mover" de "quero
    // rolar a coluna", e é o que permite manter `touch-action: pan-y` no cartão
    if (touch) timer.current = setTimeout(() => comecar(dealId, x, y), LONG_PRESS_MS);
  };

  const onPointerMove = (e: React.PointerEvent) => {
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

  const onPointerUp = (e: React.PointerEvent) => {
    const inicio = armado.current;
    const estavaArrastando = arrastando.current;
    const destino = estavaArrastando ? stageSob(e.clientX, e.clientY) : null;
    const id = inicio?.id;

    limpar();

    if (!estavaArrastando) return;

    // o `click` vem logo depois e abriria o dialog do negócio recém-movido
    acabouDeArrastar.current = true;
    setTimeout(() => {
      acabouDeArrastar.current = false;
    }, 0);
    if (id && destino) onDrop(id, destino);
  };

  return {
    dragId,
    overStage,
    ghost,
    cardProps: (dealId: string) => ({
      onPointerDown: (e: React.PointerEvent) => onPointerDown(e, dealId),
      onPointerMove,
      onPointerUp,
      onPointerCancel: limpar,
      /** engole o clique que fecha um arraste, senão soltar abre o dialog do negócio */
      onClickCapture: (e: React.MouseEvent) => {
        if (!acabouDeArrastar.current) return;
        e.preventDefault();
        e.stopPropagation();
      },
    }),
  };
};
