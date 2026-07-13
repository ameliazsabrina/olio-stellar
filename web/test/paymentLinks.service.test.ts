// @vitest-environment node
import { PaymentLinkStoreError } from "../src/server/modules/paymentLinks/paymentLinks.errors";

const mocks = vi.hoisted(() => ({
  insertOne: vi.fn(),
  findOne: vi.fn(),
  toArray: vi.fn(),
  sort: vi.fn(),
  find: vi.fn(),
}));

vi.mock("../src/server/db/mongo", () => ({
  getPaymentLinks: async () => ({
    insertOne: mocks.insertOne,
    findOne: mocks.findOne,
    find: mocks.find,
  }),
}));

import {
  createLink,
  getLink,
  listLinksByOwner,
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
      amount: "5000000",
      label: "Invoice #12",
    });

    expect(mocks.insertOne).toHaveBeenCalledTimes(1);
    const [doc] = mocks.insertOne.mock.calls[0];
    expect(doc.owner).toBe("alice");
    expect(doc.amount).toBe("5000000");
    expect(doc.label).toBe("Invoice #12");
    expect(doc.status).toBe("pending");
    expect(typeof doc._id).toBe("string");
    expect(doc._id.length).toBeGreaterThan(0);
    expect(doc.createdAt).toBeInstanceOf(Date);

    expect(out).toEqual({
      id: doc._id,
      owner: "alice",
      amount: "5000000",
      label: "Invoice #12",
      status: "pending",
      createdAt: doc.createdAt.toISOString(),
    });
  });

  it("stores nulls for an open-amount, unlabeled link", async () => {
    const out = await createLink({ username: "bob" });
    const [doc] = mocks.insertOne.mock.calls[0];
    expect(doc.amount).toBeNull();
    expect(doc.label).toBeNull();
    expect(out.amount).toBeNull();
    expect(out.label).toBeNull();
  });

  it("generates a unique id per call", async () => {
    await createLink({ username: "alice" });
    await createLink({ username: "alice" });
    const id1 = mocks.insertOne.mock.calls[0][0]._id;
    const id2 = mocks.insertOne.mock.calls[1][0]._id;
    expect(id1).not.toBe(id2);
  });

  it("throws PaymentLinkStoreError when the insert is not acknowledged", async () => {
    mocks.insertOne.mockResolvedValue({ acknowledged: false });
    await expect(createLink({ username: "alice" })).rejects.toBeInstanceOf(
      PaymentLinkStoreError,
    );
  });
});

describe("getLink", () => {
  it("maps a found doc to output", async () => {
    const createdAt = new Date("2026-07-11T00:00:00.000Z");
    mocks.findOne.mockResolvedValue({
      _id: "abc123",
      owner: "alice",
      amount: null,
      label: null,
      status: "pending",
      createdAt,
    });

    const out = await getLink("abc123");
    expect(mocks.findOne).toHaveBeenCalledWith({ _id: "abc123" });
    expect(out).toEqual({
      id: "abc123",
      owner: "alice",
      amount: null,
      label: null,
      status: "pending",
      createdAt: createdAt.toISOString(),
    });
  });

  it("returns null when the link does not exist", async () => {
    mocks.findOne.mockResolvedValue(null);
    expect(await getLink("missing")).toBeNull();
  });
});

describe("listLinksByOwner", () => {
  it("queries by owner, newest first, and maps results", async () => {
    const createdAt = new Date("2026-07-11T00:00:00.000Z");
    mocks.toArray.mockResolvedValue([
      {
        _id: "l1",
        owner: "alice",
        amount: "1000000",
        label: null,
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
        amount: "1000000",
        label: null,
        status: "pending",
        createdAt: createdAt.toISOString(),
      },
    ]);
  });
});
