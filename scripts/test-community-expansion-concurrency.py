#!/usr/bin/env python3
"""Actual expansion retry/revocation races; coordinator's empty Mac scratch only."""
import concurrent.futures
import json
import re
import subprocess
import uuid

DATABASE = "mizyun_expansion_concurrency_scratch"
CONTAINER = "supabase_db_mizyun"
if not re.fullmatch(r"mizyun_community_verify_[0-9a-f]{12}", DATABASE):
    raise RuntimeError("Run through verify-community-local-db.py against its empty scratch")


def sql(statement):
    return subprocess.run(["docker", "exec", "-i", CONTAINER, "psql", "-U", "postgres",
                           "-d", DATABASE, "-X", "-v", "ON_ERROR_STOP=1", "-At"],
                          input=statement, text=True, capture_output=True, timeout=60)


def checked(statement):
    result = sql(statement)
    if result.returncode:
        raise RuntimeError("Synthetic expansion database assertion failed")
    return result.stdout.strip()


def auth(user, statement):
    return ("begin;set local role authenticated;set local request.jwt.claim.role='authenticated';"
            "set local request.jwt.claim.sub='" + user + "';" + statement + ";commit;")


def command(user, operation, args):
    return auth(user, "select result from public.community_messaging_rpc('" + operation + "','" + json.dumps(args) + "'::jsonb)")


def race(statements):
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(statements)) as pool:
        return list(pool.map(sql, statements))


users = []
try:
    if checked("select count(*) from auth.users") != "0":
        raise RuntimeError("Refusing nonempty scratch")
    checked("update public.community_operations set enabled=true,enrollment=true,engagement=true,cohort_required=false;"
            "update public.community_feature_controls set enabled=true where feature='messaging';")
    for index in range(2):
        user = str(uuid.uuid4())
        users.append(user)
        checked("insert into auth.users(id,email) values('" + user + "','" + user + "@mizyun.test');"
                "update public.profiles set birth_year=1990 where id='" + user + "';")
        checked(auth(user, "select * from public.community_save_profile('race_" + uuid.uuid4().hex[:16] + "','Synthetic','SY',null,false,true,'2026-09-30')"))
        checked(command(user, "preferences", {"enabled": True}))
    sender, recipient = users
    checked("insert into public.community_relationships(follower_user_id,target_user_id,status) values('" + sender + "','" + recipient + "','approved'),('" + recipient + "','" + sender + "','approved');")
    message = str(uuid.uuid4())
    original = {"id": message, "peerId": recipient, "text": "Synthetic same operation"}
    results = race([command(sender, "send", original)] * 12)
    assert all(result.returncode == 0 for result in results)
    assert len(set(result.stdout for result in results)) == 1
    assert checked("select count(*) from public.community_messages where id='" + message + "'") == "1"
    assert checked("select count(*) from public.community_message_operations where user_id='" + sender + "'") == "1"
    print("PASS: twelve concurrent send retries create one exact message and one quota tombstone")

    candidate = {"id": str(uuid.uuid4()), "peerId": recipient, "text": "Synthetic opt-out race"}
    sent, opted_out = race([command(sender, "send", candidate), command(recipient, "preferences", {"enabled": False})])
    assert opted_out.returncode == 0
    assert sent.returncode == 0 or "community_unavailable" in sent.stderr
    assert sql(command(sender, "send", {**candidate, "id": str(uuid.uuid4())})).returncode != 0
    assert sql(command(sender, "list", {"peerId": recipient})).returncode != 0
    print("PASS: recipient opt-out racing send serializes, then denies every subsequent send and read")

    checked(command(recipient, "preferences", {"enabled": True}))
    replay, withdrawn = race([command(sender, "send", original), auth(sender, "select public.community_withdraw_profile()")])
    assert withdrawn.returncode == 0
    assert replay.returncode == 0 or "community_unavailable" in replay.stderr
    for _ in range(20):
        complete = checked("begin;set local role service_role;set local request.jwt.claim.role='service_role';"
                           "select complete from public.community_withdrawal_batch('" + sender + "',1,1);commit;")
        if "t" in complete.splitlines():
            break
    else:
        raise RuntimeError("Bounded withdrawal never completed")
    assert checked("select count(*) from public.community_messages where user_id='" + sender + "'") == "0"
    assert checked("select count(*) from public.community_message_operations where id='" + message + "'") == "1"
    assert sql(command(sender, "send", original)).returncode != 0
    print("PASS: withdrawal racing lost-response replay removes text and preserves no-text retry tombstone")
finally:
    for user in users:
        checked("delete from auth.users where id='" + user + "';")
    print("Synthetic scratch accounts removed: " + str(len(users)))
