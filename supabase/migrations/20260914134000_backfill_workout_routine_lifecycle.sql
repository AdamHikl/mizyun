-- FIX-WORKOUT-LIFECYCLE-001
--
-- Preserve reusable routines before clients switch from clone-on-finish to
-- copy-on-start. Legacy rows had no discriminator: an incomplete workout with
-- planned exercises was both the template and the active session. When such a
-- row already has sets, clone the untouched plan transactionally, then mark the
-- existing row as the session that originated from that routine.

with legacy_in_progress as materialized (
  select
    w.*,
    gen_random_uuid() as routine_id
  from public.workouts w
  where w.completed_at is null
    and not (w.details ? 'workoutLifecycle')
    and exists (
      select 1
      from public.workout_sets ws
      where ws.workout_id = w.id
        and ws.user_id = w.user_id
    )
    and (
      case when jsonb_typeof(w.details #> '{coachPlan,exercises}') = 'array' then jsonb_array_length(w.details #> '{coachPlan,exercises}') > 0 else false end
      or case when jsonb_typeof(w.details #> '{coachPlan,session,exercises}') = 'array' then jsonb_array_length(w.details #> '{coachPlan,session,exercises}') > 0 else false end
      or case when jsonb_typeof(w.details #> '{aiDraft,session,exercises}') = 'array' then jsonb_array_length(w.details #> '{aiDraft,session,exercises}') > 0 else false end
      or case when jsonb_typeof(w.details #> '{aiDraft,exercises}') = 'array' then jsonb_array_length(w.details #> '{aiDraft,exercises}') > 0 else false end
      or case when jsonb_typeof(w.details #> '{workoutProposal,session,exercises}') = 'array' then jsonb_array_length(w.details #> '{workoutProposal,session,exercises}') > 0 else false end
      or case when jsonb_typeof(w.details #> '{workoutProposal,exercises}') = 'array' then jsonb_array_length(w.details #> '{workoutProposal,exercises}') > 0 else false end
    )
),
inserted_routines as (
  insert into public.workouts (
    id,
    user_id,
    name,
    started_at,
    completed_at,
    notes,
    source,
    details,
    created_at,
    updated_at
  )
  select
    legacy.routine_id,
    legacy.user_id,
    legacy.name,
    legacy.started_at,
    null,
    legacy.notes,
    legacy.source,
    legacy.details || jsonb_build_object(
      'workoutLifecycle',
      jsonb_build_object(
        'kind', 'routine',
        'legacySessionId', legacy.id
      )
    ),
    legacy.created_at,
    timezone('utc', now())
  from legacy_in_progress legacy
  returning id, details
)
update public.workouts session
set details = session.details || jsonb_build_object(
  'workoutLifecycle',
  jsonb_build_object(
    'kind', 'session',
    'routineId', inserted.id
  )
)
from inserted_routines inserted
where session.id = (inserted.details #>> '{workoutLifecycle,legacySessionId}')::uuid;

-- Remaining unclassified incomplete rows with planned exercises have no sets,
-- so they are reusable routines that have not started.
update public.workouts w
set details = w.details || jsonb_build_object(
  'workoutLifecycle',
  jsonb_build_object('kind', 'routine')
)
where w.completed_at is null
  and not (w.details ? 'workoutLifecycle')
  and (
    case when jsonb_typeof(w.details #> '{coachPlan,exercises}') = 'array' then jsonb_array_length(w.details #> '{coachPlan,exercises}') > 0 else false end
    or case when jsonb_typeof(w.details #> '{coachPlan,session,exercises}') = 'array' then jsonb_array_length(w.details #> '{coachPlan,session,exercises}') > 0 else false end
    or case when jsonb_typeof(w.details #> '{aiDraft,session,exercises}') = 'array' then jsonb_array_length(w.details #> '{aiDraft,session,exercises}') > 0 else false end
    or case when jsonb_typeof(w.details #> '{aiDraft,exercises}') = 'array' then jsonb_array_length(w.details #> '{aiDraft,exercises}') > 0 else false end
    or case when jsonb_typeof(w.details #> '{workoutProposal,session,exercises}') = 'array' then jsonb_array_length(w.details #> '{workoutProposal,session,exercises}') > 0 else false end
    or case when jsonb_typeof(w.details #> '{workoutProposal,exercises}') = 'array' then jsonb_array_length(w.details #> '{workoutProposal,exercises}') > 0 else false end
  );

-- Completed workouts and incomplete ad-hoc workouts are sessions. This also
-- gives legacy zero-set active workouts an explicit recovery classification.
update public.workouts w
set details = w.details || jsonb_build_object(
  'workoutLifecycle',
  jsonb_build_object('kind', 'session')
)
where not (w.details ? 'workoutLifecycle');
