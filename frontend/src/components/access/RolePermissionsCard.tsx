import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type AccessLevel = "read" | "write" | "owner";

export interface RolePermissionRow {
  initiative_role_id: number;
  role_display_name: string;
  level: AccessLevel;
}

export interface RoleOption {
  id: number;
  display_name: string;
}

interface RolePermissionsCardProps {
  rolePermissions: RolePermissionRow[];
  availableRoles: RoleOption[];
  /** Disables all interactive controls (any mutation in flight). */
  busy?: boolean;
  /** Shows a loading hint in the add-role area. */
  loadingRoles?: boolean;
  onAdd: (roleId: number, level: "read" | "write") => void;
  onUpdateLevel: (roleId: number, level: "read" | "write") => void;
  onRemove: (roleId: number) => void;
  /** Optional header overrides; default to generic strings from the access namespace. */
  title?: string;
  description?: string;
}

export const RolePermissionsCard = ({
  rolePermissions,
  availableRoles,
  busy = false,
  loadingRoles = false,
  onAdd,
  onUpdateLevel,
  onRemove,
  title,
  description,
}: RolePermissionsCardProps) => {
  const { t } = useTranslation("access");
  const [selectedRoleId, setSelectedRoleId] = useState<string>("");
  const [selectedLevel, setSelectedLevel] = useState<"read" | "write">("read");

  const columns: ColumnDef<RolePermissionRow>[] = useMemo(
    () => [
      {
        accessorKey: "role_display_name",
        header: t("roleColumn"),
        cell: ({ row }) => <span className="font-medium">{row.original.role_display_name}</span>,
      },
      {
        accessorKey: "level",
        header: t("accessLevel"),
        cell: ({ row }) => (
          <Select
            value={row.original.level}
            onValueChange={(value) =>
              onUpdateLevel(row.original.initiative_role_id, value as "read" | "write")
            }
            disabled={busy}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="read">{t("permissionRead")}</SelectItem>
              <SelectItem value="write">{t("permissionWrite")}</SelectItem>
            </SelectContent>
          </Select>
        ),
      },
      {
        id: "actions",
        header: () => <div className="text-right">{t("actions")}</div>,
        cell: ({ row }) => (
          <div className="text-right">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={() => onRemove(row.original.initiative_role_id)}
              disabled={busy}
            >
              {t("remove")}
            </Button>
          </div>
        ),
      },
    ],
    [t, busy, onUpdateLevel, onRemove]
  );

  const handleAdd = () => {
    if (!selectedRoleId) return;
    onAdd(Number(selectedRoleId), selectedLevel);
    setSelectedRoleId("");
    setSelectedLevel("read");
  };

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle>{title ?? t("rolePermissions")}</CardTitle>
        <CardDescription>{description ?? t("rolePermissionsDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {rolePermissions.length > 0 ? (
          <DataTable
            columns={columns}
            data={rolePermissions}
            getRowId={(row) => String(row.initiative_role_id)}
          />
        ) : (
          <p className="text-muted-foreground text-sm">{t("noRolePermissions")}</p>
        )}

        <div className="space-y-2 pt-2">
          <Label>{t("addRole")}</Label>
          {loadingRoles ? (
            <p className="text-muted-foreground text-sm">{t("loadingRoles")}</p>
          ) : availableRoles.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("allRolesAssigned")}</p>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <Select value={selectedRoleId} onValueChange={setSelectedRoleId}>
                <SelectTrigger className="min-w-50">
                  <SelectValue placeholder={t("selectRole")} />
                </SelectTrigger>
                <SelectContent>
                  {availableRoles.map((role) => (
                    <SelectItem key={role.id} value={String(role.id)}>
                      {role.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={selectedLevel}
                onValueChange={(v) => setSelectedLevel(v as "read" | "write")}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="read">{t("permissionRead")}</SelectItem>
                  <SelectItem value="write">{t("permissionWrite")}</SelectItem>
                </SelectContent>
              </Select>
              <Button type="button" onClick={handleAdd} disabled={!selectedRoleId || busy}>
                {busy ? t("adding") : t("add")}
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
