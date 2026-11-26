# 혜나용 단어장

일본어 단어, 읽기, 한국어 뜻, 품사, 숙련도를 관리하는 개인용 웹 단어장입니다.

- 프런트엔드: https://neoulshim.github.io/hyena-wordbook/
- GitHub Pages: 정적 화면과 사전 제공
- Cloudflare Worker + D1: 인증, 세션, 단일 공유 단어장 저장
- 처음 한 번 동기화 키로 연결하면 같은 브라우저에서는 자동 접속
- 단어 변경 자동 저장, 다른 기기 변경은 포커스 복귀 또는 15초 간격으로 반영
- 오프라인 변경 임시 보관, 독립적인 수정 병합, 동일 항목 충돌 시 선택
- 최대 10개 무작위 객관식 테스트, 숙련도별 범위, 정오답 확인 및 태그 수정
- 한국어 사전 자동 입력, kuromoji 가나 읽기, 기기 일본어 TTS

UI에는 파일 관리와 복수 단어장 기능이 없습니다. 서버에는 단어장 하나만 존재합니다. 최초 서버 생성 시 기존 브라우저 단어장이 있으면 합쳐 올리고, 이미 서버 단어장이 있으면 서버 데이터를 불러옵니다. 이전 버전의 브라우저 저장소는 자동으로 삭제하지 않습니다.

## 개발 및 검증

Node.js 24 이상을 사용합니다.

```sh
node --test tests/*.test.js
node scripts/build.mjs
node server.js
```

`server.js`는 정적 화면만 제공합니다. 동기화를 개발하려면 Wrangler의 로컬 Worker/D1을 실행하고 `cloud-config.js`의 공개 API 주소와 Worker `ALLOWED_ORIGINS`를 로컬 주소에 맞추세요. 테스트에는 운영 키를 사용하지 마세요.

## 배포

GitHub Actions의 `.github/workflows/pages.yml`이 테스트 후 `dist/`만 GitHub Pages에 배포합니다. backend, Wrangler 설정, 테스트 및 개발 파일은 정적 배포물에 포함하지 않습니다.

Cloudflare 배포에는 Wrangler의 계정 조회, Worker 편집, D1 편집 권한이 필요합니다.

1. `wrangler d1 create hyena-wordbook`으로 데이터베이스를 만들고 반환된 ID를 `wrangler.jsonc`에 지정합니다.
2. `wrangler d1 migrations apply hyena-wordbook --remote`로 스키마를 적용합니다.
3. `AUTH_KEY_HASH` Worker Secret에 동기화 키의 SHA-256(UTF-8, 소문자 64자리 hex)을 등록합니다. 실제 키와 해시를 소스, 명령행 인수, 환경 파일, 로그에 기록하지 마세요. Secret 입력은 숨김 표준 입력을 사용합니다.
4. `wrangler deploy`로 Worker를 배포합니다.
5. 배포된 HTTPS API 주소만 `cloud-config.js`에 설정한 뒤 GitHub에 푸시합니다.

`ALLOWED_ORIGINS`는 `https://neoulshim.github.io`로 제한합니다. API 주소와 데이터베이스 ID는 공개 설정이며 인증 수단이 아닙니다.

## 인증과 보관

- 키 검증은 Worker에서만 수행하며, 프런트엔드에는 키나 검증용 해시를 넣지 않습니다.
- 로그인 시 임의의 256비트 세션 토큰을 발급합니다. 브라우저는 토큰만 보관하고 서버는 그 해시를 저장합니다.
- 인증 없이 단어장을 조회하거나 수정할 수 없습니다. 응답에는 `Cache-Control: no-store`를 적용합니다.
- 로그인은 IP별 10분당 10회로 제한합니다. 요청 본문을 로깅하지 않으며 Worker observability도 끕니다.
- 세션은 마지막 사용 이후 약 1년간 유효하며 하루 단위로 갱신합니다. 세션 해제 시 서버에서도 폐기됩니다. Worker Secret을 변경하면 기존 세션은 무효화됩니다.
- 브라우저 저장소 삭제 또는 세션 만료 후에는 키를 다시 입력합니다. 인증된 브라우저에는 단어장 캐시와 세션 토큰이 남습니다.
- 단어장 저장은 D1 트랜잭션과 버전 확인으로 처리합니다. 오래된 버전은 덮어쓰지 않으며 단어의 기존 입력일은 서버에서도 보존합니다.
- 테스트 답안은 서버에 보내지 않습니다. 결과 창에서 변경한 단어 태그만 동기화합니다.

## 라이선스

사전 데이터: 한국어 위키낱말사전/Kaikki, CC BY-SA 4.0. kuromoji.js: Apache-2.0. IPADIC: `vendor/kuromoji/NOTICE.md`의 조건. 상세 출처와 가공 내용은 `licenses.html`에 있습니다.
