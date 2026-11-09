# 운영 종료 보고서 근거

[운영 종료 보고서](../fieldnote-postmortem.md)

| 파일 | 원본 범위와 변환 |
|---|---|
| [chat-confirmed-cards.csv](chat-confirmed-cards.csv) | 2026-10-27 ChatGPT 통합본의 02_entries_results.txt 및 recent_records.json에서 대조한 정산 카드. Snnn은 통합본 내부의 원문 식별 번호다. 같은 티켓의 진입 문서와 정산 문서는 하나로 셌다. |
| [fieldnote-ticket-excerpts.csv](fieldnote-ticket-excerpts.csv) | 2026-11-09 07:58 ET 읽기 전용 장부 조회. 직접 진입 6건에서 날짜, 배당, 유닛과 결과를 발췌했다. Fnn은 게시 자료에서 새로 매긴 순번이다. |
| [fieldnote-import-counts.csv](fieldnote-import-counts.csv) | 같은 조회에서 문서 출처가 있는 행을 종목별로 집계했다. 직접 진입 성적에서 제외했다. |
| [fieldnote-job-counts.csv](fieldnote-job-counts.csv) | 같은 조회에서 작업 최종 상태를 종목, 생성일 ET, 공급자별로 집계했다. |
| [usage-batches.csv](usage-batches.csv) | 10월 29일 결과 확인 배치의 최종 계측과 별도 경기 평가 배치의 저장 로그 진단에 기록된 합계. |
| [incident-excerpts.csv](incident-excerpts.csv) | 당시 작업 상태 기록과 저장 결과 감사, 배포 영수증에서 오류 문자열과 관측 범위만 발췌했다. |
| [billing-snapshot.csv](billing-snapshot.csv) | 10월 20일 Railway 조회에서 사용량과 예상액만 옮겼다. |
| [performance-summary.csv](performance-summary.csv) | 위 자료에서 계산한 양쪽의 종목별 확인 부분집합 성적. |

Python 3에서 집계와 Fieldnote 티켓 손익을 검증한다. 저장소 루트에서 실행한다.

    python3 docs/postmortem/reproduce.py --check

Matplotlib이 설치된 환경에서는 --charts를 추가해 SVG 세 장을 다시 생성할 수 있다. 스크립트 입력은 이 저장소의 비식별 발췌 자료다. 원문에서 카드 행을 고르는 과정은 수동으로 대조했다. 문서 수와 보고서 표의 티켓 수는 집계 단위가 다르며, 중간에 기록이 없는 날짜는 미확인이다.
