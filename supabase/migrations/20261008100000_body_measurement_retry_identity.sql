-- REL-AUD-007 / Q2: older clients retain keyless append behavior. Current clients
-- persist identity and the immutable measured_at/payload before dispatch.
-- Existing authenticated grants, owner RLS, and user/time index remain in force.
alter table public.body_measurements
  add column if not exists client_operation_id uuid null;

create unique index if not exists body_measurements_user_client_op_idx
  on public.body_measurements(user_id, client_operation_id)
  where client_operation_id is not null;
