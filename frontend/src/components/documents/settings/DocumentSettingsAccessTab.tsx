import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { DocumentPermissionLevel, DocumentRead } from "@/api/generated/initiativeAPI.schemas";
import type { AccessLevel, RolePermissionRow } from "@/components/access/RolePermissionsCard";
import { RolePermissionsCard } from "@/components/access/RolePermissionsCard";
import type { UserPermissionRow } from "@/components/access/UserPermissionsCard";
import { UserPermissionsCard } from "@/components/access/UserPermissionsCard";
import { TabsContent } from "@/components/ui/tabs";
import {
  useAddDocumentMember,
  useAddDocumentMembersBulk,
  useAddDocumentRolePermission,
  useRemoveDocumentMember,
  useRemoveDocumentMembersBulk,
  useRemoveDocumentRolePermission,
  useUpdateDocumentMember,
  useUpdateDocumentRolePermission,
} from "@/hooks/useDocuments";
import { useInitiativeRoles } from "@/hooks/useInitiativeRoles";
import { toast } from "@/lib/chesterToast";

interface DocumentSettingsAccessTabProps {
  document: DocumentRead;
  documentId: number;
}

export const DocumentSettingsAccessTab = ({
  document,
  documentId,
}: DocumentSettingsAccessTabProps) => {
  const { t } = useTranslation(["documents", "common"]);

  const rolesQuery = useInitiativeRoles(document.initiative_id ?? null);

  // ── Member mutations ────────────────────────────────────────────────────
  const addMember = useAddDocumentMember(documentId, {
    onSuccess: () => toast.success(t("settings.accessGranted")),
    onError: () => toast.error(t("settings.grantAccessError")),
  });
  const updateMemberLevel = useUpdateDocumentMember(documentId, {
    onSuccess: () => toast.success(t("settings.accessUpdated")),
    onError: () => toast.error(t("settings.updateAccessError")),
  });
  const removeMember = useRemoveDocumentMember(documentId, {
    onSuccess: () => toast.success(t("settings.accessRemoved")),
    onError: () => toast.error(t("settings.removeAccessError")),
  });
  const addAllMembers = useAddDocumentMembersBulk(documentId, {
    onSuccess: () => toast.success(t("settings.accessGranted")),
    onError: () => toast.error(t("settings.grantAccessError")),
  });
  const bulkUpdateLevel = useAddDocumentMembersBulk(documentId, {
    onSuccess: () => toast.success(t("settings.accessUpdated")),
    onError: () => toast.error(t("settings.updateAccessError")),
  });
  const bulkRemoveMembers = useRemoveDocumentMembersBulk(documentId, {
    onSuccess: () => toast.success(t("settings.accessRemoved")),
    onError: () => toast.error(t("settings.removeAccessError")),
  });

  // ── Role mutations ──────────────────────────────────────────────────────
  const addRolePermission = useAddDocumentRolePermission(documentId, {
    onSuccess: () => toast.success(t("settings.roleAccessGranted")),
    onError: () => toast.error(t("settings.grantRoleAccessError")),
  });
  const updateRolePermission = useUpdateDocumentRolePermission(documentId, {
    onSuccess: () => toast.success(t("settings.roleAccessUpdated")),
    onError: () => toast.error(t("settings.updateRoleAccessError")),
  });
  const removeRolePermission = useRemoveDocumentRolePermission(documentId, {
    onSuccess: () => toast.success(t("settings.roleAccessRemoved")),
    onError: () => toast.error(t("settings.removeRoleAccessError")),
  });

  // ── Derived data ──────────────────────────────────────────────────────
  const initiativeMembers = useMemo(
    () => document.initiative?.members ?? [],
    [document.initiative?.members]
  );

  const availableRoles = useMemo(() => {
    const roles = rolesQuery.data ?? [];
    const assigned = new Set((document.role_permissions ?? []).map((rp) => rp.initiative_role_id));
    return roles.filter((role) => !assigned.has(role.id));
  }, [rolesQuery.data, document.role_permissions]);

  const rolePermissionRows: RolePermissionRow[] = useMemo(
    () =>
      (document.role_permissions ?? []).map((rp) => ({
        initiative_role_id: rp.initiative_role_id,
        role_display_name: rp.role_display_name,
        level: rp.level as AccessLevel,
      })),
    [document.role_permissions]
  );

  const userPermissionRows: UserPermissionRow[] = useMemo(
    () =>
      (document.permissions ?? []).map((permission) => {
        const member = initiativeMembers.find((entry) => entry.user?.id === permission.user_id);
        return {
          user_id: permission.user_id,
          displayName:
            member?.user?.full_name?.trim() ||
            member?.user?.email ||
            t("bulk.userFallback", { id: permission.user_id }),
          email: member?.user?.email || "",
          level: permission.level as AccessLevel,
          isOwner: permission.level === "owner",
        };
      }),
    [document.permissions, initiativeMembers, t]
  );

  const availableMembers = useMemo(
    () =>
      initiativeMembers
        .filter(
          (member) =>
            member.user && !(document.permissions ?? []).some((p) => p.user_id === member.user.id)
        )
        .map((member) => ({
          id: member.user.id,
          full_name: member.user.full_name,
          email: member.user.email,
        })),
    [initiativeMembers, document.permissions]
  );

  const rolesBusy =
    addRolePermission.isPending || updateRolePermission.isPending || removeRolePermission.isPending;
  const usersBusy =
    addMember.isPending ||
    updateMemberLevel.isPending ||
    removeMember.isPending ||
    addAllMembers.isPending ||
    bulkUpdateLevel.isPending ||
    bulkRemoveMembers.isPending;

  return (
    <TabsContent value="access" className="space-y-6">
      <RolePermissionsCard
        rolePermissions={rolePermissionRows}
        availableRoles={availableRoles}
        busy={rolesBusy}
        loadingRoles={rolesQuery.isLoading}
        onAdd={(roleId, level) => addRolePermission.mutate({ roleId, level })}
        onUpdateLevel={(roleId, level) => updateRolePermission.mutate({ roleId, level })}
        onRemove={(roleId) => removeRolePermission.mutate(roleId)}
        title={t("settings.roleAccessTitle")}
        description={t("settings.roleAccessDescription")}
      />
      <UserPermissionsCard
        userPermissions={userPermissionRows}
        availableMembers={availableMembers}
        showEmail
        busy={usersBusy}
        onAdd={(userId, level) =>
          addMember.mutate({ userId, level: level as DocumentPermissionLevel })
        }
        onUpdateLevel={(userId, level) =>
          updateMemberLevel.mutate({ userId, level: level as DocumentPermissionLevel })
        }
        onRemove={(userId) => removeMember.mutate(userId)}
        onAddAll={(level) =>
          addAllMembers.mutate({ user_ids: availableMembers.map((m) => m.id), level })
        }
        onBulkUpdate={(userIds, level) => bulkUpdateLevel.mutate({ user_ids: userIds, level })}
        onBulkRemove={(userIds) => bulkRemoveMembers.mutate({ user_ids: userIds })}
        title={t("settings.individualAccessTitle")}
        description={t("settings.individualAccessDescription")}
      />
    </TabsContent>
  );
};
