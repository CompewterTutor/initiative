import { useTranslation } from "react-i18next";

import type { TaskSubtaskProgress } from "@/api/generated/initiativeAPI.schemas";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

type TaskChecklistProgressProps = {
  progress?: TaskSubtaskProgress | null;
  className?: string;
};

export const TaskChecklistProgress = ({ progress, className }: TaskChecklistProgressProps) => {
  const { t } = useTranslation("tasks");

  if (!progress || progress.total === 0) {
    return null;
  }

  const ratio = progress.total === 0 ? 0 : Math.round((progress.completed / progress.total) * 100);

  return (
    <div className={cn("space-y-1", className)}>
      <Progress value={ratio} className="h-1.5" aria-label={t("checklist.progressLabel")} />
      <p className="font-medium text-[11px] text-muted-foreground">
        {t("checklist.progress", {
          completed: progress.completed,
          total: progress.total,
          count: progress.total,
        })}
      </p>
    </div>
  );
};
