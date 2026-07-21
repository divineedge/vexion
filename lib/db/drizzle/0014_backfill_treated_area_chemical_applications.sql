-- Backfill treatedArea and areaUnit on historical chemical_applications rows
-- where treatedArea IS NULL, using the linked property's size/sizeUnit
-- via the job → property join.
UPDATE chemical_applications ca
SET
  treated_area = p.size,
  area_unit    = COALESCE(p.size_unit, 'sqft')
FROM jobs j
JOIN properties p ON p.id = j.property_id
WHERE ca.job_id    = j.id
  AND ca.treated_area IS NULL
  AND p.size IS NOT NULL
  AND p.size > 0;
