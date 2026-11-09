# 로컬 데이터 백업과 복원

로컬 Supabase 데이터베이스와 `openllms-data` Docker 볼륨에는 비공개 기록과 게이트웨이 자격증명이 들어 있습니다. 백업 디렉터리는 저장소 바깥에 두고 접근을 제한합니다. 기본 경로는 다음과 같습니다.

```text
${XDG_DATA_HOME:-~/.local/share}/allinsimple-edge/backups/local-<timestamp>/
```

저장소 루트에서 실행합니다.

```sh
scripts/backup-local.sh
```

저장소 바깥의 새 디렉터리를 지정할 수도 있습니다. 기존 디렉터리가 있으면 스크립트가 덮어쓰지 않고 종료합니다.

```sh
scripts/backup-local.sh /Volumes/private-backups/sports-desk-20260924
```

백업에는 PostgreSQL 아카이브인 `supabase.dump`, SQLite와 자격증명 파일을 포함한 전체 `/data` 볼륨인 `openllms-data.tar.gz`, `SHA256SUMS`, 백업 형식 정보가 들어 있습니다. 스크립트는 `pg_restore --list`로 Postgres 아카이브를 확인하고, 복사한 SQLite에 `PRAGMA integrity_check`를 실행하며, 볼륨 압축 파일을 검사합니다. 데이터 파일 두 개의 SHA-256 체크섬도 기록합니다. SQLite와 WAL 파일을 복사하는 동안 게이트웨이를 잠시 중지하고, 백업이 끝나거나 오류가 나면 다시 시작합니다. 실행 결과에는 백업 경로만 표시됩니다.

## 백업 검증과 복원

`restore-local.sh`는 검증용입니다. 체크섬과 Postgres 아카이브를 확인하고, 게이트웨이 아카이브를 비공개 임시 디렉터리에 풀어 SQLite 무결성을 검사합니다.

```sh
scripts/restore-local.sh /path/to/local-<timestamp>
```

실제 복원은 먼저 폐기 가능한 로컬 환경에서 다음 순서로 진행합니다.

1. 선택한 백업을 `scripts/restore-local.sh`로 검증하고, 현재 Supabase 데이터베이스와 게이트웨이 볼륨의 안전 백업을 새로 만듭니다.
2. 앱과 게이트웨이를 중지하고 대상 컨테이너와 Docker 볼륨이 해당 프로젝트에 속하는지 확인합니다. 복구를 확인할 때까지 기존 볼륨을 보존합니다.
3. 호환되는 임시 Supabase Postgres에 `pg_restore --clean --if-exists --no-owner --no-acl`로 `supabase.dump`를 복원합니다. `auth`, `storage`, 앱 스키마, 역할, 확장 기능, 예상 레코드 건수를 확인합니다.
4. `openllms-data.tar.gz`를 별도 임시 볼륨에 풉니다. 이 볼륨으로 게이트웨이를 시작하고 자격증명 값을 출력하거나 복사하지 않은 상태로 서비스 상태와 라우트를 확인합니다.
5. 로그인, 앱 데이터, 게이트웨이 라우트와 읽기 전용 상태 요청을 검증합니다. 하나라도 실패하면 임시 환경을 폐기하고 원본과 안전 백업을 보존합니다.
6. 임시 환경에서 복원 절차를 검증한 뒤 운영 중인 로컬 환경에 적용할지 별도로 판단합니다. 적용 전에 정확한 대상과 최신 안전 백업을 확인합니다.

검증 스크립트가 확인하는 범위는 아카이브 무결성까지입니다. 종료 당시 격리 환경에서 수행한 검증 결과는 운영 종료 보고서에 있습니다. [호스팅 종료와 백업 검증](fieldnote-postmortem.md#7-호스팅-종료와-백업-검증)
