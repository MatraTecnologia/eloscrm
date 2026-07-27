import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export const StatCard = ({
  label,
  value,
  icon: Icon,
  color,
  isLoading,
}: {
  label: string;
  value: string | number | undefined;
  icon: LucideIcon;
  color: string;
  isLoading: boolean;
}) => {
  return (
    <Card>
      <CardContent className="flex items-center gap-4">
        <div
          className="flex size-11 shrink-0 items-center justify-center rounded-xl"
          style={{ backgroundColor: `color-mix(in oklab, ${color} 14%, transparent)`, color }}
        >
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm text-muted-foreground">{label}</p>
          {isLoading ? (
            <Skeleton className="mt-1 h-7 w-16" />
          ) : (
            <p className="text-2xl font-semibold tabular-nums">{value}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
