import { useTranslation } from "react-i18next";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAppConfig } from "@/hooks/useAppConfig";

export interface AdvancedToolsSectionProps {
  eventsEnabled: boolean;
  queuesEnabled: boolean;
  countersEnabled: boolean;
  advancedToolEnabled: boolean;
  onToggleEvents: (value: boolean) => void;
  onToggleQueues: (value: boolean) => void;
  onToggleCounters: (value: boolean) => void;
  onToggleAdvancedTool: (value: boolean) => void;
  canManage: boolean;
  isSaving: boolean;
  /** "card" wraps the rows in a Card with title+description (settings page). "plain" returns just the rows (for use inside an Accordion). */
  layout?: "card" | "plain";
  /** Optional prefix for input IDs so multiple instances don't collide. */
  idPrefix?: string;
}

interface AdvancedToolToggleProps {
  id: string;
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  disabled: boolean;
}

const AdvancedToolToggle = ({
  id,
  title,
  description,
  checked,
  onCheckedChange,
  disabled,
}: AdvancedToolToggleProps) => (
  <div className="flex items-center justify-between gap-4 rounded-md border p-3">
    <div className="space-y-0.5">
      <Label htmlFor={id}>{title}</Label>
      <p className="text-muted-foreground text-xs">{description}</p>
    </div>
    <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
  </div>
);

export const AdvancedToolsSection = ({
  eventsEnabled,
  queuesEnabled,
  countersEnabled,
  advancedToolEnabled,
  onToggleEvents,
  onToggleQueues,
  onToggleCounters,
  onToggleAdvancedTool,
  canManage,
  isSaving,
  layout = "card",
  idPrefix = "advanced-tools",
}: AdvancedToolsSectionProps) => {
  const { t } = useTranslation("initiatives");
  const { advancedTool } = useAppConfig();
  const disabled = !canManage || isSaving;

  const rows = (
    <div className="space-y-3">
      <AdvancedToolToggle
        id={`${idPrefix}-events-toggle`}
        title={t("eventsFeature")}
        description={t("eventsFeatureDescription")}
        checked={eventsEnabled}
        onCheckedChange={onToggleEvents}
        disabled={disabled}
      />
      <AdvancedToolToggle
        id={`${idPrefix}-queues-toggle`}
        title={t("queuesFeature")}
        description={t("queuesFeatureDescription")}
        checked={queuesEnabled}
        onCheckedChange={onToggleQueues}
        disabled={disabled}
      />
      <AdvancedToolToggle
        id={`${idPrefix}-counters-toggle`}
        title={t("countersFeature")}
        description={t("countersFeatureDescription")}
        checked={countersEnabled}
        onCheckedChange={onToggleCounters}
        disabled={disabled}
      />
      {advancedTool && (
        <AdvancedToolToggle
          id={`${idPrefix}-advanced-tool-toggle`}
          title={advancedTool.name}
          description={t("advancedToolFeatureDescription", { name: advancedTool.name })}
          checked={advancedToolEnabled}
          onCheckedChange={onToggleAdvancedTool}
          disabled={disabled}
        />
      )}
    </div>
  );

  if (layout === "plain") return rows;

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>{t("advancedTools")}</CardTitle>
        <CardDescription>{t("advancedToolsDescription")}</CardDescription>
      </CardHeader>
      <CardContent>{rows}</CardContent>
    </Card>
  );
};
