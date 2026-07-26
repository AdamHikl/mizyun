-- COACH-PERS-001: explicit, user-controlled Coach personalization.
--
-- This JSON object contains only closed, normalized values validated by
-- the shared API contract. It carries no medical diagnosis or free text.
alter table public.profiles
  add column if not exists coaching_preferences jsonb;

alter table public.profiles
  add constraint profiles_coaching_preferences_object
  check (
    coaching_preferences is null
    or (
      jsonb_typeof(coaching_preferences) = 'object'
      and pg_column_size(coaching_preferences) <= 4096
      and coaching_preferences ?& array[
        'experienceLevel',
        'trainingDaysPerWeek',
        'sessionDurationMinutes',
        'trainingFocus',
        'availableEquipment',
        'dietaryPreferences',
        'trainingLimitations'
      ]
      and (
        coaching_preferences
        - array[
            'experienceLevel',
            'trainingDaysPerWeek',
            'sessionDurationMinutes',
            'trainingFocus',
            'availableEquipment',
            'dietaryPreferences',
            'trainingLimitations'
          ]
      ) = '{}'::jsonb
      and (
        coaching_preferences ->> 'experienceLevel' is null
        or coaching_preferences ->> 'experienceLevel'
          in ('beginner', 'intermediate', 'advanced')
      )
      and (
        coaching_preferences ->> 'trainingFocus' is null
        or coaching_preferences ->> 'trainingFocus'
          in ('balanced', 'strength', 'hypertrophy', 'endurance')
      )
      and (
        coaching_preferences ->> 'trainingDaysPerWeek' is null
        or coaching_preferences ->> 'trainingDaysPerWeek' ~ '^[1-7]$'
      )
      and (
        coaching_preferences ->> 'sessionDurationMinutes' is null
        or (
          coaching_preferences ->> 'sessionDurationMinutes' ~ '^[0-9]{2,3}$'
          and (coaching_preferences ->> 'sessionDurationMinutes')::integer
            between 15 and 180
        )
      )
      and jsonb_typeof(coaching_preferences -> 'availableEquipment') = 'array'
      and jsonb_typeof(coaching_preferences -> 'dietaryPreferences') = 'array'
      and jsonb_typeof(coaching_preferences -> 'trainingLimitations') = 'array'
      and not jsonb_path_exists(
        coaching_preferences,
        '$.availableEquipment[*] ? (
          @ != "bodyweight" &&
          @ != "dumbbells" &&
          @ != "barbell" &&
          @ != "bench" &&
          @ != "rack" &&
          @ != "cable_machine" &&
          @ != "resistance_bands" &&
          @ != "pullup_bar" &&
          @ != "cardio_machine" &&
          @ != "full_gym"
        )'
      )
      and not jsonb_path_exists(
        coaching_preferences,
        '$.dietaryPreferences[*] ? (
          @ != "omnivore" &&
          @ != "vegetarian" &&
          @ != "vegan" &&
          @ != "pescatarian" &&
          @ != "halal" &&
          @ != "kosher" &&
          @ != "lactose_free" &&
          @ != "gluten_free"
        )'
      )
      and not jsonb_path_exists(
        coaching_preferences,
        '$.trainingLimitations[*] ? (
          @ != "low_impact_only" &&
          @ != "no_overhead_work" &&
          @ != "no_running" &&
          @ != "no_jumping" &&
          @ != "limited_knee_flexion" &&
          @ != "limited_spinal_loading"
        )'
      )
    )
  );

comment on column public.profiles.coaching_preferences is
  'Explicit non-medical coaching preferences: experience, schedule, equipment, diet, and movement constraints.';
