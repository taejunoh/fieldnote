#!/usr/bin/env python3
"""Local-only completion regression. Every DDL/fixture write is rolled back.

Usage: python3 supabase/tests/support/run_saved_evaluation_repair.py
Requires Docker and the local supabase_db_allinsimple-edge container. No keys or
connection credentials are loaded. Existing cloud/production databases unsupported.
"""
import re
import subprocess
from pathlib import Path

repo = Path(__file__).resolve().parents[3]
psql = ["docker", "exec", "-i", "supabase_db_allinsimple-edge", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"]

def run(sql):
    return subprocess.run(psql, input=sql, text=True, capture_output=True)

state = run("select version from supabase_migrations.schema_migrations order by version;\n")
if state.returncode:
    raise SystemExit(state.stderr)
applied = set(re.findall(r"^\s*(\d{12})\s*$", state.stdout, re.M))
policy = run("select to_regclass('public.common_policy_versions') is not null;\n")
if policy.returncode:
    raise SystemExit(policy.stderr)
policy_exists = bool(re.search(r"^\s*t\s*$", policy.stdout, re.M))
pending = []
for migration in sorted((repo / "supabase/migrations").glob("*.sql")):
    if migration.name > "202610270003_gateway_completion_checkpoint.sql":
        continue
    if migration.name[:12] in applied:
        continue
    # This local environment has this migration's schema but no history row.
    if migration.name == "202610060001_common_operating_policy.sql" and policy_exists:
        continue
    pending.append(migration.read_text())

guard = repo / "supabase/migrations/202610290005_guard_completed_analysis_repair.sql"
if guard.exists(): pending.append(guard.read_text())
fixtures = ["completed_analysis_guarded"]
failed = False
for name in fixtures:
    fixture = (repo / f"supabase/tests/{name}.sql").read_text()
    fixture = re.sub(r"(?im)^\s*(begin|rollback);\s*$", "", fixture)
    result = run("BEGIN;\n" + "\n".join(pending) + "\n" + fixture + "\nROLLBACK;\n")
    print(f"{name}: {'PASS (rolled back)' if result.returncode == 0 else 'FAIL (connection closed; rolled back)'}")
    if result.returncode:
        print(result.stderr)
        failed = True
raise SystemExit(1 if failed else 0)
