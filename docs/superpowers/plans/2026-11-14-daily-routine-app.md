# 데일리 루틴 앱 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 1인용 웹앱(PWA). 회사·개인 Google 캘린더를 함께 보고, 할 일·Heynote식 메모·신한 계좌 자산을 맥과 아이폰에서 관리한다.

**Architecture:** Next.js App Router 하나에 화면과 API(Route Handlers)를 함께 둔다. 데이터는 Postgres(Drizzle ORM)에 저장한다. 운영 DB는 Supabase이고, 로컬과 테스트는 PGlite(파일 또는 메모리)를 쓴다. 일정은 DB에 저장하지 않고 Google Calendar API에서 그때그때 읽는다. 알림은 외부 cron이 매분 `POST /api/cron/tick`을 호출하면 서버가 Web Push로 보낸다.

**Tech Stack:**
- 앱: Next.js(최신 안정판), React, TypeScript strict, CSS Modules와 CSS 변수(Tailwind는 쓰지 않음)
- 데이터: Drizzle ORM, postgres-js, @electric-sql/pglite
- 인증·보안: arctic(Google OAuth), jose(세션 JWT), zod
- 기능 라이브러리: CodeMirror 6, SheetJS(`xlsx`, cdn.sheetjs.com 배포판), web-push
- 테스트: Vitest, @testing-library/react

**Spec:** `docs/superpowers/specs/2026-11-14-daily-routine-app-design.md`. 최종 시안은 `docs/superpowers/specs/mockups/2026-11-14-ilryeok-v2.html`이고, 각 트랙은 이 두 문서를 함께 읽는다.

## Global Constraints

- 시간대는 `Asia/Seoul`로 고정한다. 서버(Vercel)는 UTC로 돌아가므로 "오늘", 마감, 알림 시각은 반드시 `src/shared/time.ts`의 함수로 계산한다.
- 금액은 원 단위 정수(`number`)로 다룬다. 소수는 쓰지 않는다.
- 회사 캘린더에는 절대 쓰지 않는다. 서버는 개인 기본 캘린더(`primary`) 외의 대상으로 오는 쓰기 요청을 모두 403으로 거절한다.
- 로그인은 `ALLOWED_EMAIL`(쉼표로 여러 개, 첫 번째가 기본)에 있는 이메일만 허용한다(`isAllowedEmail`). 로그인은 개인 Gmail(예비로 회사 메일)로 본인 확인만 하고, 캘린더는 설정에서 따로 연결한다. `/login`, `/api/auth/*`, `/api/cron/tick`, `/manifest.webmanifest`, `/sw.js`를 뺀 모든 API는 `requireUser()`를 통과해야 한다.
- 디자인은 spec §5.7을 따른다. 색은 `src/ui/tokens.css`의 CSS 변수만 쓰고 hex를 직접 쓰지 않는다.
  - 고정폭 글꼴, 영문 대문자 라벨, 가운뎃점(·)으로 이은 정보 줄, 버튼 끝의 "→"는 쓰지 않는다.
  - 숫자는 `.num` 클래스(Archivo, tabular-nums)로 쓴다.
- 문구는 존댓말 평서문으로 쓴다. 버튼은 하는 일을 그대로 적는다(예: "거래내역 엑셀 올리기", "메모 쓰기"). 오류 문구는 무엇이 문제인지와 어떻게 고치는지를 말한다.
- 반응형 기준은 `900px`이다. 이보다 좁으면 하단 탭 3개(할 일 / 메모 / 자산)와 + 버튼을 쓰고, 넓으면 ☰ 서랍 메뉴(⌘\로 토글, "고정" 가능)를 쓴다.
- 비밀값은 서버 코드에서만 읽는다. 브라우저로 나가는 값은 `NEXT_PUBLIC_VAPID_PUBLIC_KEY` 하나뿐이다.
- 개발 편의 기능 `DEV_LOGIN=1`은 `NODE_ENV !== 'production'`일 때만 동작한다.
- **커밋하지 않는다.** git 작업은 통합 담당(메인 세션)이 사용자 확인 후에 한다. 각 Task의 "Commit" 단계는 "테스트 통과 확인"으로 대신한다.
- **`src/server/db/schema.ts`와 `drizzle/` 마이그레이션은 Phase 0 담당만 고친다.** 다른 트랙에서 스키마 변경이 필요하면 작업을 멈추지 말고, 최종 보고에 필요한 변경을 적는다.

## Review Focus

1. **자정 근처의 날짜 경계.** UTC 2026-11-14T15:30Z는 한국 시각으로 11월 15일 00:30이다. 이때 15일 마감 할 일은 "오늘", 14일 마감 할 일은 "지연"이어야 한다. → Task B1 테스트 `overdue uses Seoul date`.
2. **같은 시각, 같은 금액의 거래 두 건.** 예를 들어 4,500원 커피 결제 두 건이 잔액만 다르게 찍힌 경우 둘 다 저장해야 한다. 같은 파일을 두 번 올려도 늘어나면 안 된다. → Task D1 테스트 `dedupe keeps same-amount rows with different balance`, `re-upload inserts 0`.
3. **두 기기에서 동시에 같은 메모 블록을 수정.** 나중에 저장한 쪽이 조용히 덮어쓰면 안 된다. 서버는 409로 거절하고, 클라이언트는 내 내용을 "충돌 사본" 블록으로 남긴다. → Task C1 `stale baseVersion returns 409`, Task C3 `conflict creates copy block`.
4. **회사 캘린더로 오는 쓰기 요청.** 클라이언트가 회사 calendarId나 회사 일정 id로 PATCH·DELETE를 보내도 403이어야 한다. → Task A3 테스트 `rejects writes to non-primary calendars`.
5. **완료하거나 마감을 바꾼 할 일의 알림.** 완료한 할 일은 알림이 오면 안 되고, 마감을 바꾼 할 일은 바뀐 시각으로 와야 한다. 반복 할 일을 완료하면 다음 회차에 새 알림이 생겨야 한다. → Task B2 `complete cancels pending notification`, `reschedule replaces notification`, `recurring complete schedules next`.

---

## File Structure

```
src/
  app/
    layout.tsx                 # Phase 0: 글꼴, tokens.css, <AppShell>
    manifest.ts                # Track E
    login/page.tsx             # Track A
    (app)/today/page.tsx       # Track E (할 일 › 오늘)
    (app)/calendar/page.tsx    # Track E (할 일 › 달력)
    (app)/list/page.tsx        # Track B (할 일 › 목록)
    (app)/memo/page.tsx        # Track C
    (app)/assets/page.tsx      # Track D
    (app)/settings/page.tsx    # Track E (섹션은 각 트랙 컴포넌트를 조립)
    api/auth/...               # Track A
    api/connect/work/...       # Track A
    api/calendar/...           # Track A
    api/todos/...              # Track B
    api/memo/...               # Track C
    api/assets/...             # Track D
    api/push/...               # Track E
    api/cron/tick/route.ts     # Track E
    api/settings/...           # Track E (reminders), Track A (connections)
  shared/                      # Phase 0: 브라우저·서버 공용 타입과 순수 함수
    contracts.ts  time.ts  http.ts
  server/                      # Phase 0: 서버 공용
    env.ts  db/schema.ts  db/client.ts  db/test-db.ts
    auth/session.ts  crypto.ts
  ui/                          # Phase 0: 디자인 토큰과 기본 부품
    tokens.css  primitives/{Tag,Checkbox,Button,Sheet}.tsx (+ .module.css)
  features/
    shell/      # Track E: AppShell, BottomTabs, Drawer, QuickAdd, TodaySegment
    calendar/   # Track A(server, client.ts) + Track E(UI: MonthGrid, EventDetailSheet, DayTimeline)
    todos/      # Track B
    memo/       # Track C
    assets/     # Track D
    notify/     # Track E
public/sw.js    # Track E
```

---

## Phase 0 — 기반 (통합 담당이 순서대로 실행, 병렬 트랙보다 먼저)

### Task 0.1: 프로젝트 골격과 도구

**Files:** `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `.env.example`, `.gitignore`, `src/app/layout.tsx`, `src/app/page.tsx`(→ `/today` 리다이렉트)

- [ ] create-next-app(TypeScript, App Router, `src/`, ESLint, Tailwind 없음)으로 만든다. 의존성을 설치한다: `drizzle-orm postgres @electric-sql/pglite arctic jose zod web-push @codemirror/state @codemirror/view @codemirror/commands @codemirror/language https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`. 개발 의존성은 `drizzle-kit vitest @vitest/coverage-v8 @testing-library/react @testing-library/user-event jsdom @types/web-push`이다.
- [ ] 스크립트를 등록한다: `"test": "vitest run"`, `"typecheck": "tsc --noEmit"`, `"db:generate": "drizzle-kit generate"`.
- [ ] 검증: `npm run typecheck && npm test`가 통과한다(테스트 0개 허용).

### Task 0.2: 공용 계약 · 시간 · 환경 변수

**Files:** `src/shared/contracts.ts`, `src/shared/time.ts`, `src/shared/http.ts`, `src/server/env.ts`, 테스트 `src/shared/time.test.ts`

**Produces:**
- `contracts.ts`: 아래 타입을 그대로 둔다.

```ts
export type Scope = 'work' | 'personal';
export type CalendarSource = 'personal' | 'work' | 'holiday';
export interface CalendarEvent {
  id: string; calendarId: string; source: CalendarSource;
  title: string | null;        // 바쁨만 보이면 null
  busyOnly: boolean;
  start: string; end: string;  // allDay면 'YYYY-MM-DD', 아니면 ISO(+09:00)
  allDay: boolean; location: string | null; attendeeCount: number | null;
  recurringEventId: string | null;
  readOnly: boolean;           // work, holiday는 true
}
export type WorkCalendarStatus = 'connected' | 'busy_only' | 'disconnected' | 'error';
export interface EventsResponse { events: CalendarEvent[]; workStatus: WorkCalendarStatus; personalConnected: boolean }
export interface NewPersonalEvent { title: string; start: string; end: string; allDay: boolean; description?: string }
export type Recurrence = { freq: 'daily' } | { freq: 'weekly'; weekdays: number[] } | { freq: 'monthly'; day: number }; // weekdays: 0=일
export interface Todo {
  id: string; title: string; scope: Scope;
  dueDate: string | null; dueTime: string | null;  // 'YYYY-MM-DD', 'HH:MM' (서울)
  doneAt: string | null; recurrence: Recurrence | null; seriesId: string | null;
  notify: { enabled: boolean; offsetMin: number | null };   // null = 기본값(30분 전 / 날짜만이면 09:00)
}
export interface EventRef {
  eventKey: string;  // `${calendarId}:${eventId}`
  calendarId: string; eventId: string; recurringEventId: string | null;
  source: 'personal' | 'work'; title: string; start: string; end: string; allDay: boolean; deleted: boolean;
}
export interface MemoBlock { id: string; content: string; createdAt: string; updatedAt: string; version: number; eventRef: EventRef | null }
export type AccountKind = 'checking' | 'savings' | 'investment';
export interface BankAccount {
  id: string; kind: AccountKind; name: string; numberMasked: string | null;
  balance: number | null; asOf: string | null; stale: boolean;
  manualValuation: { amount: number; enteredAt: string } | null;
}
export interface Txn { id: string; accountId: string; occurredAt: string; description: string; withdrawal: number; deposit: number; balanceAfter: number; isTransfer: boolean }
export interface MonthFlow { month: string; deposit: number; withdrawal: number; transfer: number }
export interface AssetsSummary { accounts: BankAccount[]; total: number; flow: MonthFlow }
export const APP_TZ = 'Asia/Seoul';
```

- `time.ts`:
  - `seoulToday(now?: Date): string` 'YYYY-MM-DD'
  - `seoulParts(d: Date): { date: string; time: string; weekday: number }`
  - `seoulDateTimeToDate(date: string, time: string): Date`
  - `addDays(date: string, n: number): string`
  - `weekdayOf(date: string): number`
  - `formatKoreanDate(date: string): string` → "11월 14일 토요일"
  - `formatKoreanTimestamp(iso: string): string` → "11월 14일 오전 9:12"
- `http.ts`:
  - `json(data: unknown, init?: number | ResponseInit): Response`
  - `problem(status: number, message: string): Response`. 본문은 `{ message }`이다.
- `env.ts`: `getEnv()`는 zod로 검사하고 처음 호출할 때만 평가한다. 키 목록은 `docs/SETUP.md`와 같다.

- [ ] 테스트 작성(`time.test.ts`):
  - `seoulToday(new Date('2026-11-14T15:30:00Z')) === '2026-11-15'`
  - `formatKoreanDate('2026-11-14') === '11월 14일 토요일'`
  - `seoulDateTimeToDate('2026-11-16','09:00').toISOString() === '2026-11-16T00:00:00.000Z'`
  - `formatKoreanTimestamp('2026-11-14T00:12:00Z') === '11월 14일 오전 9:12'`
- [ ] 구현하고 `npx vitest run src/shared` 통과를 확인한다.

### Task 0.3: DB 스키마 · 클라이언트 · 테스트 DB

**Files:** `src/server/db/schema.ts`, `src/server/db/client.ts`, `src/server/db/test-db.ts`, `drizzle.config.ts`, `drizzle/*.sql`, 테스트 `src/server/db/schema.test.ts`

**Produces (테이블):**
- `googleAccounts`: id, role(`'personal'|'work'`, unique), email, accessTokenEnc, refreshTokenEnc, expiresAt, scope, status(`'ok'|'needs_reconnect'`), updatedAt
- `settings`: 한 행(id=1)이다.
  - 회사 캘린더: workCalendarVia(`'work_account'|'personal_shared'|'none'`), workCalendarId
  - 알림 기본값: defaultOffsetMin=30, dateOnlyNotifyTime='09:00'
  - 업로드 알림: uploadReminderDow=0, uploadReminderTime='20:00', lastUploadReminderSentAt
- `todos`: id(uuid), title, scope, dueDate(date), dueTime(text), doneAt, recurrence(jsonb), seriesId(uuid), notifyEnabled, notifyOffsetMin, createdAt, updatedAt
- `notifications`: id, kind(`'todo_due'|'upload_reminder'`), todoId(fk null, on delete cascade), fireAt, sentAt, title, body, url
- `memoBlocks`: id, content, eventKey(unique, nullable), eventRef(jsonb), version(int, 기본 1), createdAt, updatedAt
- `bankAccounts`: id, kind, name, numberMasked, numberDigits(unique, nullable), asOf(date), manualAmount, manualEnteredAt
- `transactions`: id, accountId, occurredAt, description, withdrawal, deposit, balanceAfter, isTransfer, transferOverridden, dedupeKey. unique 인덱스는 (accountId, dedupeKey)이다.
- `uploads`: id, accountId, uploadedAt, periodStart, periodEnd, rowCount, insertedCount
- `pushSubscriptions`: id, endpoint(unique), p256dh, auth, createdAt

**함수:**
- `getDb(): Db`. `DATABASE_URL`이 없거나 `pglite:`로 시작하면 PGlite(`./.data/pglite`)를 쓰고, 아니면 postgres-js(`prepare:false`)를 쓴다.
- `createTestDb(): Promise<Db>`. 메모리 PGlite에 `drizzle/` 마이그레이션을 적용하고 settings 행을 넣는다.
- `type Db`

- [ ] 테스트 `createTestDb applies migrations and seeds settings`를 쓴다. settings의 defaultOffsetMin이 30이어야 한다.
- [ ] 스키마를 작성하고 `npm run db:generate`로 마이그레이션을 만든다. 테스트 통과를 확인한다.

### Task 0.4: 세션 · 암호화 · 디자인 토큰 · 기본 부품

**Files:**
- 세션·암호화: `src/server/auth/session.ts`, `src/server/crypto.ts`
- 디자인: `src/ui/tokens.css`, `src/ui/primitives/*`
- 테스트: `src/server/auth/session.test.ts`, `src/server/crypto.test.ts`

**Produces:**
- `session.ts`
  - `createSessionCookie(email: string): Promise<string>`. Set-Cookie 값을 돌려준다. 이름은 `drs`, httpOnly, secure(prod), sameSite=lax, 180일이다.
  - `readSession(req?: Request): Promise<{ email: string } | null>`
  - `requireUser(): Promise<{ email: string }>`. 세션이 없거나 허용 이메일이 아니면 `UnauthorizedError`를 던진다.
  - `withUser(handler)`: route 래퍼로, 401은 `problem(401,'로그인이 필요해요.')`로 돌려준다.
- `crypto.ts`
  - `encrypt(plain: string): string`. AES-256-GCM이고 `ENCRYPTION_KEY`는 base64 32바이트다.
  - `decrypt(token: string): string`
- `tokens.css`: spec §5.7의 색 9개를 `--paper --sheet --ink --pencil --rule --sun --sat --marker --passbook`로 둔다. 다크 모드 값, `.num`, `.hl`(형광펜 밑칠) 유틸도 넣는다.
- 기본 부품:
  - `<Tag scope="work|personal"/>`: 회사는 채움, 개인은 테두리
  - `<Checkbox checked late onChange/>`
  - `<Button variant="ink|outline|ghost"/>`
  - `<Sheet open onClose title>`: 모바일은 하단 시트, 데스크톱은 가운데 대화상자

- [ ] 테스트를 쓴다.
  - `decrypt(encrypt('x')) === 'x'`
  - 토큰을 변조하면 throw
  - 다른 이메일의 세션이면 `requireUser`가 throw
  - 만료된 쿠키면 null
- [ ] 구현하고 테스트 통과를 확인한다.

---

## 병렬 트랙 (Phase 0 완료 후 동시에 진행)

각 트랙은 자기 폴더와 자기 API 경로만 만든다. 다른 트랙의 모듈은 아래 **Interfaces**에 적힌 이름으로만 쓴다. 아직 없는 모듈을 import해야 하면 그 이름 그대로 쓰고, 해당 트랙이 만든다. 각 트랙이 끝나면 `npx vitest run <자기 폴더>`와 `npm run typecheck`를 실행한다. typecheck 오류가 다른 트랙의 아직 없는 모듈 때문이면 보고에 적는다.

### Track A — Google 로그인 · 캘린더 연결 · 일정 API

#### Task A1: 로그인

**Files:**
- `src/features/calendar/server/google-oauth.ts`
- `src/app/api/auth/login/route.ts`, `src/app/api/auth/callback/google/route.ts`, `src/app/api/auth/logout/route.ts`, `src/app/api/auth/dev-login/route.ts`
- `src/app/api/connect/personal/route.ts`, `src/app/api/connect/personal/callback/route.ts`
- `src/app/login/page.tsx`
- 테스트 `src/features/calendar/server/google-oauth.test.ts`

**Interfaces:**
- Consumes: `createSessionCookie`, `encrypt`, `getDb`, `getEnv`
- Produces:
  - `LOGIN_SCOPES = ['openid','email','profile']` (로그인은 본인 확인만, 토큰 저장 안 함)
  - `PERSONAL_SCOPES = ['openid','email','profile','https://www.googleapis.com/auth/calendar.events','https://www.googleapis.com/auth/calendar.readonly']`
  - `WORK_SCOPES = ['openid','email','https://www.googleapis.com/auth/calendar.readonly']`
  - `saveGoogleTokens(db, role, tokens, email)`
  - `getAccessToken(db, role): Promise<string | null>`. 만료 60초 전이면 갱신한다. 갱신에 실패하면 status를 `needs_reconnect`로 바꾸고 null을 돌려준다.

**Steps:**
- [ ] 테스트를 쓴다.
  - `callback rejects email not in ALLOWED_EMAIL with 403 page`
  - `callback accepts backup email in ALLOWED_EMAIL list`
  - `login callback does not store calendar tokens`
  - `org policy error at login shows personal-login page`
  - `personal connect saves personal role tokens`
  - `getAccessToken refreshes when expiring and stores new token`(fetch 모킹)
  - `refresh failure marks needs_reconnect`
- [ ] 구현한다. 로그인 OAuth는 `LOGIN_SCOPES`, `prompt=select_account`, PKCE, state 쿠키를 쓴다. 개인 캘린더 연결(`/api/connect/personal`)은 `PERSONAL_SCOPES`, `access_type=offline&prompt=consent`로 받아 role `personal`로 저장한다.
- [ ] 로그인 페이지는 앱 이름과 "Google로 로그인" 버튼만 둔다. `DEV_LOGIN=1`이면 "개발용 로그인" 링크를 더한다.
- [ ] 테스트 통과를 확인한다.

#### Task A2: 회사 캘린더 연결 · 연결 상태

**Files:**
- `src/app/api/connect/work/route.ts`, `src/app/api/connect/work/callback/route.ts`
- `src/app/api/settings/connections/route.ts`
- `src/features/calendar/ConnectionsSection.tsx`
- 테스트 `src/features/calendar/server/connections.test.ts`

**Interfaces:**
- Produces:
  - `GET /api/settings/connections` → `{ personal: {email} | null, work: { via, email: string|null, calendarId: string|null, status } }`
  - `PUT /api/settings/connections` `{ via:'personal_shared', calendarId }`: 공유받은 캘린더를 지정한다.
  - `GET /api/settings/connections/shared-calendars` → 개인 계정의 calendarList 중 owner가 아닌 캘린더 목록
  - `<ConnectionsSection />`
- 연결 화면의 버튼 문구는 "회사 캘린더 연결하기", "공유받은 캘린더에서 고르기"다. 연결이 실패하면 "회사 계정에서 외부 앱 연결이 막혀 있어요. 회사 캘린더를 개인 계정에 공유한 뒤 '공유받은 캘린더에서 고르기'를 눌러 주세요."를 보여준다.

**Steps:**
- [ ] 테스트를 쓴다.
  - `work callback with admin_policy_enforced error redirects with blocked flag`
  - `PUT via personal_shared stores calendarId`
- [ ] 구현하고 테스트 통과를 확인한다.

#### Task A3: 일정 읽기 · 쓰기 API

**Files:**
- `src/features/calendar/server/events.ts`, `src/app/api/calendar/events/route.ts`, `src/app/api/calendar/events/[id]/route.ts`
- `src/features/calendar/client.ts`
- 테스트 `src/features/calendar/server/events.test.ts`

**Interfaces:**
- Produces:
  - `GET /api/calendar/events?from=YYYY-MM-DD&to=YYYY-MM-DD` → `EventsResponse`. `to`는 포함한다.
  - `POST /api/calendar/events` body `NewPersonalEvent` → `CalendarEvent`. 대상은 개인 `primary`다.
  - `PATCH|DELETE /api/calendar/events/[id]`. 개인 `primary`에 있는 일정만 받는다.
  - `client.ts`: `fetchEvents(from,to): Promise<EventsResponse>`, `createEvent(e)`, `updateEvent(id, patch)`, `deleteEvent(id)`
- 동작:
  - `singleEvents=true&orderBy=startTime`으로 개인 primary, 회사 캘린더, 공휴일 캘린더 `ko.south_korea#holiday@group.v.calendar.google.com`을 읽어 합친다.
  - 회사 캘린더의 events.list가 403·404이면 `freebusy.query`로 바꿔서 바쁨 블록을 만든다. 이때 `title:null`, `busyOnly:true`, `workStatus:'busy_only'`다.
  - 이벤트에 summary가 없거나 visibility가 private이면 busyOnly로 처리한다.
  - 같은 범위를 다시 요청하면 60초 동안 메모리 캐시를 쓴다.

**Steps:**
- [ ] 테스트를 쓴다(fetch 모킹).
  - `merges personal, work and holiday events with source and readOnly`
  - `falls back to freebusy when work events 403`. 결과가 busyOnly이고 title이 null이어야 한다.
  - `rejects writes to non-primary calendars`. 회사 일정 id로 PATCH를 보내면 403이고, Google로 쓰기 요청이 0번 나가야 한다.
  - `no personal connection returns personalConnected:false and empty events`
- [ ] 구현하고 테스트 통과를 확인한다.

### Track B — 할 일

#### Task B1: 할 일 도메인 규칙 (순수 함수)

**Files:** `src/features/todos/rules.ts`, 테스트 `src/features/todos/rules.test.ts`

**Produces:**
- `todayBucket(todo: Todo, now: Date): 'overdue'|'today'|'upcoming'|'nodate'|'done'`
- `nextOccurrence(r: Recurrence, fromDate: string): string`. 오늘보다 뒤의 다음 회차를 돌려준다. 매월 31일은 그 달의 마지막 날로 맞춘다.
- `notifyAt(todo: Todo, s: { defaultOffsetMin: number; dateOnlyNotifyTime: string }): Date | null`
- `sortForList(todos: Todo[], now: Date): Todo[]`. 순서는 지연 → 오늘 → 다가오는 마감 → 날짜 없음이다.

**Steps:**
- [ ] 테스트를 쓴다.
  - `overdue uses Seoul date`: now `2026-11-14T15:30Z`일 때 마감 `2026-11-14`는 overdue, `2026-11-15`는 today
  - `due time passed today is overdue`: 마감 `2026-11-14 18:00`, now `2026-11-14T09:30Z`(18:30 KST)이면 overdue
  - `weekly next occurrence`: `{weekly:[6]}`, from `'2026-11-14'` → `'2026-11-21'`
  - `monthly day 31 clamps`: `{monthly:31}`, from `'2026-11-14'` → `'2026-11-30'`
  - `notifyAt with time`: 16일 18:00, offset null → `2026-11-16T08:30:00Z`
  - `notifyAt date only`: 16일 → `2026-11-16T00:00:00Z`(09:00 KST)
  - `notifyAt disabled returns null`
- [ ] 구현하고 테스트 통과를 확인한다.

#### Task B2: 할 일 API와 알림 예약

**Files:**
- `src/features/todos/server/repo.ts`, `src/features/todos/server/notify.ts`
- `src/app/api/todos/route.ts`, `src/app/api/todos/[id]/route.ts`, `src/app/api/todos/[id]/complete/route.ts`, `src/app/api/todos/[id]/uncomplete/route.ts`
- `src/features/todos/client.ts`
- 테스트 `src/features/todos/server/api.test.ts`

**Interfaces:**
- Produces:
  - `GET /api/todos?view=today|all` → `{ todos: Todo[] }`. today는 지연, 오늘 마감, 오늘 차례인 반복만 담는다.
  - `POST` `{title, scope?, dueDate?, dueTime?, recurrence?, notify?}`. 제목만 있어도 된다. scope 기본값은 personal이다.
  - `PATCH /[id]`, `DELETE /[id]`
  - `POST /[id]/complete` → `{ completed: Todo, next: Todo | null }`
  - `POST /[id]/uncomplete`
  - `rescheduleTodoNotification(db, todoId): Promise<void>`. 보내지 않은 todo_due 알림을 지우고 `notifyAt`으로 다시 만든다.
  - `client.ts`: `fetchTodos(view)`, `createTodo(input)`, `updateTodo(id, patch)`, `completeTodo(id)`, `uncompleteTodo(id)`, `deleteTodo(id)`

**Steps:**
- [ ] 테스트를 쓴다(`createTestDb`).
  - `title-only create works`
  - `complete cancels pending notification`
  - `reschedule replaces notification`
  - `recurring complete schedules next`. 다음 회차 행이 생기고 같은 seriesId이며 그 알림 행도 있어야 한다.
  - `today view excludes nodate`
  - `requires session`: 쿠키가 없으면 401
- [ ] 구현하고 테스트 통과를 확인한다.

#### Task B3: 할 일 UI

**Files:**
- `src/features/todos/TodoRow.tsx`, `src/features/todos/TodoSection.tsx`, `src/features/todos/TodoEditorSheet.tsx`
- `src/app/(app)/list/page.tsx`
- 테스트 `src/features/todos/TodoRow.test.tsx`

**Interfaces:**
- Produces:
  - `<TodoSection view="today" />`: Track E의 오늘 화면이 쓴다.
  - `<TodoEditorSheet open todo? onClose />`
  - `<TodoRow todo onToggle onOpen />`

**표시 규칙:**
- 지연된 할 일은 체크박스 테두리를 `--sun`으로 하고, 오른쪽에 "어제까지" 또는 "N일 전까지"를 쓴다.
- 오늘 마감은 시간을 보여준다. 다른 날 마감은 "16일 18:00"처럼 쓴다. 반복은 "매주 토", "매일", "매월 5일"로 쓴다.
- 편집 시트에 들어가는 항목: 제목, 회사/개인, 마감 날짜·시간, 반복, 알림(켜기/끄기, "몇 분 전").
- 목록 화면은 구역을 지연 / 오늘 / 다가오는 마감 / 날짜 없음으로 나누고, 회사·개인 필터와 "완료한 것 보기"를 둔다.

**Steps:**
- [ ] 테스트를 쓴다.
  - `overdue row shows 어제까지 in sun color class`
  - `weekly recurrence label 매주 토`
- [ ] 구현하고 테스트 통과를 확인한다.

### Track C — 메모 (Heynote 방식)

#### Task C1: 메모 블록 API

**Files:**
- `src/features/memo/server/repo.ts`
- `src/app/api/memo/blocks/route.ts`, `src/app/api/memo/blocks/[id]/route.ts`, `src/app/api/memo/event-keys/route.ts`
- `src/features/memo/client.ts`
- 테스트 `src/features/memo/server/api.test.ts`

**Interfaces:**
- Produces:
  - `GET /api/memo/blocks` → `{ blocks: MemoBlock[] }`. createdAt 내림차순이다.
  - `POST /api/memo/blocks` `{ content?: string; eventRef?: EventRef }` → 201 block. 같은 eventKey 블록이 이미 있으면 200으로 그 블록을 돌려준다.
  - `PUT /api/memo/blocks/[id]` `{ content, baseVersion }` → 200 block(version+1). 버전이 다르면 409 `{ current: MemoBlock }`이다.
  - `DELETE /api/memo/blocks/[id]`
  - `GET /api/memo/event-keys` → `{ keys: string[] }`
  - `client.ts`: `fetchBlocks()`, `createBlock(input)`, `saveBlock(id, content, baseVersion)`(결과는 `{ok:true, block} | {ok:false, current}`), `deleteBlock(id)`, `fetchEventKeys()`, `openEventMemo(ref: EventRef): Promise<MemoBlock>`. 마지막 함수는 POST 후 `/memo?block=<id>`로 이동하는 데 쓴다.

**Steps:**
- [ ] 테스트를 쓴다.
  - `stale baseVersion returns 409 with current`
  - `same eventKey returns existing block`
  - `new event block content starts with "- "`
  - `blocks ordered newest first`
- [ ] 구현하고 테스트 통과를 확인한다.

#### Task C2: 편집기 확장 (CodeMirror 6)

**Files:** `src/features/memo/editor/{indent.ts,bold.ts,guides.ts,currentLine.ts,index.ts}`, 테스트 `src/features/memo/editor/editor.test.ts`

**Produces:** `memoExtensions(opts: { onNewBlock(): void; onBoundary(dir: 'up'|'down'): void }): Extension[]`

**Steps:**
- [ ] 테스트를 쓴다. EditorState와 command로 직접 검증한다.
  - `Tab indents line by 2 spaces; Shift-Tab outdents`
  - `Enter continues "- " with same indent`
  - `Enter continues "1. " as "2. "`
  - `Enter on empty bullet removes bullet`
  - `Mod-b wraps selection in ** and toggles off`
  - `bold markers hidden via decoration but text kept as **x**`
  - `Mod-Enter calls onNewBlock`
  - `ArrowUp on first line calls onBoundary('up')`
- [ ] 구현한다.
  - 들여쓰기 안내선은 들여쓰기 단계마다 `--rule` 색 1px 세로선으로 그린다.
  - 현재 줄은 `--marker` 그라데이션 밑칠로 칠한다.
  - 굵게는 `**` 기호를 숨기고 font-weight 700으로 보여준다.
- [ ] 테스트 통과를 확인한다.

#### Task C3: 메모 화면

**Files:**
- `src/features/memo/MemoPage.tsx`, `src/features/memo/BlockEditor.tsx`, `src/features/memo/EventLabel.tsx`, `src/features/memo/MobileToolbar.tsx`, `src/features/memo/draft.ts`
- `src/app/(app)/memo/page.tsx`
- 테스트 `src/features/memo/MemoPage.test.tsx`

**동작:**
- 블록마다 CodeMirror를 하나씩 둔다. 블록 사이는 `onBoundary`로 이동하고, Cmd+Enter를 누르면 맨 위에 새 블록을 만들고 포커스를 옮긴다.
- 블록 머리에는 `formatKoreanTimestamp(createdAt)`를 표시한다. 일정 블록이면 `<EventLabel>`을 보여준다. 이름표에는 제목, `11월 16일 월요일 10:00–11:00`, Tag, "일정 보기" 링크(`/calendar?date=`)가 있고, 일정이 삭제됐으면 "삭제된 일정"을 표시한다.
- 저장은 입력이 멈추고 800ms 뒤에 한다. 저장하지 못한 내용은 `draft.ts`(localStorage, try/catch)에 보관하고, 다시 연결되면 보낸다.
- 409를 받으면 서버 내용을 블록에 반영하고, 내 내용은 "충돌 사본 — <시각>"으로 시작하는 새 블록으로 만든다.
- 검색(⌘F/돋보기)은 블록 내용과 일정 이름표 제목에서 찾는다.
- `?block=<id>`로 들어오면 그 블록으로 스크롤하고 포커스한다.
- 900px 미만에서 키보드가 열려 있을 때(focus 기준) 하단 탭을 숨기고 `<MobileToolbar>`를 띄운다. 버튼은 들여쓰기, 내어쓰기, B, 새 블록, 완료다.

**Steps:**
- [ ] 테스트를 쓴다.
  - `conflict creates copy block`
  - `event block shows label with 일정 보기`
  - `offline save keeps draft`
- [ ] 구현하고 테스트 통과를 확인한다.

### Track D — 자산 (신한 엑셀 · 통장 화면)

#### Task D1: 엑셀 파서와 반영 규칙 (순수 함수)

**Files:**
- `src/features/assets/parse/shinhan.ts`, `src/features/assets/rules.ts`
- 테스트 `src/features/assets/parse/shinhan.test.ts`, `src/features/assets/rules.test.ts`

**Produces:**
- `parseShinhanWorkbook(buf: ArrayBuffer): ParsedStatement | ParseError`
  - `ParsedStatement = { accountDigits: string|null; numberMasked: string|null; kindHint: AccountKind|null; periodStart: string|null; periodEnd: string|null; rows: ParsedRow[] }`
  - `ParsedRow = { occurredAt: string; description: string; withdrawal: number; deposit: number; balanceAfter: number }`
  - `ParseError = { error: string }`. 문구는 사용자에게 그대로 보여준다.
  - 헤더 행은 앞쪽 30행 안에서 찾는다. 열 이름 후보는 다음과 같다.
    - 날짜: 거래일자, 거래일시, 일자
    - 시간: 거래시간
    - 내용: 적요, 내용, 거래내용, 기재내용
    - 출금: 출금, 출금액, 찾으신금액
    - 입금: 입금, 입금액, 맡기신금액
    - 잔액: 잔액, 거래후잔액
  - 헤더 위쪽 셀에서 계좌번호 `\d{3}-\d{2,3}-\d{6}`와 조회기간 `YYYY.MM.DD ~ YYYY.MM.DD`(구분자 `.-/` 허용)를 읽는다.
  - HTML 표를 .xls로 저장한 파일도 SheetJS가 읽을 수 있게 한다.
- `dedupeKey(row): string`. sha256(occurredAt|withdrawal|deposit|balanceAfter|description)이다.
- `latestBalance(txns)`
- `asOfDate(uploads, txns)`. spec §5.4 규칙을 따른다.
- `isStale(asOf, now): boolean`. 기준일로부터 7일보다 오래됐으면 true다.
- `detectTransfers(txnsByAccount): Set<txnId>`. 같은 날, 서로 다른 내 계좌에서 출금액과 입금액이 같으면 이체로 본다.
- `monthFlow(txns, month): MonthFlow`. isTransfer인 거래는 transfer로만 더한다.

**Steps:**
- [ ] 테스트를 쓴다. 테스트 안에서 SheetJS로 합성 통합문서를 만든다.
  - `finds header below title rows`. 1~6행은 제목, 계좌번호, 조회기간이고 7행이 헤더인 파일
  - `parses 찾으신금액/맡기신금액 layout`
  - `missing header returns error "거래내역 표를 찾지 못했어요. 신한 인터넷뱅킹에서 받은 거래내역 엑셀인지 확인해 주세요."`
  - `dedupe keeps same-amount rows with different balance`
  - `stale after 7 days`
  - `transfer pair excluded from flow`
  - `asOf uses max periodEnd`
- [ ] 구현하고 테스트 통과를 확인한다.

#### Task D2: 자산 API

**Files:**
- `src/features/assets/server/repo.ts`
- `src/app/api/assets/upload/route.ts`, `src/app/api/assets/summary/route.ts`, `src/app/api/assets/accounts/route.ts`, `src/app/api/assets/accounts/[id]/route.ts`, `src/app/api/assets/accounts/[id]/txns/route.ts`, `src/app/api/assets/accounts/[id]/valuation/route.ts`, `src/app/api/assets/txns/[id]/route.ts`
- `src/features/assets/client.ts`
- 테스트 `src/features/assets/server/api.test.ts`

**Interfaces:**
- Produces:
  - `POST /api/assets/upload`(multipart `file`, 선택 `accountId`)
    - 성공: `{ account: BankAccount, inserted: number, skipped: number }`
    - 형식 오류: 422 `{message}`. 이때 어떤 행도 저장하지 않는다(트랜잭션).
    - 계좌를 특정하지 못하면: 409 `{ message:'어느 계좌의 거래내역인지 골라 주세요.', needsAccount:true }`
  - `GET /api/assets/summary` → `AssetsSummary`. flow는 이번 달(서울 기준)이다.
  - `GET /api/assets/accounts/[id]/txns?from&to` → `{ txns: Txn[] }`. 날짜 오름차순이다.
  - `POST /api/assets/accounts` `{kind,name}`: 투자계좌를 직접 만든다.
  - `PATCH /api/assets/accounts/[id]` `{name}`
  - `PUT /api/assets/accounts/[id]/valuation` `{amount}`
  - `PATCH /api/assets/txns/[id]` `{isTransfer}`. 직접 바꾼 값(transferOverridden)은 자동 판정이 덮어쓰지 않는다.
  - `client.ts`: 위 API를 하나씩 감싼 함수들
- 원본 파일은 저장하지 않는다.

**Steps:**
- [ ] 테스트를 쓴다.
  - `re-upload inserts 0`
  - `bad file stores nothing`
  - `older file uploaded later keeps latest balance`
  - `investment valuation sets balance and stale by enteredAt`
- [ ] 구현하고 테스트 통과를 확인한다.

#### Task D3: 자산 화면 (통장)

**Files:**
- `src/features/assets/AssetsPage.tsx`, `src/features/assets/Passbook.tsx`, `src/features/assets/UploadButton.tsx`
- `src/app/(app)/assets/page.tsx`
- 테스트 `src/features/assets/AssetsPage.test.tsx`

**표시 규칙:**
- 맨 위 문장은 계좌 수에 맞춰 "세 계좌를 합치면 23,480,000원이에요."처럼 쓴다. 계좌가 하나면 "모두 N원이에요."다.
- 계좌 고르기는 둥근 버튼으로 한다.
- 통장 면은 `--passbook` 바탕에 열 순서가 날짜 / 내용 / 찾으신 금액 / 맡기신 금액 / 잔액이다. 이체 행은 흐리게 하고 "이체" 표시를 붙인다. 행을 누르면 이체 여부를 토글한다.
- 흐름 문장: "11월에 3,200,000원 들어오고 984,400원 나갔어요. 내 계좌끼리 옮긴 500,000원은 뺐어요."
- 오래된 계좌는 `--sun` 색 문장으로 "투자계좌 금액은 18일 전에 입력했어요."를 쓰고, 옆에 "지금 금액 입력하기" 링크를 단다(`--sat`).
- "거래내역 엑셀 올리기" 버튼을 둔다. 데스크톱에서는 페이지에 파일을 끌어다 놓아도 올라간다. 409 needsAccount를 받으면 계좌를 고르는 시트를 띄운다.
- 계좌가 하나도 없으면 "신한 인터넷뱅킹에서 받은 거래내역 엑셀을 올리면 여기에 통장처럼 보여요."와 업로드 버튼을 보여준다.

**Steps:**
- [ ] 테스트를 쓴다.
  - `summary sentence for 3 accounts`
  - `transfer row muted with 이체`
  - `empty state shows upload`
- [ ] 구현하고 테스트 통과를 확인한다.

### Track E — 앱 틀 · 오늘 · 달력 · PWA · 알림

#### Task E1: 앱 틀 (탭 · 서랍 · 빠른 추가)

**Files:**
- `src/features/shell/{AppShell.tsx,BottomTabs.tsx,Drawer.tsx,QuickAdd.tsx,TodoSegment.tsx,useMediaQuery.ts}` (+ css)
- `src/app/(app)/layout.tsx`
- 테스트 `src/features/shell/AppShell.test.tsx`

**Interfaces:**
- Consumes: `createTodo`(B), `createEvent`(A)
- Produces: `<TodoSegment active="today|calendar|list" />`. 오늘 · 달력 · 목록 전환이며, 선택된 항목은 `.hl`로 표시한다.

**동작:**
- 900px 미만: 하단 탭(할 일 / 메모 / 자산)과 + 버튼을 둔다. 선택된 탭 이름은 `.hl`로 칠한다.
- 900px 이상: 상단 바에 ☰와 "새로 만들기 ⌘N"을 둔다.
  - 서랍은 본문을 덮고, 메뉴를 고르면 닫힌다.
  - "고정"을 누르면 사이드바로 붙는다. 고정 상태는 localStorage(try/catch)에 저장한다.
  - 서랍 아래쪽에 "거래내역 올리기"와 "설정"을 둔다.
- 단축키: ⌘\는 서랍 토글, ⌘N은 빠른 추가다.
- 빠른 추가 시트에서는 할 일과 일정 중 하나를 고르고 제목만 적으면 저장된다. 일정은 오늘 다음 정시부터 1시간으로 잡는다.

**Steps:**
- [ ] 테스트를 쓴다.
  - `narrow shows bottom tabs`
  - `wide shows drawer toggle and Cmd+Backslash toggles`
  - `quick add todo with title only calls createTodo`
- [ ] 구현하고 테스트 통과를 확인한다.

#### Task E2: 오늘 화면 (일력)

**Files:** `src/features/today/{TodayPage.tsx,DateLeaf.tsx,EventRow.tsx}` (+ css), `src/app/(app)/today/page.tsx`, 테스트 `src/features/today/DateLeaf.test.tsx`

**Interfaces:**
- Consumes: `fetchEvents`(A), `<TodoSection view="today"/>`(B), `<EventDetailSheet/>`(E3)

**표시 규칙:**
- `<DateLeaf date counts />` 구성
  - "2026 11월"과 요일을 쓴다. 요일과 큰 숫자의 색은 평일 `--ink`, 토요일 `--sat`, 일요일·공휴일 `--sun`이다. 공휴일 여부는 holiday 이벤트로 판단한다.
  - 큰 날짜는 Archivo 62% 폭, 굵기 800으로 쓴다. 크기는 모바일 120px, 데스크톱 210px이다.
  - 요약 문장은 "일정 2개, 할 일 4개 중 1개 끝냄"이다.
  - 아래에 점선(뜯는 자리)을 그린다.
- 일정 줄: 시간(`.num`), 제목, 장소(둘째 줄), Tag를 보여준다. 바쁨만 보이는 일정은 빗금 바탕에 "바쁨"이라고 쓴다. 메모가 있는 일정에는 "메모" 표시를 붙인다(`fetchEventKeys`).
- 화면을 좌우로 밀거나 ←→ 키를 누르면 날짜가 하루씩 바뀐다(`?date=`).
- 데스크톱은 3칸이다. 일력 한 장, 시간 막대(09–21시, 지금 시각은 `--sun` 선), 할 일 순서다.
- 일정이 하나도 없으면 "오늘은 일정이 없어요."를 보여준다. 개인 계정이 연결되지 않았으면 "Google 캘린더를 연결하면 일정이 여기에 보여요."와 설정 링크를 보여준다.

**Steps:**
- [ ] 테스트를 쓴다.
  - `saturday numeral uses sat color`
  - `sunday uses sun color`
  - `holiday weekday uses sun color`
  - `summary sentence`
- [ ] 구현하고 테스트 통과를 확인한다.

#### Task E3: 달력 · 일정 상세 시트

**Files:**
- `src/features/calendar/MonthGrid.tsx`, `src/features/calendar/EventDetailSheet.tsx`, `src/features/calendar/EventEditorSheet.tsx`, `src/features/calendar/CalendarPage.tsx`
- `src/app/(app)/calendar/page.tsx`
- 테스트 `src/features/calendar/MonthGrid.test.tsx`

`<EventEditorSheet open event? onClose />`는 개인 일정을 만들고 고치는 시트다. 항목은 제목, 날짜, 시작·종료 시간 또는 종일, 메모다. 저장은 `createEvent`와 `updateEvent`(A)로 한다. 빠른 추가에서 "자세히"를 누를 때도 이 시트를 연다.

**Interfaces:**
- Consumes: `fetchEvents`(A), `fetchTodos('all')`(B), `openEventMemo`, `fetchEventKeys`(C)
- Produces: `<EventDetailSheet event onClose />`

**표시 규칙:**
- 월 보기 상단에 "2026년"과 큰 "11월"(Archivo 62%)을 쓰고, 이전 달·다음 달 버튼을 둔다(aria-label 포함).
- 날짜 칸
  - 일요일 열은 `--sun`, 토요일 열은 `--sat`, 공휴일은 `--sun`이다.
  - 오늘은 `--marker` 동그라미로 표시한다.
  - 날짜 아래 표시: 회사 일정은 채운 점, 개인 일정은 테두리 점, 할 일 마감은 `--sun` 네모다. 표시는 최대 3개까지만 그린다.
- 날짜를 누르면 아래에 그날 일정 목록이 펼쳐진다.
- 일정 상세 시트
  - 제목, 시간, 장소, 참석자 수, Tag를 보여준다.
  - 회사 일정이면 "회사 일정은 읽기 전용이에요. 메모는 이 앱에만 저장돼요."를 보여준다.
  - 메모 버튼은 메모가 없으면 "메모 쓰기", 있으면 "메모 보기"다.
  - 반복 일정이면 "지난 회의 메모 보기"를 둔다. 직전 회차의 eventKey로 찾고, 없으면 버튼을 숨긴다.
  - 개인 일정이면 "수정"과 "삭제"를 둔다.
  - 바쁨만 보이는 일정은 제목을 "회사 일정"으로 보여준다.

**Steps:**
- [ ] 테스트를 쓴다.
  - `november 2026 starts on sunday column`
  - `today has marker class`
  - `work event sheet has no edit buttons`
  - `memo button label switches when key exists`
- [ ] 구현하고 테스트 통과를 확인한다.

#### Task E4: PWA · 웹 푸시 · cron · 설정

**Files:**
- 앱 메타: `src/app/manifest.ts`, `public/sw.js`, `public/icons/*`(종이 바탕에 잉크로 쓴 "14" 단색 아이콘, 192px와 512px)
- 알림: `src/features/notify/{server/send.ts,server/tick.ts,PushToggle.tsx,client.ts}`
- API: `src/app/api/push/subscribe/route.ts`, `src/app/api/cron/tick/route.ts`, `src/app/api/settings/reminders/route.ts`
- 화면: `src/app/(app)/settings/page.tsx`
- 테스트 `src/features/notify/server/tick.test.ts`

**Interfaces:**
- Produces:
  - `runTick(db, now: Date, send: (sub, payload) => Promise<'ok'|'gone'>): Promise<{ sent: number }>`
  - `POST /api/cron/tick`. `Authorization: Bearer ${CRON_SECRET}`가 없으면 401이다.
  - `POST|DELETE /api/push/subscribe`
  - `GET|PUT /api/settings/reminders`

**동작:**
- 알림 보내기
  - `fireAt <= now`이고 `sentAt is null`인 알림을 보낸 뒤 sentAt을 기록한다.
  - fireAt보다 6시간 넘게 지난 알림은 보내지 않고 sentAt만 기록한다. 서버가 오래 멈췄다 다시 켜졌을 때 알림이 한꺼번에 쏟아지는 것을 막기 위해서다.
  - 구독이 410·404를 돌려주면 그 구독을 삭제한다.
- 업로드 알림은 마지막 예정 시각(서울, 요일+시간)이 지났고 그 뒤로 보낸 적이 없으면 한 번 보낸다. 문구는 "신한 거래내역을 올릴 때예요", 이동할 곳은 `/assets`다.
- 할 일 알림은 제목이 할 일 이름이고, 본문은 "18:00까지" 또는 "오늘까지", 이동할 곳은 `/today`다.
- `sw.js`는 push 이벤트를 받으면 알림을 띄우고, notificationclick이면 해당 url로 이동하거나 이미 열린 창으로 포커스한다.
- 설정 화면 구성: `<ConnectionsSection/>`(A), 알림 켜기(아이폰이면 "홈 화면에 추가한 뒤 켤 수 있어요" 안내), 업로드 알림 요일·시간, 할 일 기본 알림(몇 분 전), 로그아웃.

**Steps:**
- [ ] 테스트를 쓴다.
  - `sends due todo notification once`
  - `skips notifications older than 6h`
  - `gone subscription is deleted`
  - `weekly upload reminder fires once after sunday 20:00 KST`. now `2026-11-15T11:05Z` → 보냄. 같은 시각에 한 번 더 실행하면 보내지 않음.
  - `tick requires bearer`
- [ ] 구현하고 테스트 통과를 확인한다.

---

## 통합 (병렬 트랙이 끝난 뒤 통합 담당)

- [ ] 각 트랙 보고에 적힌 스키마 변경 요청을 반영하고 마이그레이션을 다시 만든다.
- [ ] `npm run typecheck`, `npm test`, `npm run build`가 모두 통과할 때까지 트랙 사이의 이름 불일치를 고친다.
- [ ] `DEV_LOGIN=1 npm run dev`로 화면을 띄워 스크린샷을 찍고, `docs/superpowers/specs/mockups/2026-11-14-ilryeok-v2.html`과 비교한다.
- [ ] 전체 브랜치를 리뷰한다(superpowers:requesting-code-review).
