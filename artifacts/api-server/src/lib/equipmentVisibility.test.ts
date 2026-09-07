import { describe, expect, it } from "vitest";
import { hasEquipmentVisibility } from "./equipmentVisibility";

describe("equipment row visibility", () => {
  it.each(["company_owner", "office_manager", "department_manager"])(
    "allows %s to see unassigned equipment",
    role => expect(hasEquipmentVisibility(role, 9, new Set(), {
      assignedUserId: null,
      assignedCrewId: null,
    })).toBe(true),
  );

  it("allows a field user through a direct assignment", () => {
    expect(hasEquipmentVisibility("technician", 9, new Set(), {
      assignedUserId: 9,
      assignedCrewId: null,
    })).toBe(true);
  });

  it("allows a current crew member through a crew assignment", () => {
    expect(hasEquipmentVisibility("crew_manager", 9, new Set([4]), {
      assignedUserId: null,
      assignedCrewId: 4,
    })).toBe(true);
  });

  it("denies nonmembers and unassigned equipment to field roles", () => {
    expect(hasEquipmentVisibility("technician", 9, new Set([5]), {
      assignedUserId: 8,
      assignedCrewId: 4,
    })).toBe(false);
    expect(hasEquipmentVisibility("technician", 9, new Set(), {
      assignedUserId: null,
      assignedCrewId: null,
    })).toBe(false);
  });
});