-- Add the DEPOSIT transaction type: a later top-up of virtual capital,
-- distinct from OPENING_BALANCE (the initial funding at sign-up).
--
-- This has to be its own migration. Postgres will not let a newly added enum
-- value be referenced by name in the same transaction that adds it, so the
-- CHECK constraint that references 'DEPOSIT' lives in the next migration
-- instead, once this one has committed.
ALTER TYPE "TransactionType" ADD VALUE 'DEPOSIT';
