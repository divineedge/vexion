-- Backfill billing_date on historical auto-generated invoices so the unique
-- partial index (invoices_template_customer_billing_date_uidx) covers existing
-- rows in addition to new inserts.
--
-- Sets billing_date = date(created_at AT TIME ZONE 'UTC') for every invoice
-- that was produced by the recurring-billing scheduler (generated_from_template_id
-- IS NOT NULL) but pre-dates the column (billing_date IS NULL).
--
-- Safety guard: because the unique partial index already exists on
-- (generated_from_template_id, customer_id, billing_date), any UPDATE that
-- would produce two rows with the same tuple raises a unique-violation and
-- aborts the migration. To surface this clearly rather than producing a
-- confusing constraint error, the script checks for duplicate groups FIRST and
-- raises an explicit exception listing the colliding invoice IDs. A human
-- operator must resolve them (e.g. void the extra invoice) before re-running.
-- Only after a clean duplicate check does the UPDATE proceed.

DO $$
DECLARE
  rec        RECORD;
  dup_count  INTEGER := 0;
  dup_msg    TEXT    := '';
  row_count  INTEGER;
BEGIN
  -- -----------------------------------------------------------------------
  -- Step 1: detect any (template, customer, date) groups that contain more
  -- than one row — these would cause a unique-violation on the UPDATE below.
  -- -----------------------------------------------------------------------
  FOR rec IN
    SELECT
      generated_from_template_id,
      customer_id,
      date(created_at AT TIME ZONE 'UTC') AS billing_date,
      count(*)                            AS invoice_count,
      array_agg(id ORDER BY id)           AS invoice_ids
    FROM invoices
    WHERE generated_from_template_id IS NOT NULL
      AND billing_date IS NULL
    GROUP BY
      generated_from_template_id,
      customer_id,
      date(created_at AT TIME ZONE 'UTC')
    HAVING count(*) > 1
  LOOP
    dup_count := dup_count + 1;
    dup_msg := dup_msg ||
      format(
        E'\n  template_id=%s  customer_id=%s  billing_date=%s  invoice_ids=%s',
        rec.generated_from_template_id,
        rec.customer_id,
        rec.billing_date,
        rec.invoice_ids
      );
  END LOOP;

  -- -----------------------------------------------------------------------
  -- Step 2: if any duplicates were found, fail loudly so an operator can
  -- review and void the extra invoices before re-running the migration.
  -- -----------------------------------------------------------------------
  IF dup_count > 0 THEN
    RAISE EXCEPTION
      E'billing_date backfill aborted: % duplicate group(s) detected.\n'
      'Resolve each group (e.g. void the extra invoice) then re-run.\n%',
      dup_count, dup_msg;
  END IF;

  -- -----------------------------------------------------------------------
  -- Step 3: no duplicates — safe to backfill all unset rows.
  -- -----------------------------------------------------------------------
  UPDATE invoices
  SET billing_date = date(created_at AT TIME ZONE 'UTC')
  WHERE generated_from_template_id IS NOT NULL
    AND billing_date IS NULL;

  GET DIAGNOSTICS row_count = ROW_COUNT;
  RAISE NOTICE 'billing_date backfill complete: % invoice row(s) updated.', row_count;
END;
$$;
