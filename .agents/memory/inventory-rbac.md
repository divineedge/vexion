---
name: Inventory RBAC
description: Role-based access rules for inventory mutations and cost-price visibility
---

## Rule
**Mutations (POST, PATCH, DELETE):**
- Technicians → 403 Forbidden (server-enforced via `requireInventoryMutate` middleware)
- All other roles (owner, office_manager, employee) → allowed

**Cost price visibility (`costPrice` field in API response):**
- `company_owner`, `office_manager`, `employee` → always returned
- `technician` → only returned when tenant setting `showCostPriceToTech === true`

**Frontend (`canSeeCost`):**
- `!isTechnician || showCostPriceToTech` (matches API behavior above)

**Why:** Technicians should not know the business's buy price margin or be able to adjust inventory counts independently. UI-only restrictions are bypassable via direct API calls; the middleware is the authoritative enforcement layer.

**How to apply:** Before adding any new inventory mutation endpoint, apply the `requireInventoryMutate` middleware. For responses containing pricing, pass the result of `canSeeCostPrice()` to `formatItem()`.
