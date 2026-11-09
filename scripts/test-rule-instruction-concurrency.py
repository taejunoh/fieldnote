#!/usr/bin/env python3
"""Exercise the rule-instruction idempotency lock through two Management API sessions."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import time
import uuid
from dataclasses import dataclass
from pathlib import Path


PROJECT_DIR = Path("./cloud-staging")
CLI = "supabase"
HOLD_SECONDS = 5
START_GAP_SECONDS = 1.0
MIN_LOCK_WAIT_SECONDS = 2.5


@dataclass
class Session:
    process: subprocess.Popen[str]
    started_at: float
    sql_file: Path


def write_sql_file(sql: str) -> Path:
    handle = tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", suffix=".sql", prefix="rule-instruction-race-", delete=False
    )
    try:
        handle.write(sql)
        return Path(handle.name)
    finally:
        handle.close()


def parse_json_output(stdout: str) -> dict[str, object]:
    decoder = json.JSONDecoder()
    for index, char in enumerate(stdout):
        if char != "{":
            continue
        try:
            value, _ = decoder.raw_decode(stdout[index:])
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict) and "rows" in value:
            return value
    raise RuntimeError("Management API query returned no JSON rows")


def run_query(sql: str, timeout: float = 90) -> dict[str, object]:
    path = write_sql_file(sql)
    try:
        result = subprocess.run(
            [CLI, "db", "query", "--linked", "--file", str(path), "--output", "json"],
            cwd=PROJECT_DIR,
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        if result.returncode:
            code = "23505" if "23505" in result.stdout + result.stderr else f"cli_exit_{result.returncode}"
            raise RuntimeError(f"Management API query failed ({code})")
        return parse_json_output(result.stdout)
    finally:
        path.unlink(missing_ok=True)


def start_query(sql: str) -> Session:
    path = write_sql_file(sql)
    started_at = time.monotonic()
    process = subprocess.Popen(
        [CLI, "db", "query", "--linked", "--file", str(path), "--output", "json"],
        cwd=PROJECT_DIR,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    return Session(process=process, started_at=started_at, sql_file=path)


def finish_query(session: Session, timeout: float = 90) -> tuple[dict[str, object], float]:
    try:
        try:
            stdout, stderr = session.process.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            session.process.kill()
            session.process.communicate()
            raise RuntimeError("Management API session timed out")
        elapsed = time.monotonic() - session.started_at
        if session.process.returncode:
            code = "23505" if "23505" in stdout + stderr else f"cli_exit_{session.process.returncode}"
            raise RuntimeError(f"Management API query failed ({code})")
        return parse_json_output(stdout), elapsed
    finally:
        session.sql_file.unlink(missing_ok=True)


def cancel_query(session: Session) -> None:
    if session.process.poll() is None:
        session.process.terminate()
        try:
            session.process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            session.process.kill()
            session.process.communicate()
    session.sql_file.unlink(missing_ok=True)


def auth_sql(owner_id: str) -> str:
    return (
        "SET LOCAL ROLE authenticated;\n"
        "SELECT set_config('request.jwt.claim.role', 'authenticated', true);\n"
        f"SELECT set_config('request.jwt.claim.sub', '{owner_id}', true);\n"
    )


def rule_call(sport_id: str, request_key: str) -> str:
    return f"""public.apply_rule_instruction(
      '{sport_id}'::uuid, '{request_key}', 'default_recommended_units',
      '앞으로 유닛은 0.25u로 해줘', '기본 권장 유닛',
      '앞으로 분석의 기본 권장 유닛은 0.25u로 제안한다.',
      '기본 권장 유닛을 0.25u로 저장했습니다.'
    )"""


def first_rule_transaction(owner_id: str, sport_id: str, request_key: str) -> str:
    return f"""BEGIN;
{auth_sql(owner_id)}
SELECT {rule_call(sport_id, request_key)};
SELECT pg_sleep({HOLD_SECONDS});
COMMIT;
SELECT request_key, user_message_id, assistant_message_id, criteria_version_id
  FROM public.rule_instruction_requests
  WHERE owner_id = '{owner_id}' AND sport_id = '{sport_id}' AND request_key = '{request_key}';
"""


def first_analysis_transaction(owner_id: str, sport_id: str, request_key: str) -> str:
    return f"""BEGIN;
{auth_sql(owner_id)}
INSERT INTO public.analysis_jobs(owner_id, sport_id, request_key, kind, provider, status)
  VALUES('{owner_id}', '{sport_id}', '{request_key}', 'message', 'openllms', 'completed');
SELECT pg_sleep({HOLD_SECONDS});
COMMIT;
SELECT count(*) AS jobs
  FROM public.analysis_jobs
  WHERE owner_id = '{owner_id}' AND sport_id = '{sport_id}' AND request_key = '{request_key}';
"""


def conflict_observer(setup: str, action: str) -> str:
    return f"""BEGIN;
{setup}
DO $$
DECLARE
  v_started timestamptz := clock_timestamp();
  v_code text;
  v_wait numeric;
BEGIN
  BEGIN
    {action.strip()}
    RAISE EXCEPTION 'Expected cross-mode collision was not raised';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE;
    IF v_code <> '23505' THEN RAISE; END IF;
    v_wait := extract(epoch FROM clock_timestamp() - v_started);
  END;
  IF v_wait < {MIN_LOCK_WAIT_SECONDS} THEN
    RAISE EXCEPTION 'Conflict returned before lock wait: % seconds', v_wait;
  END IF;
  PERFORM set_config('allinsimple.race_sqlstate', v_code, false);
  PERFORM set_config('allinsimple.race_wait_seconds', v_wait::text, false);
END $$;
COMMIT;
SELECT current_setting('allinsimple.race_sqlstate') AS sqlstate,
       current_setting('allinsimple.race_wait_seconds')::numeric AS wait_seconds;
"""


def analysis_collision(owner_id: str, sport_id: str, request_key: str) -> str:
    return conflict_observer(
        auth_sql(owner_id),
        f"""INSERT INTO public.analysis_jobs(owner_id, sport_id, request_key, kind, provider, status)
  VALUES('{owner_id}', '{sport_id}', '{request_key}', 'message', 'openllms', 'completed');""",
    )


def local_collision(owner_id: str, sport_id: str, request_key: str) -> str:
    return conflict_observer(auth_sql(owner_id), f"PERFORM {rule_call(sport_id, request_key)};")


def local_replay_transaction(owner_id: str, sport_id: str, request_key: str) -> str:
    call = rule_call(sport_id, request_key)
    return f"""BEGIN;
{auth_sql(owner_id)}
DO $$
DECLARE
  v_started timestamptz := clock_timestamp();
  v_result jsonb;
  v_wait numeric;
BEGIN
  v_result := {call};
  IF v_result->>'replayed' <> 'true' THEN
    RAISE EXCEPTION 'Concurrent duplicate request was not replayed';
  END IF;
  v_wait := extract(epoch FROM clock_timestamp() - v_started);
  IF v_wait < {MIN_LOCK_WAIT_SECONDS} THEN
    RAISE EXCEPTION 'Replay returned before lock wait: % seconds', v_wait;
  END IF;
  PERFORM set_config('allinsimple.replay_user_message_id', v_result->'message'->>'id', false);
  PERFORM set_config('allinsimple.replay_assistant_message_id', v_result->'assistantMessage'->>'id', false);
  PERFORM set_config('allinsimple.replay_criteria_id', v_result->'rule'->>'id', false);
  PERFORM set_config('allinsimple.replay_wait_seconds', v_wait::text, false);
END $$;
COMMIT;
SELECT current_setting('allinsimple.replay_user_message_id') AS user_message_id,
       current_setting('allinsimple.replay_assistant_message_id') AS assistant_message_id,
       current_setting('allinsimple.replay_criteria_id') AS criteria_id,
       current_setting('allinsimple.replay_wait_seconds')::numeric AS wait_seconds;
"""


def rows(result: dict[str, object]) -> list[dict[str, object]]:
    value = result.get("rows")
    if not isinstance(value, list):
        raise RuntimeError("Management API query returned no rows array")
    return [row for row in value if isinstance(row, dict)]


def assert_conflict(result: dict[str, object], direction: str) -> float:
    result_rows = rows(result)
    if len(result_rows) != 1 or result_rows[0].get("sqlstate") != "23505":
        raise RuntimeError(f"{direction}: loser did not capture SQLSTATE 23505")
    wait = float(result_rows[0]["wait_seconds"])
    if wait < MIN_LOCK_WAIT_SECONDS:
        raise RuntimeError(f"{direction}: SQL lock wait was too short")
    return wait


def run_race(first_sql: str, loser_sql: str, label: str) -> float:
    first = start_query(first_sql)
    try:
        time.sleep(START_GAP_SECONDS)
        loser_result = run_query(loser_sql)
        wait = assert_conflict(loser_result, label)
        first_result, _ = finish_query(first)
        if not rows(first_result):
            raise RuntimeError(f"{label}: first transaction did not commit")
        return wait
    except Exception:
        cancel_query(first)
        raise


def run_same_mode_replay(owner_id: str, sport_id: str, request_key: str) -> float:
    first = start_query(first_rule_transaction(owner_id, sport_id, request_key))
    try:
        time.sleep(START_GAP_SECONDS)
        replay_result = run_query(local_replay_transaction(owner_id, sport_id, request_key))
        replay_rows = rows(replay_result)
        first_result, _ = finish_query(first)
        first_rows = rows(first_result)
        if len(replay_rows) != 1 or len(first_rows) != 1:
            raise RuntimeError("Local duplicate replay returned an unexpected row count")
        first_row = first_rows[0]
        replay_row = replay_rows[0]
        for first_column, replay_column in (
            ("user_message_id", "user_message_id"),
            ("assistant_message_id", "assistant_message_id"),
            ("criteria_version_id", "criteria_id"),
        ):
            if first_row.get(first_column) != replay_row.get(replay_column):
                raise RuntimeError("Local duplicate replay returned different stored IDs")
        wait = float(replay_row["wait_seconds"])
        if wait < MIN_LOCK_WAIT_SECONDS:
            raise RuntimeError("Local duplicate replay did not wait on the request lock")
        return wait
    except Exception:
        cancel_query(first)
        raise


def cleanup_fixture(owner_id: str) -> None:
    # This is the only cleanup target; all dependent rows cascade from this fixture owner.
    result = run_query(
        f"DELETE FROM auth.users WHERE id = '{owner_id}';\n"
        f"SELECT count(*) AS remaining FROM auth.users WHERE id = '{owner_id}';\n"
    )
    result_rows = rows(result)
    if len(result_rows) != 1 or int(result_rows[0].get("remaining", -1)) != 0:
        raise RuntimeError("Dedicated concurrency fixture cleanup was incomplete")


def main() -> int:
    if not PROJECT_DIR.is_dir():
        raise RuntimeError("Configured cloud-staging project directory was not found")
    fixture = uuid.uuid4()
    owner_id = str(fixture)
    sport_id = str(uuid.uuid4())
    suffix = fixture.hex[:12]
    keys = {
        "local_first": f"race-local-{suffix}",
        "analysis_first": f"race-analysis-{suffix}",
        "local_replay": f"race-replay-{suffix}",
    }
    email = f"rule-instruction-race-{suffix}@example.invalid"
    created = False
    try:
        run_query(
            "BEGIN;\n"
            f"INSERT INTO auth.users(id, email) VALUES('{owner_id}', '{email}');\n"
            f"INSERT INTO public.sports(id, owner_id, slug) VALUES('{sport_id}', '{owner_id}', 'mlb');\n"
            "COMMIT;\n"
        )
        created = True

        wait_local = run_race(
            first_rule_transaction(owner_id, sport_id, keys["local_first"]),
            analysis_collision(owner_id, sport_id, keys["local_first"]),
            "local-first collision",
        )
        wait_analysis = run_race(
            first_analysis_transaction(owner_id, sport_id, keys["analysis_first"]),
            local_collision(owner_id, sport_id, keys["analysis_first"]),
            "analysis-first collision",
        )
        wait_replay = run_same_mode_replay(owner_id, sport_id, keys["local_replay"])

        counts_result = run_query(f"""SELECT
  (SELECT count(*) FROM public.rule_instruction_requests
    WHERE owner_id = '{owner_id}' AND sport_id = '{sport_id}'
      AND request_key = '{keys['local_replay']}') AS requests,
  (SELECT count(*) FROM public.messages m
    JOIN public.rule_instruction_requests r ON r.user_message_id = m.id
    WHERE r.owner_id = '{owner_id}' AND r.sport_id = '{sport_id}'
      AND r.request_key = '{keys['local_replay']}') AS user_messages,
  (SELECT count(*) FROM public.messages m
    JOIN public.rule_instruction_requests r ON r.assistant_message_id = m.id
    WHERE r.owner_id = '{owner_id}' AND r.sport_id = '{sport_id}'
      AND r.request_key = '{keys['local_replay']}') AS acknowledgments,
  (SELECT count(*) FROM public.criteria_versions c
    JOIN public.rule_instruction_requests r ON r.criteria_version_id = c.id
    WHERE r.owner_id = '{owner_id}' AND r.sport_id = '{sport_id}'
      AND r.request_key = '{keys['local_replay']}') AS criteria;
""")
        count_rows = rows(counts_result)
        if len(count_rows) != 1 or any(
            int(count_rows[0].get(name, -1)) != 1
            for name in ("requests", "user_messages", "acknowledgments", "criteria")
        ):
            raise RuntimeError("Concurrent local replay created duplicate rule/message rows")

        print(
            "Concurrency checks passed: "
            f"local-first loser SQLSTATE 23505 after {wait_local:.2f}s; "
            f"analysis-first loser SQLSTATE 23505 after {wait_analysis:.2f}s; "
            f"same-key local replay returned original IDs after {wait_replay:.2f}s; "
            "one request, user message, acknowledgment, and criterion."
        )
        return 0
    finally:
        if created:
            try:
                cleanup_fixture(owner_id)
            except Exception as error:
                print(f"Fixture cleanup failed: {error}", file=sys.stderr)
                raise


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        # Errors are intentionally sanitized; never print CLI output or connection details.
        print(f"Concurrency check failed: {error}", file=sys.stderr)
        raise SystemExit(1)
