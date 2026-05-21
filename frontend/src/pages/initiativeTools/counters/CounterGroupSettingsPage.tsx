import { Link, useParams, useRouter } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Loader2, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type {
  CounterGroupPermissionCreate,
  CounterGroupRolePermissionCreate,
  CounterGroupRolePermissionRead,
  CounterPermissionLevel,
} from "@/api/generated/initiativeAPI.schemas";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  useCounterGroup,
  useDeleteCounterGroup,
  useSetCounterGroupPermissions,
  useSetCounterGroupRolePermissions,
  useUpdateCounterGroup,
} from "@/hooks/useCounters";
import { useInitiativeRoles } from "@/hooks/useInitiativeRoles";
import { useInitiativeMembers } from "@/hooks/useInitiatives";
import { toast } from "@/lib/chesterToast";
import { useGuildPath } from "@/lib/guildUrl";

interface UserPermissionRow {
  user_id: number;
  displayName: string;
  email: string;
  level: CounterPermissionLevel;
  isOwner: boolean;
}

export function CounterGroupSettingsPage() {
  const { t } = useTranslation(["counters", "common"]);
  const { groupId } = useParams({ strict: false }) as { groupId?: string };
  const parsedId = groupId ? Number(groupId) : Number.NaN;
  const router = useRouter();
  const gp = useGuildPath();

  // ── Fetch group ────────────────────────────────────────────────────────

  const groupQuery = useCounterGroup(Number.isFinite(parsedId) ? parsedId : null);
  const group = groupQuery.data;

  const canManage =
    group?.my_permission_level === "owner" || group?.my_permission_level === "write";
  const isOwner = group?.my_permission_level === "owner";

  // ── Details tab ────────────────────────────────────────────────────────

  const [nameValue, setNameValue] = useState("");
  const [descriptionValue, setDescriptionValue] = useState("");

  useEffect(() => {
    if (!group) return;
    setNameValue(group.name);
    setDescriptionValue(group.description ?? "");
  }, [group]);

  const updateGroup = useUpdateCounterGroup(parsedId, {
    onSuccess: () => {
      toast.success(t("groupUpdated"));
    },
  });

  const handleDetailsSave = () => {
    const trimmedName = nameValue.trim();
    if (!trimmedName) return;
    updateGroup.mutate({
      name: trimmedName,
      description: descriptionValue.trim() || null,
    });
  };

  // ── Access tab ─────────────────────────────────────────────────────────

  const rolesQuery = useInitiativeRoles(group?.initiative_id ?? null);
  const membersQuery = useInitiativeMembers(group?.initiative_id ?? null);

  const [localRolePerms, setLocalRolePerms] = useState<CounterGroupRolePermissionCreate[]>([]);
  const [localUserPerms, setLocalUserPerms] = useState<CounterGroupPermissionCreate[]>([]);

  useEffect(() => {
    if (!group) return;
    setLocalRolePerms(
      group.role_permissions.map((rp) => ({
        initiative_role_id: rp.initiative_role_id,
        level: rp.level ?? "read",
      }))
    );
    setLocalUserPerms(
      group.permissions.map((p) => ({
        user_id: p.user_id,
        level: p.level ?? "read",
      }))
    );
  }, [group]);

  const setRolePermissions = useSetCounterGroupRolePermissions(parsedId, {
    onSuccess: () => {
      toast.success(t("permissionsUpdated", { defaultValue: "Permissions updated" }));
    },
  });

  const setUserPermissions = useSetCounterGroupPermissions(parsedId, {
    onSuccess: () => {
      toast.success(t("permissionsUpdated", { defaultValue: "Permissions updated" }));
    },
  });

  // Role permission helpers
  const [selectedNewRoleId, setSelectedNewRoleId] = useState<string>("");
  const [selectedNewRoleLevel, setSelectedNewRoleLevel] = useState<"read" | "write">("read");

  const availableRoles = useMemo(() => {
    const roles = rolesQuery.data ?? [];
    const assigned = new Set(localRolePerms.map((rp) => rp.initiative_role_id));
    return roles.filter((role) => !assigned.has(role.id));
  }, [rolesQuery.data, localRolePerms]);

  const handleAddRolePermission = () => {
    if (!selectedNewRoleId) return;
    const newList: CounterGroupRolePermissionCreate[] = [
      ...localRolePerms,
      { initiative_role_id: Number(selectedNewRoleId), level: selectedNewRoleLevel },
    ];
    setLocalRolePerms(newList);
    setRolePermissions.mutate(newList);
    setSelectedNewRoleId("");
    setSelectedNewRoleLevel("read");
  };

  const handleUpdateRoleLevel = (roleId: number, level: CounterPermissionLevel) => {
    const newList = localRolePerms.map((rp) =>
      rp.initiative_role_id === roleId ? { ...rp, level } : rp
    );
    setLocalRolePerms(newList);
    setRolePermissions.mutate(newList);
  };

  const handleRemoveRolePermission = (roleId: number) => {
    const newList = localRolePerms.filter((rp) => rp.initiative_role_id !== roleId);
    setLocalRolePerms(newList);
    setRolePermissions.mutate(newList);
  };

  // User permission helpers
  const [selectedNewUserId, setSelectedNewUserId] = useState<string>("");
  const [selectedNewUserLevel, setSelectedNewUserLevel] = useState<CounterPermissionLevel>("read");
  const [selectedMembers, setSelectedMembers] = useState<UserPermissionRow[]>([]);

  const availableMembers = useMemo(() => {
    const members = membersQuery.data ?? [];
    const assigned = new Set(localUserPerms.map((p) => p.user_id));
    return members.filter((m) => !assigned.has(m.id));
  }, [membersQuery.data, localUserPerms]);

  const handleAddUserPermission = () => {
    if (!selectedNewUserId) return;
    const newList: CounterGroupPermissionCreate[] = [
      ...localUserPerms,
      { user_id: Number(selectedNewUserId), level: selectedNewUserLevel },
    ];
    setLocalUserPerms(newList);
    setUserPermissions.mutate(newList);
    setSelectedNewUserId("");
    setSelectedNewUserLevel("read");
  };

  const handleUpdateUserLevel = (userId: number, level: CounterPermissionLevel) => {
    const newList = localUserPerms.map((p) => (p.user_id === userId ? { ...p, level } : p));
    setLocalUserPerms(newList);
    setUserPermissions.mutate(newList);
  };

  const handleRemoveUserPermission = (userId: number) => {
    const newList = localUserPerms.filter((p) => p.user_id !== userId);
    setLocalUserPerms(newList);
    setUserPermissions.mutate(newList);
  };

  const handleBulkUpdateLevel = (level: CounterPermissionLevel) => {
    const ids = new Set(selectedMembers.filter((m) => !m.isOwner).map((m) => m.user_id));
    if (ids.size === 0) return;
    const newList = localUserPerms.map((p) => (ids.has(p.user_id) ? { ...p, level } : p));
    setLocalUserPerms(newList);
    setUserPermissions.mutate(newList);
    setSelectedMembers([]);
  };

  const handleBulkRemoveUsers = () => {
    const ids = new Set(selectedMembers.filter((m) => !m.isOwner).map((m) => m.user_id));
    if (ids.size === 0) return;
    const newList = localUserPerms.filter((p) => !ids.has(p.user_id));
    setLocalUserPerms(newList);
    setUserPermissions.mutate(newList);
    setSelectedMembers([]);
  };

  const handleAddAllMembers = () => {
    if (availableMembers.length === 0) return;
    const newEntries: CounterGroupPermissionCreate[] = availableMembers.map((m) => ({
      user_id: m.id,
      level: selectedNewUserLevel,
    }));
    const newList = [...localUserPerms, ...newEntries];
    setLocalUserPerms(newList);
    setUserPermissions.mutate(newList);
  };

  // ── Row materialization ────────────────────────────────────────────────

  const userPermissionRows: UserPermissionRow[] = useMemo(() => {
    const members = membersQuery.data ?? [];
    return localUserPerms.map((p) => {
      const member = members.find((m) => m.id === p.user_id);
      const displayName = member?.full_name?.trim() || member?.email || `User #${p.user_id}`;
      const email = member?.email || "";
      return {
        user_id: p.user_id,
        displayName,
        email,
        level: p.level ?? "read",
        isOwner: p.level === "owner",
      };
    });
  }, [localUserPerms, membersQuery.data]);

  const rolePermissionRows: (
    | CounterGroupRolePermissionRead
    | {
        initiative_role_id: number;
        role_display_name: string;
        level: CounterPermissionLevel;
      }
  )[] = useMemo(() => {
    const serverRows = group?.role_permissions ?? [];
    return localRolePerms.map((lrp) => {
      const serverRow = serverRows.find((sr) => sr.initiative_role_id === lrp.initiative_role_id);
      if (serverRow) {
        return { ...serverRow, level: lrp.level ?? serverRow.level ?? "read" };
      }
      const role = (rolesQuery.data ?? []).find((r) => r.id === lrp.initiative_role_id);
      return {
        initiative_role_id: lrp.initiative_role_id,
        role_display_name: role?.display_name ?? `Role #${lrp.initiative_role_id}`,
        level: lrp.level ?? "read",
      };
    });
  }, [localRolePerms, group?.role_permissions, rolesQuery.data]);

  // ── Delete ─────────────────────────────────────────────────────────────

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const deleteGroup = useDeleteCounterGroup({
    onSuccess: () => {
      toast.success(t("groupDeleted"));
      setDeleteDialogOpen(false);
      router.navigate({ to: gp("/counter-groups") });
    },
  });

  // ── Column definitions ─────────────────────────────────────────────────

  const roleColumns: ColumnDef<(typeof rolePermissionRows)[number]>[] = useMemo(
    () => [
      {
        accessorKey: "role_display_name",
        header: t("rolePermissions"),
        cell: ({ row }) => <span className="font-medium">{row.original.role_display_name}</span>,
      },
      {
        accessorKey: "level",
        header: t("permissionLevel", { defaultValue: "Permission level" }),
        cell: ({ row }) => (
          <Select
            value={row.original.level}
            onValueChange={(value) =>
              handleUpdateRoleLevel(
                row.original.initiative_role_id,
                value as CounterPermissionLevel
              )
            }
            disabled={setRolePermissions.isPending}
          >
            <SelectTrigger className="w-[130px]">
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
        header: () => <div className="text-right">{t("common:actions")}</div>,
        cell: ({ row }) => (
          <div className="text-right">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={() => handleRemoveRolePermission(row.original.initiative_role_id)}
              disabled={setRolePermissions.isPending}
            >
              {t("removeRole", { defaultValue: "Remove" })}
            </Button>
          </div>
        ),
      },
    ],
    // biome-ignore lint/correctness/useExhaustiveDependencies: handlers are local
    [t, setRolePermissions.isPending, handleRemoveRolePermission, handleUpdateRoleLevel]
  );

  const userColumns: ColumnDef<UserPermissionRow>[] = useMemo(
    () => [
      {
        accessorKey: "displayName",
        header: t("addMember", { defaultValue: "Member" }),
        cell: ({ row }) => (
          <div>
            <span className="font-medium">{row.original.displayName}</span>
            {row.original.email && (
              <span className="ml-2 text-muted-foreground text-sm">{row.original.email}</span>
            )}
          </div>
        ),
      },
      {
        accessorKey: "level",
        header: t("permissionLevel", { defaultValue: "Permission level" }),
        cell: ({ row }) => {
          if (row.original.isOwner) {
            return <span className="text-muted-foreground">{t("permissionOwner")}</span>;
          }
          return (
            <Select
              value={row.original.level}
              onValueChange={(value) =>
                handleUpdateUserLevel(row.original.user_id, value as CounterPermissionLevel)
              }
              disabled={setUserPermissions.isPending}
            >
              <SelectTrigger className="w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="read">{t("permissionRead")}</SelectItem>
                <SelectItem value="write">{t("permissionWrite")}</SelectItem>
              </SelectContent>
            </Select>
          );
        },
      },
      {
        id: "actions",
        header: () => <div className="text-right">{t("common:actions")}</div>,
        cell: ({ row }) => {
          if (row.original.isOwner) {
            return <div className="text-right text-muted-foreground text-xs">-</div>;
          }
          return (
            <div className="text-right">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={() => handleRemoveUserPermission(row.original.user_id)}
                disabled={setUserPermissions.isPending}
              >
                {t("removeMember", { defaultValue: "Remove" })}
              </Button>
            </div>
          );
        },
      },
    ],
    // biome-ignore lint/correctness/useExhaustiveDependencies: handlers are local
    [t, setUserPermissions.isPending, handleUpdateUserLevel, handleRemoveUserPermission]
  );

  // ── Early returns ──────────────────────────────────────────────────────

  if (!Number.isFinite(parsedId)) {
    return <p className="text-destructive">{t("notFound")}</p>;
  }

  if (groupQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("loadingGroup")}
      </div>
    );
  }

  if (groupQuery.isError || !group) {
    return <p className="text-destructive">{t("notFound")}</p>;
  }

  return (
    <div className="space-y-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to={gp("/counter-groups")}>{t("title")}</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to={gp(`/counter-groups/${group.id}`)}>{group.name}</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{t("settings")}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="space-y-1">
        <h1 className="font-semibold text-3xl tracking-tight">{t("settings")}</h1>
        <p className="text-muted-foreground text-sm">{t("settingsDescription")}</p>
      </div>

      <Tabs defaultValue="details" className="space-y-4">
        <TabsList className="w-full max-w-xl justify-start">
          <TabsTrigger value="details">{t("details")}</TabsTrigger>
          {canManage && <TabsTrigger value="access">{t("access")}</TabsTrigger>}
          <TabsTrigger value="advanced">{t("advanced")}</TabsTrigger>
        </TabsList>

        {/* ── Details tab ─────────────────────────────────────────── */}
        <TabsContent value="details" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("details")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="counter-group-name">{t("name")}</Label>
                <Input
                  id="counter-group-name"
                  value={nameValue}
                  onChange={(e) => setNameValue(e.target.value)}
                  placeholder={t("namePlaceholder")}
                  disabled={!canManage}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="counter-group-description">{t("description")}</Label>
                <Textarea
                  id="counter-group-description"
                  value={descriptionValue}
                  onChange={(e) => setDescriptionValue(e.target.value)}
                  placeholder={t("descriptionPlaceholder")}
                  disabled={!canManage}
                  rows={3}
                />
              </div>
              {canManage && (
                <Button
                  onClick={handleDetailsSave}
                  disabled={updateGroup.isPending || !nameValue.trim()}
                >
                  {updateGroup.isPending ? t("saving") : t("common:save")}
                </Button>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Access tab ──────────────────────────────────────────── */}
        {canManage && (
          <TabsContent value="access" className="space-y-6">
            {/* Role permissions */}
            <Card>
              <CardHeader>
                <CardTitle>{t("rolePermissions")}</CardTitle>
                <CardDescription>{t("rolePermissionsDescription")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {rolePermissionRows.length > 0 ? (
                  <DataTable
                    columns={roleColumns}
                    data={rolePermissionRows}
                    getRowId={(row) => String(row.initiative_role_id)}
                  />
                ) : (
                  <p className="text-muted-foreground text-sm">
                    {t("noRolePermissions", { defaultValue: "No role permissions configured." })}
                  </p>
                )}

                <div className="space-y-2 pt-2">
                  <Label>{t("addRole", { defaultValue: "Add role" })}</Label>
                  {availableRoles.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                      {t("noRolePermissions", {
                        defaultValue: "No role permissions configured.",
                      })}
                    </p>
                  ) : (
                    <div className="flex flex-wrap items-end gap-3">
                      <Select value={selectedNewRoleId} onValueChange={setSelectedNewRoleId}>
                        <SelectTrigger className="min-w-[200px]">
                          <SelectValue
                            placeholder={t("selectRole", { defaultValue: "Select a role..." })}
                          />
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
                        value={selectedNewRoleLevel}
                        onValueChange={(v) => setSelectedNewRoleLevel(v as "read" | "write")}
                      >
                        <SelectTrigger className="w-[130px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="read">{t("permissionRead")}</SelectItem>
                          <SelectItem value="write">{t("permissionWrite")}</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        onClick={handleAddRolePermission}
                        disabled={!selectedNewRoleId || setRolePermissions.isPending}
                      >
                        {setRolePermissions.isPending
                          ? t("adding")
                          : t("addRole", { defaultValue: "Add role" })}
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* User permissions */}
            <Card>
              <CardHeader>
                <CardTitle>{t("userPermissions")}</CardTitle>
                <CardDescription>{t("userPermissionsDescription")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {selectedMembers.length > 0 && (
                  <div className="flex items-center gap-3 rounded-md bg-muted p-3">
                    <span className="font-medium text-sm">
                      {t("selectedCount", {
                        count: selectedMembers.length,
                        defaultValue: "{{count}} selected",
                      })}
                    </span>
                    <Select
                      onValueChange={(level) =>
                        handleBulkUpdateLevel(level as CounterPermissionLevel)
                      }
                      disabled={setUserPermissions.isPending}
                    >
                      <SelectTrigger className="w-[150px]">
                        <SelectValue
                          placeholder={t("changeAccess", { defaultValue: "Change access..." })}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="read">{t("permissionRead")}</SelectItem>
                        <SelectItem value="write">{t("permissionWrite")}</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={handleBulkRemoveUsers}
                      disabled={setUserPermissions.isPending}
                    >
                      {setUserPermissions.isPending
                        ? t("removing", { defaultValue: "Removing..." })
                        : t("removeMember", { defaultValue: "Remove" })}
                    </Button>
                  </div>
                )}

                <DataTable
                  columns={userColumns}
                  data={userPermissionRows}
                  getRowId={(row) => String(row.user_id)}
                  enableFilterInput
                  filterInputColumnKey="displayName"
                  filterInputPlaceholder={t("filterByName")}
                  enableRowSelection
                  onRowSelectionChange={setSelectedMembers}
                  onExitSelection={() => setSelectedMembers([])}
                  enablePagination
                />

                <div className="space-y-2 pt-2">
                  <Label>{t("addMember", { defaultValue: "Add member" })}</Label>
                  {availableMembers.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                      {t("noUserPermissions", {
                        defaultValue: "No individual user permissions.",
                      })}
                    </p>
                  ) : (
                    <div className="flex flex-wrap items-end gap-3">
                      <SearchableCombobox
                        items={availableMembers.map((m) => ({
                          value: String(m.id),
                          label: m.full_name?.trim() || m.email,
                        }))}
                        value={selectedNewUserId}
                        onValueChange={setSelectedNewUserId}
                        placeholder={t("selectMember", {
                          defaultValue: "Select a member...",
                        })}
                        emptyMessage={t("selectMember", {
                          defaultValue: "Select a member...",
                        })}
                        className="min-w-[200px]"
                      />
                      <Select
                        value={selectedNewUserLevel}
                        onValueChange={(v) => setSelectedNewUserLevel(v as CounterPermissionLevel)}
                      >
                        <SelectTrigger className="w-[130px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="read">{t("permissionRead")}</SelectItem>
                          <SelectItem value="write">{t("permissionWrite")}</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        onClick={handleAddUserPermission}
                        disabled={!selectedNewUserId || setUserPermissions.isPending}
                      >
                        {setUserPermissions.isPending
                          ? t("adding")
                          : t("addMember", { defaultValue: "Add member" })}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={handleAddAllMembers}
                        disabled={setUserPermissions.isPending}
                      >
                        {setUserPermissions.isPending
                          ? t("adding")
                          : t("addAllCount", {
                              count: availableMembers.length,
                              defaultValue: "Add all ({{count}})",
                            })}
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* ── Advanced tab ────────────────────────────────────────── */}
        <TabsContent value="advanced" className="space-y-6">
          {isOwner && (
            <Card className="border-destructive/40 bg-destructive/5 shadow-sm">
              <CardHeader>
                <CardTitle>{t("dangerZone")}</CardTitle>
                <CardDescription>{t("dangerZoneDescription")}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => setDeleteDialogOpen(true)}
                  disabled={!isOwner}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t("deleteGroup")}
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={t("deleteGroup")}
        description={t("deleteGroupConfirm")}
        confirmLabel={t("deleteGroup")}
        cancelLabel={t("common:cancel")}
        onConfirm={() => deleteGroup.mutate(parsedId)}
        isLoading={deleteGroup.isPending}
        destructive
      />
    </div>
  );
}
