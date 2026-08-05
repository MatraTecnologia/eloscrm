"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Espera antes de um toque virar arraste. Abaixo disso, o dedo ainda está rolando ou tocando. */
const LONG_PRESS_MS = 250;

/** Movimento que cancela o long-press: quem mexeu o dedo antes do tempo queria rolar. */
const TOLERANCIA_PX = 10;

/** Com o mouse não há ambiguidade com scroll, mas 4px evita que um clique trêmulo vire arraste. */
const LIMIAR_MOUSE_PX = 4;

/** Faixa junto às bordas que dispara o auto-scroll horizontal. */
const BORDA_PX = 72;
const PASSO_PX = 12;

/**
 * Arrastar cartão no kanban, com o mesmo código para mouse, dedo e caneta.
 *
 * Antes isto usava o drag-and-drop nativo do HTML5 (`draggable` + `onDragStart`), que **não emite
 * evento nenhum em touch** — o kanban simplesmente não funcionava em celular e tablet. Pointer
 * Events cobrem os três tipos de entrada com os mesmos handlers, então não existe um caminho para
 * mouse e outro para dedo se desencontrando com o tempo.
 *
 * O tipo de entrada é decidido pelo `pointerType` do próprio evento, e não pela largura da tela:
 * um iPad em paisagem passa de 768px e continua sendo toque.
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

  const comecar = (id: string) => {
    arrastando.current = true;
    setDragId(id);
  };

  const onPointerDown = (e: React.PointerEvent, dealId: string) => {
    // só botão principal; o secundário abre menu de contexto
    if (e.button !== 0) return;
    const touch = e.pointerType !== "mouse";
    armado.current = { id: dealId, x: e.clientX, y: e.clientY, touch };
    e.currentTarget.setPointerCapture(e.pointerId);

    // no toque, o arraste só nasce de um long-press: o dedo parado distingue "quero mover" de
    // "quero rolar a coluna", e é o que permite manter `touch-action: pan-y` no cartão
    if (touch) {
      timer.current = setTimeout(() => comecar(dealId), LONG_PRESS_MS);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const inicio = armado.current;
    if (!inicio) return;

    const dx = Math.abs(e.clientX - inicio.x);
    const dy = Math.abs(e.clientY - inicio.y);

    if (!arrastando.current) {
      // mexeu o dedo antes do tempo: era rolagem, não arraste
      if (inicio.touch) {
        if (dx > TOLERANCIA_PX || dy > TOLERANCIA_PX) limpar();
        return;
      }
      if (dx > LIMIAR_MOUSE_PX || dy > LIMIAR_MOUSE_PX) comecar(inicio.id);
      return;
    }

    // com o arraste em curso, o movimento é nosso: sem isto o navegador ainda tenta rolar
    e.preventDefault();
    setOverStage(stageSob(e.clientX, e.clientY));
    acompanharBorda(e.clientX);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const inicio = armado.current;
    const estavaArrastando = arrastando.current;
    const destino = estavaArrastando ? stageSob(e.clientX, e.clientY) : null;
    const id = inicio?.id;

    limpar();

    if (estavaArrastando) {
      // o `click` vem logo depois e abriria o dialog do negócio recém-movido
      acabouDeArrastar.current = true;
      setTimeout(() => {
        acabouDeArrastar.current = false;
      }, 0);
      if (id && destino) onDrop(id, destino);
    }
  };

  /** Usado em `onClickCapture` no cartão: engole o clique que fecha um arraste. */
  const bloquearCliquePosArraste = (e: React.MouseEvent) => {
    if (!acabouDeArrastar.current) return;
    e.preventDefault();
    e.stopPropagation();
  };

  return {
    dragId,
    overStage,
    bloquearCliquePosArraste,
    cardProps: (dealId: string) => ({
      onPointerDown: (e: React.PointerEvent) => onPointerDown(e, dealId),
      onPointerMove,
      onPointerUp,
      onPointerCancel: limpar,
      onClickCapture: bloquearCliquePosArraste,
    }),
  };
};
