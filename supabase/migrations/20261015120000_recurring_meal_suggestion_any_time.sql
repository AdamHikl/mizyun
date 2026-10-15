-- Recurring meal suggestions: stop requiring a 90-minute window.
--
-- A copied meal is saved at the moment the user taps Copy, not when they
-- usually eat it. The same item on three consecutive days is the habit
-- signal; the proposed time stays the rounded median and the user can edit it
-- before accepting. Everything else in the validator is unchanged. Policy
-- version mrs-exact-3-v1 is kept because every proposal valid under the
-- previous rule remains valid under this one.
create or replace function public.recurring_suggestion_validate(p_user uuid,p_proposal jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e jsonb; f public.food_entries; src public.food_entries; ident jsonb; other_ident jsonb;
  tuples jsonb:='[]'; minutes integer[]:='{}'; d date; zone text; family text;
  time text; median integer; digest text; candidate text; n integer:=0; expiry timestamptz; state public.recurring_meal_suggestion_states;
begin
 if p_proposal is null or jsonb_typeof(p_proposal)<>'object' or jsonb_typeof(p_proposal->'evidence')<>'array' or jsonb_array_length(p_proposal->'evidence')<>3
   or not(p_proposal ?& array['candidateId','familyKey','sourceEntryId','sourceUpdatedAt','evidence','evidenceDigest','name','caloriesKcal','proteinG','carbohydrateG','fatG','grams','policyVersion','reasonCode','localTime','timeZone','weekdays','startLocalDate','expiresAt']) or p_proposal->>'policyVersion' is distinct from 'mrs-exact-3-v1' or p_proposal->>'reasonCode' is distinct from 'three_consecutive_days'
 then raise exception 'suggestion_invalid' using errcode='22023'; end if;
 zone:=p_proposal->>'timeZone';
 perform public.recurring_meal_validate('12:00',zone,array[0]);
 d:=(now() at time zone zone)::date;
 -- Lock in UUID order, including supporting entries, against concurrent edit/delete.
 perform 1 from public.food_entries where user_id=p_user and id in(select (value->>'id')::uuid from jsonb_array_elements(p_proposal->'evidence')) order by id for update;
 for e in select value from jsonb_array_elements(p_proposal->'evidence') loop
   if jsonb_typeof(e) is distinct from 'object' or not(e ?& array['id','updatedAt','localDate']) then raise exception 'suggestion_invalid' using errcode='22023'; end if;
   select * into f from public.food_entries where user_id=p_user and id=(e->>'id')::uuid;
   if not found or not f.confirmed_by_user or f.consumed_at>now() or f.created_at>now() or f.updated_at>now()
     or f.updated_at is distinct from (e->>'updatedAt')::timestamptz or e->>'localDate' is distinct from (d-2+n)::text
     or (f.consumed_at at time zone zone)::date<>d-2+n
     or (f.details->'recurringMeal' is not null and f.details->'recurringMeal'<>'null'::jsonb)
     or exists(select 1 from public.recurring_meal_occurrences where user_id=p_user and food_entry_id=f.id)
   then raise exception 'suggestion_stale' using errcode='23505'; end if;
   other_ident:=public.recurring_suggestion_identity(to_jsonb(f));
   if n=0 then ident:=other_ident; elsif ident<>other_ident then raise exception 'suggestion_stale' using errcode='23505'; end if;
   if exists(select 1 from jsonb_array_elements(other_ident) with ordinality v where ordinality>1 and value<>'null'::jsonb and (jsonb_typeof(value)<>'number' or (value::text)::numeric not between 0 and 20000))
   then raise exception 'suggestion_invalid' using errcode='22023'; end if;
   tuples:=tuples||jsonb_build_array(jsonb_build_array(f.id,e->>'updatedAt',e->>'localDate'));
   minutes:=array_append(minutes,extract(hour from f.consumed_at at time zone zone)::integer*60+extract(minute from f.consumed_at at time zone zone)::integer);
   src:=f; n:=n+1;
 end loop;
 family:=ident->>0;
 if family='' or lower(family)=any(array['breakfast','lunch','dinner','snack','meal','food','brunch','supper','raňajky','obed','večera','desiata','olovrant'])
   or src.id is distinct from (p_proposal->>'sourceEntryId')::uuid or src.updated_at is distinct from (p_proposal->>'sourceUpdatedAt')::timestamptz
   or (src.created_at at time zone zone)::date<>d or src.created_at<now()-interval '24 hours'
   or family is distinct from p_proposal->>'familyKey' or src.name is distinct from p_proposal->>'name'
   or ident<>jsonb_build_array(family,p_proposal->'caloriesKcal',p_proposal->'proteinG',p_proposal->'carbohydrateG',p_proposal->'fatG',p_proposal->'grams')
 then raise exception 'suggestion_stale' using errcode='23505'; end if;
 select array_agg(v order by v) into minutes from unnest(minutes) v;
 median:=((minutes[2]+7)/15)*15;
 if median>=1440 then raise exception 'suggestion_stale' using errcode='23505'; end if;
 time:=lpad((median/60)::text,2,'0')||':'||lpad((median%60)::text,2,'0');
 digest:=public.recurring_suggestion_digest(public.recurring_suggestion_json(tuples));
 candidate:='mrs1-'||public.recurring_suggestion_digest(public.recurring_suggestion_json(jsonb_build_array('mrs-exact-3-v1',zone,public.recurring_suggestion_json(ident),tuples)));
 select * into state from public.recurring_meal_suggestion_states where user_id=p_user and family_key=family;
 expiry:=case when (state.cooldown_until<=now() or state.expires_at+interval '30 days'<=now()) then date_trunc('milliseconds',src.created_at)+interval '7 days' else coalesce(state.expires_at,date_trunc('milliseconds',src.created_at)+interval '7 days') end;
 if p_proposal->>'evidenceDigest' is distinct from digest or p_proposal->>'candidateId' is distinct from candidate
   or p_proposal->>'localTime' is distinct from time or p_proposal->'weekdays' is distinct from '[0,1,2,3,4,5,6]'::jsonb
   or p_proposal->>'startLocalDate' is distinct from (d+1)::text or ((p_proposal->>'expiresAt')::timestamptz is distinct from expiry and (p_proposal->>'expiresAt')::timestamptz is distinct from date_trunc('milliseconds',src.created_at)+interval '7 days') or expiry<=now()
 then raise exception 'suggestion_stale' using errcode='23505'; end if;
 return public.recurring_meal_snapshot(p_user,src.id);
end; $$;

revoke all on function public.recurring_suggestion_validate(uuid,jsonb) from public,anon,authenticated,service_role;
