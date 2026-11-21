-- Custom pass-through lines are extra keys inside the existing line-item JSON.
-- Existing line objects are not rewritten. A custom line is
-- {kind:"custom", description, qty or quantity, unit, internalCost, unitPrice}
-- with service id and part id left null. It does not deduct inventory.

COMMENT ON COLUMN estimates.line_items IS 'Line item JSON array. Existing objects stay as stored. A custom pass-through line adds kind custom, description, qty, optional unit, optional internalCost, and unitPrice, with null serviceId and inventoryItemId.';
COMMENT ON COLUMN invoices.line_items IS 'Line item JSON array. Existing objects stay as stored. A custom pass-through line adds kind custom, description, quantity, optional unit, optional internalCost, and unitPrice, with null serviceId and inventoryItemId.';
COMMENT ON COLUMN jobs.line_items IS 'Same line shape as estimates.line_items, including optional custom pass-through lines. Existing objects stay as stored.';
