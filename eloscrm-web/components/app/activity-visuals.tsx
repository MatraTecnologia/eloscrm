import { FileText, MapPin, Phone, StickyNote, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActivityType } from "@/lib/types";

// Fonte única do ícone/cor de cada tipo de atividade — usada pela agenda, pela timeline do
// cliente e pelo card do dashboard, para que um tipo tenha sempre a mesma cara.
export const ACTIVITY_STYLE: Record<ActivityType, { icon: LucideIcon; color: string }> = {
  CALL: { icon: Phone, color: "var(--chart-1)" },
  VISIT: { icon: MapPin, color: "var(--chart-3)" },
  PROPOSAL: { icon: FileText, color: "var(--chart-4)" },
  NOTE: { icon: StickyNote, color: "var(--chart-5)" },
};

const ACTIVITY_ICON_SIZES = {
  sm: { wrapper: "size-7", icon: "size-3.5" },
  md: { wrapper: "size-9", icon: "size-4" },
} as const;

export const ActivityIcon = ({
  type,
  size = "sm",
}: {
  type: ActivityType;
  size?: keyof typeof ACTIVITY_ICON_SIZES;
}) => {
  const { icon: Icon, color } = ACTIVITY_STYLE[type];
  const { wrapper, icon } = ACTIVITY_ICON_SIZES[size];
  return (
    <span
      className={cn("flex shrink-0 items-center justify-center rounded-full", wrapper)}
      style={{ backgroundColor: `color-mix(in oklab, ${color} 14%, transparent)`, color }}
    >
      <Icon className={icon} />
    </span>
  );
};
