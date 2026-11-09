# openllms 게이트웨이 로컬 설정

게이트웨이 이미지는 `vendor/`에 보관한 openllms 소스 스냅샷에 호환성 패치를 적용해 빌드합니다. Docker는 소스 압축을 풀기 전에 SHA-256을 검증하고, 바이너리를 만들기 전에 테스트를 실행합니다.

## 빌드 및 시작

저장소 루트에서 실행합니다.

```sh
export OPENLLMS_BOOTSTRAP_TOKEN="$(openssl rand -hex 32)"
docker compose -f gateway/compose.yaml build
docker compose -f gateway/compose.yaml up -d
curl -fsS http://127.0.0.1:8080/health
```

Compose 서비스는 루프백에만 바인딩하고 SQLite 데이터베이스와 자격증명 파일을 `openllms-data` 볼륨에 보관합니다. 부트스트랩 토큰은 로컬에서 생성해 비공개로 보관합니다. 초기 설정 중 Compose가 컨테이너를 만들거나 다시 만들 때 토큰이 셸 환경에 있어야 합니다.

## 초기 설정과 Codex 연결

`jq`가 필요합니다. 부트스트랩은 한 번만 실행합니다. 반환되는 게이트웨이 API 키는 응답에서 한 번만 확인할 수 있으므로 안전하게 보관합니다. 아래 명령은 키를 터미널에 출력하지 않고 셸 변수에 저장합니다.

```sh
export LLMS_API_BASE=http://127.0.0.1:8080
BOOT_RESPONSE="$(curl -fsS -X POST "$LLMS_API_BASE/control/v1/bootstrap" \
  -H "X-Bootstrap-Token: $OPENLLMS_BOOTSTRAP_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"login":"sports-desk","project_name":"sports-desk","key_name":"owner"}')"
export LLMS_API_KEY="$(printf '%s' "$BOOT_RESPONSE" | jq -er .api_key)"
unset BOOT_RESPONSE
```

키를 보관한 뒤 볼륨을 유지하면서 부트스트랩을 비활성화합니다.

```sh
export OPENLLMS_BOOTSTRAP_TOKEN=''
docker compose -f gateway/compose.yaml up -d --force-recreate
```

발급된 게이트웨이 키는 계속 사용할 수 있습니다. 이후 컨테이너를 다시 만들 때도 `OPENLLMS_BOOTSTRAP_TOKEN`을 빈 문자열로 유지합니다.

계정 소유자가 다음 명령으로 기기 인증을 시작합니다. 브라우저에서 반환된 `verification_uri`를 열고 `user_code`를 입력해 연결을 승인합니다.

```sh
START_RESPONSE="$(curl -fsS -X POST "$LLMS_API_BASE/console/api/connect/codex/start" \
  -H "Authorization: Bearer $LLMS_API_KEY" \
  -H 'Content-Type: application/json' -d '{}')"
printf '%s' "$START_RESPONSE" | jq '{verification_uri,user_code,interval}'
PENDING_ID="$(printf '%s' "$START_RESPONSE" | jq -er .pending_id)"
unset START_RESPONSE
```

브라우저에서 승인한 뒤 반환된 `interval` 이상 간격으로 아래 요청을 반복합니다. HTTP 202는 승인 대기이며, HTTP 201이면 Codex 계정이 생성된 것입니다.

```sh
curl -i -sS -X POST "$LLMS_API_BASE/console/api/connect/codex/poll" \
  -H "Authorization: Bearer $LLMS_API_KEY" \
  -H 'Content-Type: application/json' \
  -d "{\"pending_id\":\"$PENDING_ID\",\"name\":\"sports-desk\"}"
```

같은 게이트웨이 키로 `/control/v1/routes`에서 라우트를 만들고 `/control/v1/routes/<slug>/accounts`에서 방금 생성한 Codex 계정만 연결합니다. Fieldnote의 `OPENLLMS_API_KEY`에는 라우트 키를, `OPENLLMS_BASE_URL`에는 `http://127.0.0.1:8080/r/<slug>/v1`을 설정합니다. Fieldnote 작업자가 요청을 등록하고 실행 상태를 관리합니다.

부트스트랩과 기기 인증에는 모델 호출이 필요하지 않습니다. 실제 분석을 실행하면 연결된 계정의 사용량이 차감될 수 있습니다.
