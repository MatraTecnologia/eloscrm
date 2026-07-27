import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

// Só tons com contraste suficiente para texto branco (14px, WCAG AA ~4.5:1).
// chart-3 (verde) e chart-4 (âmbar) ficam de fora: contraste baixo e o verde
// colide semanticamente com o badge "Ativo" (--success).
const AVATAR_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-5)"];

const colorFor = (seed: string) => {
  let hash = 0;
  for (const char of seed) hash = (hash + char.charCodeAt(0)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[hash];
};

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

export const ClientAvatar = ({
  id,
  name,
  className,
  textClassName,
}: {
  id: string;
  name: string;
  className?: string;
  textClassName?: string;
}) => (
  <Avatar className={cn("shrink-0", className)}>
    <AvatarFallback className={cn("text-white", textClassName)} style={{ backgroundColor: colorFor(id) }}>
      {initials(name)}
    </AvatarFallback>
  </Avatar>
);
