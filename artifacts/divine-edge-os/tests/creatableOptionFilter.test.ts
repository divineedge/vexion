import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { filterCreatableOptions, optionMatchesFilter } from "../src/lib/creatableOptionFilter";

const sizes = [
  { value: "1", label: '1/8"' },
  { value: "2", label: '1/2"' },
  { value: "3", label: '1 1/2"' },
  { value: "4", label: '3/4"' },
  { value: "5", label: "1 gal", detail: "1 gallons" },
  { value: "6", label: "2.5 gal", detail: "2.5 gallons" },
  { value: "7", label: "Jug", detail: "1 gallons · 1000 sq ft" },
  { value: "8", label: "Bag", detail: "5 pounds" },
];

describe("creatable option filter", () => {
  it("narrows a size list to labels that contain the typed text", () => {
    expect(filterCreatableOptions(sizes, "1/2").map(option => option.label)).toEqual(['1/2"', '1 1/2"']);
    expect(filterCreatableOptions(sizes, "gal").map(option => option.label)).toEqual(["1 gal", "2.5 gal", "Jug"]);
    expect(filterCreatableOptions(sizes, "  GAL ").map(option => option.label)).toEqual(["1 gal", "2.5 gal", "Jug"]);
  });

  it("matches the detail line and keeps the full list when the query is blank", () => {
    expect(optionMatchesFilter({ label: "Bag", detail: "5 pounds" }, "pound")).toBe(true);
    expect(filterCreatableOptions(sizes, "sq ft").map(option => option.label)).toEqual(["Jug"]);
    expect(filterCreatableOptions(sizes, "")).toEqual(sizes);
    expect(filterCreatableOptions(sizes, "   ")).toEqual(sizes);
    expect(filterCreatableOptions(sizes, "nope")).toEqual([]);
  });

  it("keeps type-to-filter, keyboard movement, and the existing option controls", () => {
    const menu = readFileSync(new URL("../src/components/inventory/CreatableOptionMenu.tsx", import.meta.url), "utf8");
    expect(menu).toContain("filterCreatableOptions");
    expect(menu).toContain('data-testid={`${testId}-filter`}');
    expect(menu).toContain("Type to filter");
    expect(menu).toContain('event.key === "ArrowDown"');
    expect(menu).toContain('event.key === "ArrowUp"');
    expect(menu).toContain("onCloseAutoFocus={event => event.preventDefault()}");
    expect(menu).toContain("PopoverContent");
    expect(menu).not.toContain("<Popover open={open} onOpenChange={next => { if (!disabled) setOpen(next); }} modal>");
    expect(menu).toContain("Volume amount");
    expect(menu).toContain("Coverage amount");
    expect(menu).toContain("Edit ");
    expect(menu).toContain("Merge ");
    expect(menu).toContain("Delete ");
    expect(menu).toContain("onAdd");
  });
});
