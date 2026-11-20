import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { listCanConsumeWheel, shouldKeepWheelOnList, type ScrollSnapshot } from "../src/lib/keepWheelScroll";

const overflowing: ScrollSnapshot = {
  overflowY: "auto",
  scrollTop: 40,
  scrollHeight: 400,
  clientHeight: 200,
};

describe("portaled option list wheel", () => {
  it("keeps the wheel on a list that can still scroll down or up", () => {
    expect(listCanConsumeWheel(overflowing, 80)).toBe(true);
    expect(listCanConsumeWheel(overflowing, -40)).toBe(true);
    expect(shouldKeepWheelOnList(80, [
      { overflowY: "visible", scrollTop: 0, scrollHeight: 20, clientHeight: 20 },
      overflowing,
    ])).toBe(true);
  });

  it("lets the dialog lock handle a wheel at the end of the list", () => {
    expect(listCanConsumeWheel({ ...overflowing, scrollTop: 200 }, 40)).toBe(false);
    expect(listCanConsumeWheel({ ...overflowing, scrollTop: 0 }, -20)).toBe(false);
    expect(listCanConsumeWheel({ ...overflowing, overflowY: "hidden" }, 40)).toBe(false);
    expect(listCanConsumeWheel({ ...overflowing, scrollHeight: 200 }, 40)).toBe(false);
    expect(shouldKeepWheelOnList(0, [overflowing])).toBe(false);
    expect(shouldKeepWheelOnList(40, [
      { overflowY: "auto", scrollTop: 0, scrollHeight: 100, clientHeight: 100 },
    ])).toBe(false);
  });

  it("is wired into the shared popover used by option lists", () => {
    const popover = readFileSync(new URL("../src/components/ui/popover.tsx", import.meta.url), "utf8");
    const menu = readFileSync(new URL("../src/components/inventory/CreatableOptionMenu.tsx", import.meta.url), "utf8");
    const picker = readFileSync(new URL("../src/components/shared/SearchableCombobox.tsx", import.meta.url), "utf8");
    expect(popover).toContain("useKeepWheelScroll");
    expect(menu).toContain("PopoverContent");
    expect(picker).toContain("PopoverContent");
  });
});
