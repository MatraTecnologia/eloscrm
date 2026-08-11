import {
  Ban,
  ChartColumn,
  FileText,
  Film,
  Image as ImageIcon,
  Info,
  MapPin,
  MessageSquare,
  Mic,
  Music,
  SmilePlus,
  Sticker,
  UserRound,
  Video,
  type LucideIcon,
} from "lucide-react";
import { formatMediaDuration, whatsappMessageTypeLabels } from "@/lib/labels";
import { cn } from "@/lib/utils";
import type { ConversationPreview as Preview, WhatsappMessageType } from "@/lib/types";

/**
 * Record completo do enum de propósito, como os rótulos de auditoria: tipo novo quebra o
 * `pnpm typecheck` em vez de aparecer sem ícone na lista. Texto não ganha ícone — o próprio texto
 * já diz o que é, e um ícone em toda linha só tiraria espaço da prévia.
 */
const ICONES: Record<WhatsappMessageType, LucideIcon | null> = {
  text: null,
  image: ImageIcon,
  video: Video,
  gif: Film,
  audio: Music,
  ptt: Mic,
  document: FileText,
  sticker: Sticker,
  location: MapPin,
  contact: UserRound,
  reaction: SmilePlus,
  poll: ChartColumn,
  system: Info,
  unsupported: MessageSquare,
};

/**
 * O resumo que o WhatsApp mostra embaixo do nome.
 *
 * A precedência é **por tipo**, e não "o texto se houver": o vCard de um contato chega inteiro no
 * `text` (o parser cai no `content` quando ele vem como string), e a lista exibia
 * `Cintia Mayia Phone (Celular): +55 43 …` no lugar de "Contato". Legenda só vale para o que tem
 * legenda — foto, vídeo e gif; áudio mostra a duração e documento mostra o nome do arquivo, que é
 * a informação útil de cada um.
 */
const resumo = (message: Preview) => {
  if (message.deletedAt) return "Esta mensagem foi apagada";

  const rotulo = whatsappMessageTypeLabels[message.type];
  switch (message.type) {
    case "text":
    case "image":
    case "video":
    case "gif":
      return message.text?.trim() || rotulo;
    case "audio":
    case "ptt": {
      const duracao = formatMediaDuration(message.mediaDuration);
      return duracao ? `${rotulo} · ${duracao}` : rotulo;
    }
    case "document":
      return message.mediaFilename?.trim() || rotulo;
    // a pergunta identifica a enquete melhor que a palavra "Enquete"
    case "poll":
      return message.poll?.name?.trim() || message.text?.trim() || rotulo;
    // o nome do lugar diz mais que "Localização"; ponto solto no mapa não tem nome e fica no rótulo
    case "location":
      return message.location?.name?.trim() || rotulo;
    case "contact": {
      // quem foi indicado importa mais que o rótulo: é por esse nome que o corretor lembra da conversa
      const [primeiro, ...resto] = message.contacts ?? [];
      if (!primeiro) return rotulo;
      return resto.length > 0 ? `${primeiro.name} e mais ${resto.length}` : primeiro.name;
    }
    default:
      return rotulo;
  }
};

export const ConversationPreview = ({ message }: { message: Preview | null }) => {
  if (!message) {
    return <span className="text-muted-foreground truncate text-xs">Sem mensagens</span>;
  }

  const Icone = message.deletedAt ? Ban : ICONES[message.type];

  return (
    <span
      className={cn(
        "text-muted-foreground flex min-w-0 items-center gap-1 text-xs",
        message.deletedAt && "italic",
      )}
    >
      {message.direction === "outbound" && <span className="shrink-0">Você:</span>}
      {/* o ícone precisa do shrink-0: sem ele o flex encolhe o ícone em vez do texto ao truncar */}
      {Icone && <Icone className="size-3.5 shrink-0" />}
      <span className="truncate">{resumo(message)}</span>
    </span>
  );
};
