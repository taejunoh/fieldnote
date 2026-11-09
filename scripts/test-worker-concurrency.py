#!/usr/bin/env python3
"""Exercise concurrent PostgreSQL claims in an empty, isolated Docker test database.

Usage: python3 scripts/test-worker-concurrency.py --container <postgres-container> --database <test-db>
The database needs the app migrations and auth helpers; it must have no real jobs.
"""
import argparse
import subprocess
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--container", required=True)
parser.add_argument("--database", required=True)
options = parser.parse_args()
if options.database in {"postgres", "template0", "template1"}:
    parser.error("Use an isolated test database, never the live Supabase database")
command = ["docker", "exec", "-i", options.container, "psql", "-U", "postgres",
           "-d", options.database, "-v", "ON_ERROR_STOP=1", "-Atq"]


def query(sql):
    result = subprocess.run(command, input=sql, text=True, capture_output=True, timeout=10)
    if result.returncode:
        raise RuntimeError(result.stderr.strip())
    return result.stdout.strip()


if query("select count(*) from public.analysis_jobs;") != "0":
    raise RuntimeError("Test database must be empty; no existing jobs will be claimed")
owner, sport_1, sport_2 = (str(uuid.uuid4()) for _ in range(3))
held = None
try:
    query(f"""
insert into auth.users(id,email) values('{owner}','claim-race@example.invalid');
insert into sports(id,owner_id,slug) values('{sport_1}','{owner}','mlb'),('{sport_2}','{owner}','nfl');
do $$declare j analysis_jobs%rowtype; m uuid; begin
for n in 1..3 loop
  insert into analysis_jobs(owner_id,sport_id,request_key,kind,available_at)
    values('{owner}',case when n=3 then '{sport_2}'::uuid else '{sport_1}'::uuid end,
      'claim-race-'||n,'chat',now()-make_interval(secs=>4-n)) returning * into j;
  insert into messages(owner_id,sport_id,role,content,analysis_job_id)
    values(j.owner_id,j.sport_id,'user','Fixture',j.id) returning id into m;
  update analysis_jobs set user_message_id=m where id=j.id;
end loop;end$$;
""")
    held = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, text=True)
    held.stdin.write("begin;set local request.jwt.claim.role='service_role';"
                     "select sport_id from claim_gateway_job('race-slot-A',120);\n")
    held.stdin.flush()
    assert held.stdout.readline().strip() == sport_1, "First sport was not claimed"
    # A is uncommitted and holds its candidate/sport locks; B must still claim NFL.
    second = query("begin;set local request.jwt.claim.role='service_role';"
                   "select sport_id from claim_gateway_job('race-slot-B',120);commit;")
    assert second == sport_2, "Held claim locked another sport's queued jobs"
    third = query("begin;set local request.jwt.claim.role='service_role';"
                  "select sport_id from claim_gateway_job('race-slot-C',120);commit;")
    assert not third, "Same-sport jobs overlapped before the first claim committed"
    held.stdin.write("commit;\n")
    held.stdin.close()
    held.wait(timeout=10)
    if held.returncode:
        raise RuntimeError(held.stderr.read())
    third = query("begin;set local request.jwt.claim.role='service_role';"
                  "select sport_id from claim_gateway_job('race-slot-C',120);commit;")
    assert not third, "Same-sport jobs overlapped after the first claim committed"
    assert query("begin;set local request.jwt.claim.role='service_role';"
                 "select fail_gateway_job(id,current_attempt_id,'race-slot-A','failed','Fixture') "
                 "from analysis_jobs where lease_owner='race-slot-A';commit;") == "t"
    third = query("begin;set local request.jwt.claim.role='service_role';"
                  "select sport_id from claim_gateway_job('race-slot-C',120);commit;")
    assert third == sport_1, "Released sport did not accept its next request"
    print("PASS: different sports claim concurrently; same sport waits through transaction and execution")
finally:
    if held and held.poll() is None:
        held.stdin.write("rollback;\n")
        held.stdin.close()
        held.wait(timeout=10)
    query(f"delete from auth.users where id='{owner}';")
