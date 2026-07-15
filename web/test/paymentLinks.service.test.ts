// @vitest-environment node
import { createHash } from "node:crypto";
import {
  PaymentLinkStoreError,
  PaymentLinkUnauthorizedError,
} from "../src/server/modules/paymentLinks/paymentLinks.errors";

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const mocks = vi.hoisted(() => ({
  insertOne: vi.fn(),
  findOne: vi.fn(),
  findOneAndUpdate: vi.fn(),
  deleteOne: vi.fn(),
  toArray: vi.fn(),
  sort: vi.fn(),
  find: vi.fn(),
}));

vi.mock("../src/server/db/mongo", () => ({
  getPaymentLinks: async () => ({
    insertOne: mocks.insertOne,
    findOne: mocks.findOne,
    findOneAndUpdate: mocks.findOneAndUpdate,
    deleteOne: mocks.deleteOne,
    find: mocks.find,
  }),
}));

import {
  createLink,
  deleteLink,
  getLink,
  listLinksByOwner,
  resolveLink,
  setLinkArchived,
  updateLink,
} from "../src/server/modules/paymentLinks/paymentLinks.service";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.insertOne.mockResolvedValue({ acknowledged: true });
  mocks.find.mockReturnValue({ sort: mocks.sort });
  mocks.sort.mockReturnValue({ toArray: mocks.toArray });
  mocks.toArray.mockResolvedValue([]);
});

describe("createLink", () => {
  it("inserts a pending link with a generated id and returns its output", async () => {
    const out = await createLink({
      username: "alice",
      slug: "invoice-12",
      amount: "5000000",
      description: "Invoice #12",
    });

    expect(mocks.insertOne).toHaveBeenCalledTimes(1);
    const [doc] = mocks.insertOne.mock.calls[0];
    expect(doc.owner).toBe("alice");
    expect(doc.slug).toBe("invoice-12");
    expect(doc.amount).toBe("5000000");
    expect(doc.label).toBe("Invoice #12");
    expect(doc.description).toBe("Invoice #12");
    expect(doc.state).toBe("active");
    expect(doc.status).toBe("pending");
    expect(typeof doc._id).toBe("string");
    expect(doc._id.length).toBeGreaterThan(0);
    expect(doc.createdAt).toBeInstanceOf(Date);

    // stores only the hash; the raw token is returned once and never persisted
    expect(typeof out.manageToken).toBe("string");
    expect(out.manageToken.length).toBeGreaterThan(0);
    expect(doc.manageTokenHash).toBe(sha256Hex(out.manageToken));
    expect(doc).not.toHaveProperty("manageToken");

    const { manageToken, ...link } = out;
    expect(link).toEqual({
      id: doc._id,
      owner: "alice",
      slug: "invoice-12",
      amount: "5000000",
      description: "Invoice #12",
      label: "Invoice #12",
      status: "pending",
      state: "active",
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
      archivedAt: null,
    });
    expect(link).not.toHaveProperty("manageTokenHash");
  });

  it("generates a unique manage token per call", async () => {
    const a = await createLink({ username: "alice", slug: "one" });
    const b = await createLink({ username: "alice", slug: "two" });
    expect(a.manageToken).not.toBe(b.manageToken);
  });

  it("stores nulls for an open-amount, unlabeled link", async () => {
    const out = await createLink({ username: "bob", slug: "tips" });
    const [doc] = mocks.insertOne.mock.calls[0];
    expect(doc.amount).toBeNull();
    expect(doc.label).toBeNull();
    expect(doc.description).toBeNull();
    expect(out.amount).toBeNull();
    expect(out.label).toBeNull();
    expect(out.description).toBeNull();
  });

  it("generates a unique id per call", async () => {
    await createLink({ username: "alice", slug: "one" });
    await createLink({ username: "alice", slug: "two" });
    const id1 = mocks.insertOne.mock.calls[0][0]._id;
    const id2 = mocks.insertOne.mock.calls[1][0]._id;
    expect(id1).not.toBe(id2);
  });

  it("throws PaymentLinkStoreError when the insert is not acknowledged", async () => {
    mocks.insertOne.mockResolvedValue({ acknowledged: false });
    await expect(
      createLink({ username: "alice", slug: "invoice" }),
    ).rejects.toBeInstanceOf(PaymentLinkStoreError);
  });
});

describe("getLink", () => {
  it("maps a found doc to output", async () => {
    const createdAt = new Date("2026-07-11T00:00:00.000Z");
    mocks.findOne.mockResolvedValue({
      _id: "abc123",
      owner: "alice",
      slug: "tips",
      amount: null,
      description: "Tips",
      label: "Tips",
      state: "active",
      status: "pending",
      manageTokenHash: sha256Hex("secret"),
      createdAt,
      updatedAt: createdAt,
      archivedAt: null,
    });

    const out = await getLink("abc123");
    expect(mocks.findOne).toHaveBeenCalledWith({
      _id: "abc123",
      $or: [{ state: "active" }, { state: { $exists: false } }],
    });
    expect(out).not.toHaveProperty("manageTokenHash");
    expect(out).toEqual({
      id: "abc123",
      owner: "alice",
      slug: "tips",
      amount: null,
      description: "Tips",
      label: "Tips",
      status: "pending",
      state: "active",
      createdAt: createdAt.toISOString(),
      updatedAt: createdAt.toISOString(),
      archivedAt: null,
    });
  });

  it("returns null when the link does not exist", async () => {
    mocks.findOne.mockResolvedValue(null);
    expect(await getLink("missing")).toBeNull();
  });
});

describe("resolveLink", () => {
  it("queries active links by owner and slug", async () => {
    const createdAt = new Date("2026-07-11T00:00:00.000Z");
    mocks.findOne.mockResolvedValue({
      _id: "abc123",
      owner: "alice",
      slug: "tips",
      amount: null,
      description: null,
      label: null,
      state: "active",
      status: "pending",
      createdAt,
    });

    const out = await resolveLink({ owner: "alice", slug: "tips" });
    expect(mocks.findOne).toHaveBeenCalledWith({
      owner: "alice",
      slug: "tips",
      state: "active",
    });
    expect(out?.slug).toBe("tips");
  });
});

describe("listLinksByOwner", () => {
  it("queries by owner, newest first, and maps results", async () => {
    const createdAt = new Date("2026-07-11T00:00:00.000Z");
    mocks.toArray.mockResolvedValue([
      {
        _id: "l1",
        owner: "alice",
        slug: "tips",
        amount: "1000000",
        description: null,
        label: null,
        state: "active",
        status: "pending",
        createdAt,
      },
    ]);

    const out = await listLinksByOwner({ owner: "alice" });
    expect(mocks.find).toHaveBeenCalledWith({ owner: "alice" });
    expect(mocks.sort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(out).toEqual([
      {
        id: "l1",
        owner: "alice",
        slug: "tips",
        amount: "1000000",
        description: null,
        label: null,
        status: "pending",
        state: "active",
        createdAt: createdAt.toISOString(),
        updatedAt: null,
        archivedAt: null,
      },
    ]);
  });
});

const TOKEN = "correct-manage-token";

function storedDoc(overrides: Record<string, unknown> = {}) {
  const createdAt = new Date("2026-07-11T00:00:00.000Z");
  return {
    _id: "l1",
    owner: "alice",
    slug: "tips",
    amount: null,
    description: null,
    label: null,
    state: "active",
    status: "pending",
    manageTokenHash: sha256Hex(TOKEN),
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
    ...overrides,
  };
}

describe("updateLink", () => {
  it("looks up by id, verifies the token, and updates without an owner filter", async () => {
    mocks.findOne.mockResolvedValue(storedDoc());
    mocks.findOneAndUpdate.mockResolvedValue(
      storedDoc({ amount: "2000000", description: "Updated", label: "Updated" }),
    );

    const out = await updateLink({
      id: "l1",
      manageToken: TOKEN,
      amount: "2000000",
      description: "Updated",
    });

    expect(mocks.findOne).toHaveBeenCalledWith({ _id: "l1" });
    expect(mocks.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: "l1" },
      expect.objectContaining({
        $set: expect.objectContaining({
          amount: "2000000",
          description: "Updated",
        }),
      }),
      { returnDocument: "after" },
    );
    expect(out.description).toBe("Updated");
    expect(out).not.toHaveProperty("manageTokenHash");
    expect(out).not.toHaveProperty("manageToken");
  });

  it("rejects a wrong token without touching the document", async () => {
    mocks.findOne.mockResolvedValue(storedDoc());
    await expect(
      updateLink({
        id: "l1",
        manageToken: "wrong-token",
        amount: "2000000",
        description: "Updated",
      }),
    ).rejects.toBeInstanceOf(PaymentLinkUnauthorizedError);
    expect(mocks.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("rejects a legacy tokenless link", async () => {
    mocks.findOne.mockResolvedValue(storedDoc({ manageTokenHash: undefined }));
    await expect(
      updateLink({
        id: "l1",
        manageToken: TOKEN,
        amount: "2000000",
        description: "Updated",
      }),
    ).rejects.toBeInstanceOf(PaymentLinkUnauthorizedError);
  });

  it("rejects a missing link with the same error as a bad token", async () => {
    mocks.findOne.mockResolvedValue(null);
    await expect(
      updateLink({
        id: "enumerated-id",
        manageToken: TOKEN,
        amount: "2000000",
        description: "Updated",
      }),
    ).rejects.toBeInstanceOf(PaymentLinkUnauthorizedError);
    expect(mocks.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe("setLinkArchived", () => {
  it("archives after verifying the token", async () => {
    mocks.findOne.mockResolvedValue(storedDoc());
    mocks.findOneAndUpdate.mockResolvedValue(
      storedDoc({ state: "archived", archivedAt: new Date() }),
    );

    const out = await setLinkArchived({
      id: "l1",
      manageToken: TOKEN,
      archived: true,
    });

    expect(mocks.findOne).toHaveBeenCalledWith({ _id: "l1" });
    expect(mocks.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: "l1" },
      expect.objectContaining({
        $set: expect.objectContaining({ state: "archived" }),
      }),
      { returnDocument: "after" },
    );
    expect(out.state).toBe("archived");
  });

  it("rejects a wrong token", async () => {
    mocks.findOne.mockResolvedValue(storedDoc());
    await expect(
      setLinkArchived({ id: "l1", manageToken: "nope", archived: true }),
    ).rejects.toBeInstanceOf(PaymentLinkUnauthorizedError);
    expect(mocks.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe("deleteLink", () => {
  it("deletes by id after verifying the token", async () => {
    mocks.findOne.mockResolvedValue(storedDoc());
    mocks.deleteOne.mockResolvedValue({ deletedCount: 1 });

    await expect(deleteLink({ id: "l1", manageToken: TOKEN })).resolves.toBe(
      true,
    );
    expect(mocks.findOne).toHaveBeenCalledWith({ _id: "l1" });
    expect(mocks.deleteOne).toHaveBeenCalledWith({ _id: "l1" });
  });

  it("rejects an enumerated id with a wrong token and never deletes", async () => {
    mocks.findOne.mockResolvedValue(storedDoc());
    await expect(
      deleteLink({ id: "l1", manageToken: "guessed" }),
    ).rejects.toBeInstanceOf(PaymentLinkUnauthorizedError);
    expect(mocks.deleteOne).not.toHaveBeenCalled();
  });
});
