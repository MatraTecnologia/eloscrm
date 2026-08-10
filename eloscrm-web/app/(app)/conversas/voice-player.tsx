"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { formatMediaDuration } from "@/lib/labels";
import { cn } from "@/lib/utils";

const BARRAS = 32;
const ALTURA_UNIFORME = 35;
const VELOCIDADES = [1, 1.5, 2] as const;

/**
 * O WhatsApp já manda a onda desenhada: `waveform` é um base64 de bytes 0–100, um por fatia do
 * áudio, e é reamostrado aqui para as barras que cabem na bolha.
 *
 * Sem ela — o caso de todo áudio que sai daqui e dos `audio` que não são nota de voz — a trilha
 * fica uniforme em vez de inventar um desenho: onda falsa sugere um som que ninguém mediu.
 */
const decodeWaveform = (waveform: string | null): number[] => {
  const uniforme = () => Array.from({ length: BARRAS }, () => ALTURA_UNIFORME);
  if (!waveform) return uniforme();

  try {
    const bytes = Uint8Array.from(atob(waveform), (char) => char.charCodeAt(0));
    if (bytes.length === 0) return uniforme();

    return Array.from({ length: BARRAS }, (_, i) => {
      const inicio = Math.floor((i * bytes.length) / BARRAS);
      const fim = Math.max(inicio + 1, Math.floor(((i + 1) * bytes.length) / BARRAS));
      const fatia = bytes.subarray(inicio, fim);
      return fatia.reduce((soma, valor) => soma + valor, 0) / fatia.length;
    });
  } catch {
    // waveform de formato inesperado não pode derrubar a thread inteira
    return uniforme();
  }
};

export const VoicePlayer = ({
  src,
  duration,
  waveform,
}: {
  src: string;
  /** duração que veio no webhook: é o que dá para mostrar antes de o arquivo carregar */
  duration: number | null;
  waveform: string | null;
})  => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const trilhaRef = useRef<HTMLDivElement | null>(null);
  const [tocando, setTocando] = useState(false);
  const [atual, setAtual] = useState(0);
  const [total, setTotal] = useState(duration ?? 0);
  const [velocidade, setVelocidade] = useState<number>(1);

  // A URL da mídia é assinada e a thread se refaz sozinha em segundos. Trocar o `src` no meio da
  // reprodução faz o navegador recarregar o arquivo e voltar ao começo — o servidor já assina de
  // forma estável dentro de uma janela, e travar a fonte enquanto alguém está ouvindo fecha
  // também a virada de janela. Solta quando o áudio termina, para a próxima escuta pegar uma
  // assinatura fresca.
  const [fonteTravada, setFonteTravada] = useState<string | null>(null);

  const barras = useState(() => decodeWaveform(waveform))[0];
  const progresso = total > 0 ? Math.min(1, atual / total) : 0;

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = velocidade;
  }, [velocidade]);

  const alternar = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play();
    else audio.pause();
  };

  const irPara = (segundos: number) => {
    const audio = audioRef.current;
    if (!audio || total <= 0) return;
    const alvo = Math.max(0, Math.min(total, segundos));
    audio.currentTime = alvo;
    setAtual(alvo);
  };

  const seekPorPonteiro = (clientX: number) => {
    const trilha = trilhaRef.current;
    if (!trilha) return;
    const { left, width } = trilha.getBoundingClientRect();
    irPara(((clientX - left) / width) * total);
  };

  return (
    <div className="flex w-56 items-center gap-2 sm:w-64">
      <audio
        ref={audioRef}
        src={fonteTravada ?? src}
        preload="metadata"
        data-voice-player
        onPlay={() => {
          setTocando(true);
          setFonteTravada((travada) => travada ?? src);
          // um áudio por vez, como no WhatsApp: dois tocando juntos não é uso, é acidente
          document.querySelectorAll<HTMLAudioElement>("audio[data-voice-player]").forEach((outro) => {
            if (outro !== audioRef.current) outro.pause();
          });
        }}
        onPause={() => setTocando(false)}
        onTimeUpdate={(event) => setAtual(event.currentTarget.currentTime)}
        onEnded={() => {
          setTocando(false);
          setAtual(0);
          setFonteTravada(null);
        }}
        onLoadedMetadata={(event) => {
          // o ogg/opus do WhatsApp costuma reportar `Infinity` até tocar até o fim; a duração do
          // webhook é a única confiável nesse intervalo
          const real = event.currentTarget.duration;
          setTotal(Number.isFinite(real) && real > 0 ? real : (duration ?? 0));
        }}
      />

      <button
        type="button"
        aria-label={tocando ? "Pausar" : "Reproduzir"}
        onClick={alternar}
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-current/15 transition-colors hover:bg-current/25"
      >
        {tocando ? (
          <Pause className="size-4 fill-current" />
        ) : (
          // deslocado meio pixel: um triângulo centrado geometricamente parece torto para a esquerda
          <Play className="size-4 translate-x-px fill-current" />
        )}
      </button>

      <div
        ref={trilhaRef}
        role="slider"
        tabIndex={0}
        aria-label="Posição do áudio"
        aria-valuemin={0}
        aria-valuemax={Math.round(total)}
        aria-valuenow={Math.round(atual)}
        aria-valuetext={`${formatMediaDuration(Math.round(atual)) ?? "0:00"} de ${formatMediaDuration(Math.round(total)) ?? "0:00"}`}
        className="relative flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-0.5 outline-none focus-visible:ring-2 focus-visible:ring-current/40"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          seekPorPonteiro(event.clientX);
        }}
        onPointerMove={(event) => {
          if (event.buttons === 1) seekPorPonteiro(event.clientX);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") irPara(atual + 5);
          else if (event.key === "ArrowLeft") irPara(atual - 5);
          else if (event.key === " " || event.key === "Enter") alternar();
          else return;
          event.preventDefault();
        }}
      >
        {barras.map((altura, indice) => (
          <span
            key={indice}
            className={cn(
              "min-h-1 w-full rounded-full bg-current transition-opacity",
              indice / BARRAS < progresso ? "opacity-90" : "opacity-35",
            )}
            style={{ height: `${Math.max(12, Math.min(100, altura))}%` }}
          />
        ))}

        {/* a bolinha é o que diz que dá para arrastar; sem ela a divisão por opacidade parece
            só decoração da onda */}
        {total > 0 && (
          <span
            aria-hidden
            className="pointer-events-none absolute size-2.5 -translate-x-1/2 rounded-full bg-current shadow-sm"
            style={{ left: `${progresso * 100}%` }}
          />
        )}
      </div>

      {/* parado mostra quanto dura; começou a tocar, mostra onde está — a leitura que o WhatsApp faz */}
      <span className="shrink-0 text-[11px] tabular-nums opacity-70">
        {formatMediaDuration(Math.round(atual > 0 ? atual : total)) ?? "0:00"}
      </span>

      <button
        type="button"
        aria-label="Velocidade de reprodução"
        onClick={() =>
          setVelocidade(
            (atualVelocidade) =>
              VELOCIDADES[(VELOCIDADES.indexOf(atualVelocidade as 1) + 1) % VELOCIDADES.length]!,
          )
        }
        className={cn(
          "shrink-0 rounded-full px-1.5 py-0.5 text-[11px] tabular-nums transition-opacity",
          velocidade === 1 ? "opacity-60 hover:opacity-90" : "bg-current/15 opacity-90",
        )}
      >
        {velocidade}×
      </button>
    </div>
  );
};
