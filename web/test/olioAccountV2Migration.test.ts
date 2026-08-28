// @vitest-environment node
import { up } from "../migrations/20260816090000-olio-account-v2.js";

describe("Olio account v2 migration", () => {
  it("drops unique legacy indexes before unsetting their fields", async () => {
    const users = {
      indexes: vi
        .fn()
        .mockResolvedValue([
          { name: "_id_" },
          { name: "address_1" },
          { name: "credentialId_unique" },
        ]),
      dropIndex: vi.fn().mockResolvedValue(undefined),
      updateMany: vi.fn().mockResolvedValue(undefined),
    };
    const db = { collection: vi.fn().mockReturnValue(users) };

    await up(db);

    expect(users.dropIndex).toHaveBeenNthCalledWith(1, "address_1");
    expect(users.dropIndex).toHaveBeenNthCalledWith(2, "credentialId_unique");
    expect(users.dropIndex.mock.invocationCallOrder[1]).toBeLessThan(
      users.updateMany.mock.invocationCallOrder[0],
    );
    expect(users.updateMany).toHaveBeenCalledWith(
      {},
      {
        $unset: {
          address: "",
          contractId: "",
          credentialId: "",
          secp256r1PubKey: "",
          migrationState: "",
          privySignerVerifiedAt: "",
          migratedAt: "",
        },
      },
    );
  });

  it("remains safe when a previous attempt already removed an index", async () => {
    const users = {
      indexes: vi.fn().mockResolvedValue([{ name: "_id_" }]),
      dropIndex: vi.fn(),
      updateMany: vi.fn().mockResolvedValue(undefined),
    };
    const db = { collection: vi.fn().mockReturnValue(users) };

    await up(db);

    expect(users.dropIndex).not.toHaveBeenCalled();
    expect(users.updateMany).toHaveBeenCalledOnce();
  });
});
