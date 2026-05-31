import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  approveAccessGrantApiV1AccessGrantsGrantIdApprovePost,
  cancelAccessRequestApiV1AccessGrantsGrantIdDelete,
  createAccessRequestApiV1AccessGrantsPost,
  denyAccessGrantApiV1AccessGrantsGrantIdDenyPost,
  listAccessGrantsApiV1AccessGrantsGet,
  revokeAccessGrantApiV1AccessGrantsGrantIdRevokePost,
} from "@/api/generated/access-grants/access-grants";
import type {
  AccessGrantApprove,
  AccessGrantCreate,
  AccessGrantRead,
} from "@/api/generated/initiativeAPI.schemas";
import type { MutationOpts } from "@/types/mutation";
import type { QueryOpts } from "@/types/query";

// Shared key prefix so any grant mutation refreshes every grant list.
const ACCESS_GRANTS_KEY = ["access-grants"] as const;

// Cap the "my requests" history so a churny PAM user's list (and its payload)
// can't grow unbounded. Grants are returned newest-first, and the page floats
// pending/live ones to the top, so the actionable items are always shown.
export const MY_GRANTS_LIMIT = 25;

function useInvalidateAccessGrants() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ACCESS_GRANTS_KEY });
}

/** The current user's own access requests. */
export const useMyAccessGrants = (options?: QueryOpts<AccessGrantRead[]>) =>
  useQuery<AccessGrantRead[]>({
    queryKey: [...ACCESS_GRANTS_KEY, "mine"],
    queryFn: () =>
      listAccessGrantsApiV1AccessGrantsGet({
        mine: true,
        limit: MY_GRANTS_LIMIT,
      }) as unknown as Promise<AccessGrantRead[]>,
    ...options,
  });

/** The full queue filtered by status — requires access.read (approvers). */
export const useAccessGrantQueue = (
  status: string | undefined,
  options?: QueryOpts<AccessGrantRead[]>
) =>
  useQuery<AccessGrantRead[]>({
    queryKey: [...ACCESS_GRANTS_KEY, "queue", status ?? "all"],
    queryFn: () =>
      listAccessGrantsApiV1AccessGrantsGet({
        mine: false,
        status,
      }) as unknown as Promise<AccessGrantRead[]>,
    ...options,
  });

export const useCreateAccessRequest = (
  options?: MutationOpts<AccessGrantRead, AccessGrantCreate>
) => {
  const invalidate = useInvalidateAccessGrants();
  const { onSuccess, ...rest } = options ?? {};
  return useMutation({
    ...rest,
    mutationFn: (payload: AccessGrantCreate) =>
      createAccessRequestApiV1AccessGrantsPost(payload) as unknown as Promise<AccessGrantRead>,
    onSuccess: (...args) => {
      void invalidate();
      onSuccess?.(...args);
    },
  });
};

export const useApproveAccessGrant = (
  options?: MutationOpts<AccessGrantRead, { grantId: number; payload?: AccessGrantApprove }>
) => {
  const invalidate = useInvalidateAccessGrants();
  const { onSuccess, ...rest } = options ?? {};
  return useMutation({
    ...rest,
    mutationFn: ({ grantId, payload }: { grantId: number; payload?: AccessGrantApprove }) =>
      approveAccessGrantApiV1AccessGrantsGrantIdApprovePost(
        grantId,
        payload ?? {}
      ) as unknown as Promise<AccessGrantRead>,
    onSuccess: (...args) => {
      void invalidate();
      onSuccess?.(...args);
    },
  });
};

export const useDenyAccessGrant = (options?: MutationOpts<AccessGrantRead, number>) => {
  const invalidate = useInvalidateAccessGrants();
  const { onSuccess, ...rest } = options ?? {};
  return useMutation({
    ...rest,
    mutationFn: (grantId: number) =>
      denyAccessGrantApiV1AccessGrantsGrantIdDenyPost(
        grantId
      ) as unknown as Promise<AccessGrantRead>,
    onSuccess: (...args) => {
      void invalidate();
      onSuccess?.(...args);
    },
  });
};

export const useRevokeAccessGrant = (options?: MutationOpts<AccessGrantRead, number>) => {
  const invalidate = useInvalidateAccessGrants();
  const { onSuccess, ...rest } = options ?? {};
  return useMutation({
    ...rest,
    mutationFn: (grantId: number) =>
      revokeAccessGrantApiV1AccessGrantsGrantIdRevokePost(
        grantId
      ) as unknown as Promise<AccessGrantRead>,
    onSuccess: (...args) => {
      void invalidate();
      onSuccess?.(...args);
    },
  });
};

export const useCancelAccessRequest = (options?: MutationOpts<void, number>) => {
  const invalidate = useInvalidateAccessGrants();
  const { onSuccess, ...rest } = options ?? {};
  return useMutation({
    ...rest,
    mutationFn: (grantId: number) =>
      cancelAccessRequestApiV1AccessGrantsGrantIdDelete(grantId) as unknown as Promise<void>,
    onSuccess: (...args) => {
      void invalidate();
      onSuccess?.(...args);
    },
  });
};
