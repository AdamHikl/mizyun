-- NUTR-PRO-001: additive optional nutrients on confirmed food entries.
-- Existing rows remain unknown (NULL). Existing owner RLS and user/time index apply.
alter table public.food_entries
  add column if not exists fibre_g numeric(8, 2) check (fibre_g >= 0 and fibre_g <= 10000),
  add column if not exists saturated_fat_g numeric(8, 2) check (saturated_fat_g >= 0 and saturated_fat_g <= 10000),
  add column if not exists total_sugars_g numeric(8, 2) check (total_sugars_g >= 0 and total_sugars_g <= 10000),
  add column if not exists sodium_mg numeric(8, 2) check (sodium_mg >= 0 and sodium_mg <= 100000),
  add column if not exists cholesterol_mg numeric(8, 2) check (cholesterol_mg >= 0 and cholesterol_mg <= 100000);

alter table public.food_entries
  add constraint food_entries_saturated_lte_fat check
    (saturated_fat_g is null or fat_g is null or saturated_fat_g <= fat_g),
  add constraint food_entries_sugars_lte_carbs check
    (total_sugars_g is null or carbohydrate_g is null or total_sugars_g <= carbohydrate_g);

-- API checks give a friendly error; this trigger also protects direct Data API writes.
-- A lapsed user may retain, correct, or clear an existing value, but may not add a new one.
create or replace function public.enforce_advanced_food_nutrition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_adding boolean;
begin
  if v_uid is null then
    return new; -- server maintenance/migration; ordinary anonymous writes are blocked by RLS
  end if;

  if new.user_id <> v_uid then
    raise exception 'food entry owner mismatch' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    v_adding := new.fibre_g is not null or new.saturated_fat_g is not null
      or new.total_sugars_g is not null or new.sodium_mg is not null
      or new.cholesterol_mg is not null;
  else
    v_adding :=
      (old.fibre_g is null and new.fibre_g is not null)
      or (old.saturated_fat_g is null and new.saturated_fat_g is not null)
      or (old.total_sugars_g is null and new.total_sugars_g is not null)
      or (old.sodium_mg is null and new.sodium_mg is not null)
      or (old.cholesterol_mg is null and new.cholesterol_mg is not null);
  end if;

  if v_adding and not (
    exists (select 1 from public.beta_pro_requests where user_id = v_uid and status = 'approved')
    or exists (select 1 from public.profiles where id = v_uid and plan_tier = 'paid')
  ) then
    raise exception 'advanced nutrition requires Pro' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_advanced_food_nutrition() from public;
drop trigger if exists food_entries_advanced_nutrition_guard on public.food_entries;
create trigger food_entries_advanced_nutrition_guard
  before insert or update on public.food_entries
  for each row execute function public.enforce_advanced_food_nutrition();
