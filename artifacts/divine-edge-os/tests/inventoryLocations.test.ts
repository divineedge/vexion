import { describe, expect, it } from "vitest";
import { upsertInventoryLocation } from "../src/lib/inventoryLocations";

describe("upsertInventoryLocation", () => {
  it("adds a new location to the cached list without waiting for a refetch", () => {
    const next = upsertInventoryLocation(
      [{ id: 2, name: "Warehouse" }],
      { id: 5, name: "Crew Trailer" },
    );
    expect(next.map(location => location.name)).toEqual(["Crew Trailer", "Warehouse"]);
  });

  it("replaces an existing location instead of duplicating it", () => {
    const next = upsertInventoryLocation(
      [{ id: 5, name: "Old name" }],
      { id: 5, name: "Crew Trailer" },
    );
    expect(next).toEqual([{ id: 5, name: "Crew Trailer" }]);
  });
});
