-- Enforce one invoice per job to prevent silent double-counting in P&L and
-- job-profitability reports. Both reports LEFT JOIN invoices to jobs on
-- invoices.job_id = jobs.id. Without this constraint, two invoice rows sharing
-- the same job_id produce two result rows for that job, doubling reported
-- revenue, parts cost, and labor cost with no error or warning.
--
-- Dedup step: if any duplicate job_id rows already exist, keep the most-recent
-- invoice (highest id) and nullify job_id on the older duplicates so they are
-- preserved as standalone invoices rather than deleted.
UPDATE invoices
SET job_id = NULL
WHERE id IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY id DESC) AS rn
    FROM invoices
    WHERE job_id IS NOT NULL
  ) ranked
  WHERE rn > 1
);

-- Partial unique index: only non-null job_id values are constrained.
-- Plan-cycle invoices legitimately have job_id = NULL and must remain unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS invoices_job_id_uidx
  ON invoices (job_id)
  WHERE job_id IS NOT NULL;
