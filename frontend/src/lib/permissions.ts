/**
 * Platform capability helpers (frontend mirror of `app.core.capabilities`).
 *
 * The backend computes the authoritative capability set for the current user
 * and ships it on `UserRead.capabilities`. The frontend never derives
 * capabilities from the role itself — it only reads the list — so the two
 * stay in lockstep. These string constants must match the backend
 * `Capability` enum values exactly.
 */

import type { UserRead } from "@/api/generated/initiativeAPI.schemas";

export const Capability = {
  usersRead: "users.read",
  usersManage: "users.manage",
  usersDelete: "users.delete",
  rolesAssign: "roles.assign",
  guildsRead: "guilds.read",
  guildsManage: "guilds.manage",
  contentModerate: "content.moderate",
  auditRead: "audit.read",
  dataBypass: "data.bypass",
  accessRequest: "access.request",
  accessApprove: "access.approve",
  accessRead: "access.read",
  configManage: "config.manage",
} as const;

export type Capability = (typeof Capability)[keyof typeof Capability];

/** A minimal shape so callers can pass the auth user (or any object with a
 * capabilities list) without importing the full `UserRead`. */
type WithCapabilities = Pick<UserRead, "capabilities"> | null | undefined;

/** True iff the user's standing role grants `capability`. */
export function hasCapability(user: WithCapabilities, capability: Capability): boolean {
  return user?.capabilities?.includes(capability) ?? false;
}

/** True iff the user holds at least one of the given capabilities. */
export function hasAnyCapability(user: WithCapabilities, capabilities: Capability[]): boolean {
  return capabilities.some((c) => hasCapability(user, c));
}

/** Capabilities that grant entry to *some* part of the platform admin area.
 * Used to decide whether to surface the admin section at all; individual
 * pages still gate on their own specific capability. */
const PLATFORM_ADMIN_CAPABILITIES: Capability[] = [
  Capability.usersRead,
  Capability.usersManage,
  Capability.guildsManage,
  Capability.contentModerate,
  Capability.auditRead,
  Capability.accessApprove,
  Capability.accessRead,
  Capability.configManage,
];

/** True iff the user can access at least one platform admin page. */
export function canAccessPlatformAdmin(user: WithCapabilities): boolean {
  return hasAnyCapability(user, PLATFORM_ADMIN_CAPABILITIES);
}
