import { afterEach, describe, expect, it, vi } from "vitest";
import {
  draftInput,
  generateDraft,
  validateDraft,
} from "../src/server/modules/aiDrafts/aiDrafts.service";
import { aiDraftsRouter } from "../src/server/modules/aiDrafts/aiDrafts.router";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("AI payment drafts", () => {
  it.each([
    ["Request 750 USDC for design", "750", "750"],
    ["Tagih 25.50 USDC untuk desain", "25.50", "25.50"],
    ["Request 750 USDC", "999", null],
    ["Request 750.000 USDC", "750.000", null],
    ["Tagih Rp750.000", "750000", null],
    ["Request 750 USD", "750", null],
    ["Request 750 USDC or 500 EUR", "750", null],
    ["Request 750 USDC, actually 500 USDC", "500", null],
    ["Request 750 USDC, actually make it 500", "750", null],
    ["Request -50 USDC", "50", null],
    ["Request 0 USDC", "0", null],
    ["Request 1,000 USDC", "000", null],
    ["Request payment for design", "50", null],
  ])("validates amounts against source: %s", (text, amount, expected) => {
    expect(validateDraft(text, { amount, description: "design" }).amount).toBe(
      expected,
    );
  });
  it("rejects malformed fields and extra actions", () => {
    expect(() =>
      validateDraft("50 USDC", { amount: 50, description: "design" }),
    ).toThrow();
    expect(() =>
      validateDraft("50 USDC", {
        amount: "50",
        description: "design",
        send: true,
      }),
    ).toThrow();
    expect(draftInput.safeParse({ text: "a".repeat(2001) }).success).toBe(
      false,
    );
  });
  it("does not call a model while disabled", async () => {
    vi.stubEnv("OLIO_AI_DRAFTS_ENABLED", "false");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(generateDraft("50 USDC")).rejects.toThrow("not enabled");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("uses Qwen without thinking and verifies its response", async () => {
    vi.stubEnv("OLIO_AI_DRAFTS_ENABLED", "true");
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            done: true,
            message: { content: '{"description":"design","amount":"50"}' },
          }),
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    expect((await generateDraft("50 USDC for design")).amount).toBe("50");
    const request = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(request).toMatchObject({
      model: "qwen3:0.6b",
      think: false,
      stream: false,
    });
    expect(request.messages).toHaveLength(2);
  });
  it("rejects truncated model output", async () => {
    vi.stubEnv("OLIO_AI_DRAFTS_ENABLED", "true");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({
              done: true,
              done_reason: "length",
              message: { content: "{}" },
            }),
          ),
        ),
    );
    await expect(generateDraft("50 USDC")).rejects.toThrow("Incomplete");
  });
  it("requires authentication", async () => {
    const caller = aiDraftsRouter.createCaller({
      ip: "127.0.0.1",
      authToken: null,
      privyUserId: null,
      privyClaim: null,
      authError: null,
    });
    await expect(caller.generate({ text: "50 USDC" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});
