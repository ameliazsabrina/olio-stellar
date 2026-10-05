// @vitest-environment happy-dom
import { render } from "@testing-library/react";

const captured = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
}));

vi.mock("@privy-io/react-auth", () => ({
  PrivyProvider: (props: Record<string, unknown>) => {
    captured.props = props;
    return props.children;
  },
}));

describe("PrivyAppProvider", () => {
  it("exposes only Google, passkey, and email login without auto-creating EVM wallets", async () => {
    vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", "privy-public-app");
    const { PrivyAppProvider } = await import(
      "../src/components/PrivyAppProvider"
    );
    render(
      <PrivyAppProvider>
        <div>child</div>
      </PrivyAppProvider>,
    );
    expect(captured.props?.appId).toBe("privy-public-app");
    expect(captured.props?.config).toMatchObject({
      loginMethods: ["google", "passkey", "email"],
      embeddedWallets: {
        ethereum: { createOnLogin: "off" },
        solana: { createOnLogin: "off" },
      },
    });
  });
});
