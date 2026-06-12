/**
 * Tests for the guild-context response echo guard on apiClient.
 *
 * The backend stamps `X-Resolved-Guild` on responses it resolved under the
 * user's ambient (server-held) guild context. If the SPA has switched
 * contexts while a request was in flight, the response must be discarded —
 * never painted into the new context. Explicitly guild-addressed calls are
 * not stamped and must pass through.
 */
import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, it } from "vitest";

import { server } from "@/__tests__/helpers/msw-server";
import { apiClient, GUILD_CONTEXT_SWITCHED, setCurrentGuildId } from "@/api/client";

const respondWithEcho = (echo?: string) =>
  http.get("/api/v1/echo-test", () =>
    HttpResponse.json([], {
      headers: echo === undefined ? {} : { "X-Resolved-Guild": echo },
    })
  );

describe("guild-context echo guard", () => {
  afterEach(() => {
    setCurrentGuildId(null);
  });

  it("passes responses whose echo matches the current context", async () => {
    server.use(respondWithEcho("5"));
    setCurrentGuildId(5);
    const response = await apiClient.get("/echo-test");
    expect(response.status).toBe(200);
  });

  it("discards responses resolved under a context we've since left", async () => {
    server.use(respondWithEcho("5"));
    setCurrentGuildId(7); // switched while the request was in flight
    await expect(apiClient.get("/echo-test")).rejects.toMatchObject({
      code: GUILD_CONTEXT_SWITCHED,
    });
  });

  it("passes unstamped responses regardless of context", async () => {
    server.use(respondWithEcho(undefined));
    setCurrentGuildId(7);
    const response = await apiClient.get("/echo-test");
    expect(response.status).toBe(200);
  });
});
