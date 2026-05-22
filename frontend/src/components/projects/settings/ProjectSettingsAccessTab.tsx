import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { ProjectPermissionLevel, ProjectRead } from "@/api/generated/initiativeAPI.schemas";
import type { AccessLevel, RolePermissionRow } from "@/components/access/RolePermissionsCard";
import { RolePermissionsCard } from "@/components/access/RolePermissionsCard";
import type { UserPermissionRow } from "@/components/access/UserPermissionsCard";
import { UserPermissionsCard } from "@/components/access/UserPermissionsCard";
import { TabsContent } from "@/components/ui/tabs";
import { useInitiativeRoles } from "@/hooks/useInitiativeRoles";
import {
  useAddProjectMember,
  useAddProjectMembersBulk,
  useAddProjectRolePermission,
  useRemoveProjectMember,
  useRemoveProjectMembersBulk,
  useRemoveProjectRolePermission,
  useUpdateProjectMember,
  useUpdateProjectRolePermission,
} from "@/hooks/useProjects";
import { toast } from "@/lib/chesterToast";

interface ProjectSettingsAccessTabProps {
  project: ProjectRead;
  projectId: number;
}

export const ProjectSettingsAccessTab = ({ project, projectId }: ProjectSettingsAccessTabProps) => {
  const { t } = useTranslation("projects");

  const initiativeRolesQuery = useInitiativeRoles(project.initiative_id ?? null);

  // ── Member mutations ────────────────────────────────────────────────────
  const addMember = useAddProjectMember(projectId, {
    onSuccess: () => toast.success(t("settings.access.granted")),
    onError: () => toast.error(t("settings.access.grantError")),
  });
  const updateMemberLevel = useUpdateProjectMember(projectId, {
    onSuccess: () => toast.success(t("settings.access.updated")),
    onError: () => toast.error(t("settings.access.updateError")),
  });
  const removeMember = useRemoveProjectMember(projectId, {
    onSuccess: () => toast.success(t("settings.access.removed")),
    onError: () => toast.error(t("settings.access.removeError")),
  });
  const addAllMembers = useAddProjectMembersBulk(projectId, {
    onSuccess: () => toast.success(t("settings.access.grantedAll")),
    onError: () => toast.error(t("settings.access.grantAllError")),
  });
  const bulkUpdateLevel = useAddProjectMembersBulk(projectId, {
    onSuccess: () => toast.success(t("settings.access.bulkUpdated")),
    onError: () => toast.error(t("settings.access.bulkUpdateError")),
  });
  const bulkRemoveMembers = useRemoveProjectMembersBulk(projectId, {
    onSuccess: () => toast.success(t("settings.access.bulkRemoved")),
    onError: () => toast.error(t("settings.access.bulkRemoveError")),
  });

  // ── Role mutations ──────────────────────────────────────────────────────
  const addRolePermission = useAddProjectRolePermission(projectId, {
    onSuccess: () => toast.success(t("settings.roleAccess.granted")),
    onError: () => toast.error(t("settings.roleAccess.grantError")),
  });
  const updateRolePermission = useUpdateProjectRolePermission(projectId, {
    onSuccess: () => toast.success(t("settings.roleAccess.updated")),
    onError: () => toast.error(t("settings.roleAccess.updateError")),
  });
  const removeRolePermission = useRemoveProjectRolePermission(projectId, {
    onSuccess: () => toast.success(t("settings.roleAccess.removed")),
    onError: () => toast.error(t("settings.roleAccess.removeError")),
  });

  // ── Derived data ──────────────────────────────────────────────────────
  const availableRoles = useMemo(
    () =>
      (initiativeRolesQuery.data ?? []).filter(
        (role) => !(project.role_permissions ?? []).some((rp) => rp.initiative_role_id === role.id)
      ),
    [initiativeRolesQuery.data, project.role_permissions]
  );

  const rolePermissionRows: RolePermissionRow[] = useMemo(
    () =>
      (project.role_permissions ?? []).map((rp) => ({
        initiative_role_id: rp.initiative_role_id,
        role_display_name: rp.role_display_name,
        level: rp.level as AccessLevel,
      })),
    [project.role_permissions]
  );

  const initiativeMembers = useMemo(
    () => project.initiative?.members ?? [],
    [project.initiative?.members]
  );

  const userPermissionRows: UserPermissionRow[] = useMemo(
    () =>
      (project.permissions ?? []).map((permission) => {
        const member = initiativeMembers.find((entry) => entry.user?.id === permission.user_id);
        const ownerInfo = project.owner;
        const isOwner = permission.user_id === project.owner_id;
        const displayName =
          member?.user?.full_name?.trim() ||
          member?.user?.email ||
          (isOwner
            ? ownerInfo?.full_name?.trim() || ownerInfo?.email || "Project owner"
            : `User ${permission.user_id}`);
        const email = member?.user?.email || (isOwner ? ownerInfo?.email || "" : "");
        return {
          user_id: permission.user_id,
          displayName,
          email,
          level: permission.level as AccessLevel,
          isOwner,
        };
      }),
    [project.permissions, project.owner, project.owner_id, initiativeMembers]
  );

  const availableMembers = useMemo(
    () =>
      initiativeMembers
        .filter(
          (member) =>
            member.user && !(project.permissions ?? []).some((p) => p.user_id === member.user.id)
        )
        .map((member) => ({
          id: member.user.id,
          full_name: member.user.full_name,
          email: member.user.email,
        })),
    [initiativeMembers, project.permissions]
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
        loadingRoles={initiativeRolesQuery.isLoading}
        onAdd={(roleId, level) => addRolePermission.mutate({ initiative_role_id: roleId, level })}
        onUpdateLevel={(roleId, level) => updateRolePermission.mutate({ roleId, data: { level } })}
        onRemove={(roleId) => removeRolePermission.mutate(roleId)}
        title={t("settings.roleAccess.title")}
        description={t("settings.roleAccess.description")}
      />
      <UserPermissionsCard
        userPermissions={userPermissionRows}
        availableMembers={availableMembers}
        showEmail
        busy={usersBusy}
        onAdd={(userId, level) => addMember.mutate({ user_id: userId, level })}
        onUpdateLevel={(userId, level) =>
          updateMemberLevel.mutate({ userId, data: { level: level as ProjectPermissionLevel } })
        }
        onRemove={(userId) => removeMember.mutate(userId)}
        onAddAll={(level) =>
          addAllMembers.mutate({ user_ids: availableMembers.map((m) => m.id), level })
        }
        onBulkUpdate={(userIds, level) => bulkUpdateLevel.mutate({ user_ids: userIds, level })}
        onBulkRemove={(userIds) => bulkRemoveMembers.mutate({ user_ids: userIds })}
        title={t("settings.access.title")}
        description={t("settings.access.description")}
      />
    </TabsContent>
  );
};
