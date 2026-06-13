import { useParams } from "@tanstack/react-router";

/**
 * The active guild id, read from the `/g/$guildId` route segment.
 *
 * Guild-scoped API hooks read this and pass it to the path-based
 * (`/api/v1/g/{guild_id}/...`) generated client. Valid only inside the guild
 * route tree; personal/cross-guild pages (`/me/*`) call the dedicated
 * cross-guild endpoints instead and do not use this hook.
 */
export function useActiveGuildId(): number {
  const params = useParams({ strict: false }) as { guildId?: string };
  return Number(params.guildId);
}
