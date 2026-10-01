#!/usr/bin/env python3
"""Synthetic detailed publication races in coordinator-owned local scratch only."""
import concurrent.futures
import json
import subprocess
import uuid

DATABASE = "mizyun_share167_scratch"
CONTAINER = "supabase_db_mizyun"


def sql(statement):
    return subprocess.run(
        ["docker", "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", DATABASE,
         "-v", "ON_ERROR_STOP=1", "-At"],
        input=statement, text=True, capture_output=True,
    )


def checked(statement):
    result = sql(statement)
    assert result.returncode == 0, result.stderr[-500:]
    return result.stdout.strip()


users = []
try:
    checked("update public.community_operations set enabled=true,enrollment=true,publish=true,cohort_required=false;")
    for mode in ["exercise-edit", "source-delete"]:
        user, workout, exercise, operation = (str(uuid.uuid4()) for _ in range(4))
        users.append(user)
        checked(f"insert into auth.users(id,email) values('{user}','{user}@mizyun.test'); update public.profiles set birth_year=1990 where id='{user}'; insert into public.workouts(id,user_id,name,started_at,completed_at,details) values('{workout}','{user}','Private title',now()-interval '1 hour',now(),'{{\"workoutLifecycle\":{{\"kind\":\"session\"}}}}'); insert into public.exercises(id,user_id,name) values('{exercise}','{user}','Squat'); insert into public.workout_sets(user_id,workout_id,exercise_id,sequence,set_type,repetitions,load_kg,completed_at) values('{user}','{workout}','{exercise}',1,'normal',8,50,now());")
        auth = f"begin; set local role authenticated; set local request.jwt.claim.role='authenticated'; set local request.jwt.claim.sub='{user}';"
        checked(auth + f"select * from public.community_save_profile('detail_{uuid.uuid4().hex[:16]}','Synthetic','SY',null,false,true,'2026-09-30'); commit;")
        snapshot = json.dumps({"exercises": [{"name": "Squat", "sets": [{"setType": "normal", "repetitions": 8, "loadKg": 50, "durationSeconds": None}]}]})
        publish = auth + f"select id from public.community_publish_activity('{workout}','strength',(now() at time zone 'UTC')::date::text,null,1,'{operation}',0,false,'{snapshot}'::jsonb); commit;"
        edit = auth + (f"update public.exercises set name='Changed privately' where id='{exercise}';" if mode == "exercise-edit" else f"delete from public.workouts where id='{workout}';") + "commit;"
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(sql, [publish, edit]))
        assert results[1].returncode == 0, results[1].stderr
        if mode == "exercise-edit":
            assert results[0].returncode == 0 or "community_conflict" in results[0].stderr
            assert checked(f"select count(*) from public.shared_activities where user_id='{user}' and workout_details <> '{snapshot}'::jsonb;") == "0"
            print("PASS: exercise edit racing detailed publication commits only the confirmed snapshot or rejects stale confirmation")
        else:
            assert results[0].returncode == 0 or "community_unavailable" in results[0].stderr
            assert checked(f"select count(*) from public.shared_activities where user_id='{user}';") == "0"
            print("PASS: source deletion racing detailed publication leaves no shared card")
finally:
    for user in users:
        checked(f"delete from auth.users where id='{user}';")
    print(f"Synthetic scratch accounts removed: {len(users)}")
