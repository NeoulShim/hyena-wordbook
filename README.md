# 혜나용 단어장 · HYENA NOTE

혜나를 위한 서버 없는 일본어 단어장. 하이에나 아이콘과 한국어 UI, 모바일 지원.

- 여러 단어장, 단어 추가·수정·삭제, 검색·품사·숙련도 필터
- 복수 품사 + 하나의 숙련도 + 변경되지 않는 입력일
- 브라우저 자동 저장·복원, `.neoulboard` JSON 파일 내보내기·불러오기
- 자동 저장 파일 연결: 전체 단어장 목록을 `default.neoulboard`에 저장·복원 (지원 브라우저)
- 숙련도별 무작위 최대 10문제, 2–4지선다, 정오답, 오답 재시험, 결과에서 태그 수정
- 일본어 입력 시 한국어 사전 후보 자동 채우기, 사전에 없는 읽기는 kuromoji로 분석
- 기기 일본어 TTS로 발음 듣기 (로컬 음성 우선)

## 실행·검증

Node.js 24에서 설치할 패키지 없이 실행합니다.

```sh
node server.js
node --test tests/*.test.js
node scripts/build.mjs
```

미리보기: `http://127.0.0.1:4173`. `dist/`가 정적 배포 결과입니다. 파일을 더블클릭하는 `file://` 방식은 모듈과 사전 로딩을 지원하지 않으므로 정적 HTTP 서버를 이용하세요.

## GitHub Pages

저장소: `NeoulShim/hyena-wordbook`. `main` 브랜치를 푸시하면 GitHub Actions가 테스트 후 배포합니다. 사이트: https://neoulshim.github.io/hyena-wordbook/

## 기본 저장과 파일 자동 저장

앱을 다시 열면 브라우저 저장소에서 마지막 단어장 목록을 자동 복원합니다. 수동 불러오기가 필요하지 않습니다. `저장 설정`에서 새 자동 저장 파일을 지정하거나 기존 파일을 연결할 수도 있습니다. 기본 파일명은 `default.neoulboard`이며 전체 단어장 목록을 담습니다. 사용자가 고른 파일 핸들은 IndexedDB에 보관하고, 단어 변경 후 파일과 브라우저에 저장합니다. 다음 실행 시 파일을 읽으며 외부에서 변경된 파일을 자동 덮어쓰지 않습니다.

File System Access API가 필요합니다. 지원하지 않는 브라우저는 내부 저장소를 사용합니다. 브라우저가 권한을 만료시키면 `연결 복원`을 눌러야 합니다. 파일 접근이 끊기거나 저장에 실패하면 변경 사항을 브라우저에 보관하고 복구 때 다시 저장합니다. 파일의 절대 경로는 웹앱에서 임의 지정하거나 조회할 수 없습니다.

## 데이터와 사전

사용자 데이터는 브라우저 `localStorage`의 `hyena-note:v1`에 저장합니다. 내보낸 파일은 `format`, `version`, `exportedAt`, `dictionaryAttribution`, `book`을 갖습니다. `book.words`는 `id`, `term`, `reading`, `meaning`, `pos` 배열, `status` (`unknown`, `learning`, `mastered`), `createdAt` ISO 날짜를 보존합니다. 최대 10,000단어, 파일 최대 15MB. 시험 결과는 현재 세션에만 존재합니다. 다른 탭이 데이터를 변경하면 충돌 방지를 위해 새로고침을 요구합니다.

한국어 위키낱말사전 / Kaikki의 일본어 자료를 CC BY-SA 4.0으로 가공해 동봉했습니다. 출처·가공 내역은 `data/japanese-ko.json`, `licenses.html`에 있고, 내려받은 단어장에도 출처 메타데이터가 포함됩니다. 뜻풀이·품사는 사용자가 확인해서 수정할 수 있습니다. 읽기는 사전에 있는 루비를 우선하고, 없으면 별도 Web Worker에서 kuromoji.js 0.1.2와 IPADIC으로 분석합니다. 읽기 사전은 처음 필요할 때 약 18MB를 불러오므로 느린 네트워크에서는 시간이 걸릴 수 있습니다. 업데이트는 앱 배포 시 함께 수행합니다.

사전 재생성: Kaikki의 일본어 JSONL 파일을 내려받고 `node scripts/build-dictionary.mjs /absolute/path/to/source.jsonl`. 원자료 시점이 달라지면 스크립트와 출처 페이지의 덤프 날짜도 갱신하세요.

음성 파일, 유료 API, 서버, 인증키는 필요하지 않습니다. 실제 음질과 지원 여부는 OS·브라우저·설치 음성에 따라 다릅니다. 로컬 일본어 음성이 없고 온라인 음성이 제공되면 안내 후 해당 음성을 사용합니다. 단어장이 다른 기기로 자동 동기화되지는 않으므로 파일로 옮기세요.

## 라이선스

사전 데이터: CC BY-SA 4.0. kuromoji.js: Apache-2.0. IPADIC: `vendor/kuromoji/NOTICE.md`의 조건. 타사 자료의 원 라이선스와 출처를 유지하세요.
