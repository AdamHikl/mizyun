# REC-03 local verification artifacts

These are synthetic/local engineering records. The PostgreSQL17.6 verification database was separately created inside the existing local disposable Supabase container, from a schema-only dump with no records. Apply migration20261013090000 to a fresh disposable database, run0043pgTAP, then independent backend sessions for concurrent identity/lifecycle checks. The retained verification script shows exact local commands; its database must be created empty first and must never target Dev/Production.50assertions and six independent-session outcomes passed with zero provider calls.

Candidate/review/full-gate receipts now record the accepted source and explicit remaining gates. Exact source baseline and exclusions are described in the linked [stage evidence](../../AI_MEAL_RECIPES_REC03_EVIDENCE_2026-10-13.md). Old unfiltered shared-tree test invocations were not accepted as package evidence; the frozen isolated focused suite is authoritative.
