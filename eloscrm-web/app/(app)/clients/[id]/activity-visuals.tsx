import { FileText, MapPin, Phone, StickyNote, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActivityType } from "@/lib/types";

// Mesmo mapeamento de ícone/cor usado em app/(app)/dashboard/recent-activities-card.tsx,
// para que um tipo de atividade tenha sempre a mesma cara em qualquer tela.
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
