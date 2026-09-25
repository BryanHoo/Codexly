import { describe, expect, it, vi } from "vitest";

import { openOfficialAuthUrl } from "./official-auth-navigation.js";

describe("Official provider authentication navigation", () => {
  it("opens the HTTPS authentication URL with the system URL opener", async () => {
    const openExternalUrl = vi.fn(async () => undefined);
    const authUrl = "https://auth.openai.com/oauth/authorize?client_id=codeagent";

    await openOfficialAuthUrl(authUrl, openExternalUrl);

    expect(openExternalUrl).toHaveBeenCalledOnce();
    expect(openExternalUrl).toHaveBeenCalledWith(authUrl);
  });

  it("rejects non-HTTPS authentication URLs", async () => {
    const openExternalUrl = vi.fn(async () => undefined);

    await expect(
      openOfficialAuthUrl("http://auth.openai.com/oauth/authorize", openExternalUrl),
    ).rejects.toThrow("Official login URL must use HTTPS");
    expect(openExternalUrl).not.toHaveBeenCalled();
  });
});
