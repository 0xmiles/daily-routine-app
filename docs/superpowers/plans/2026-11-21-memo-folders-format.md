# 메모 폴더 · 제목과 구분선 · 보기 설정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 메모에 한 단계 폴더와 폴더 색, `#`/`##`/`###` 제목과 `---` 구분선, 기기별 글씨 크기, 넓은 화면의 목록 여닫기, 메모 끝 빈 공간을 더한다.

**Architecture:** `memo_folders` 테이블과 `memo_blocks.folder_id`·`hue` 칸(마이그레이션 0003). 폴더·색 변경은 본문 `version`을 건드리지 않는 별도 PATCH로 보낸다. `MemoPad`가 폴더 목록과 배치 변경을 함께 들고, 화면은 순수 함수(`folders.ts`)로 목록을 묶는다. 제목·구분선은 기존 굵게·안내선처럼 CodeMirror 꾸밈으로 그린다.

**Tech Stack:** Next.js 16.4 route handlers, Drizzle + Postgres/PGlite, zod 4, React 19, CodeMirror 6, vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-21-memo-folders-format-design.md`

## Global Constraints

- 본문은 평문 그대로 저장한다(`**`, `# `, `---`). 표시만 편집기가 바꾼다.
- 폴더 이름: 앞뒤 공백 제거 후 1~40자, 중복 허용.
- 색은 `HUES`(`src/ui/hues.ts`) 일곱 개만. 색 위 글자는 `--on-index`.
- 폴더·색 변경(PATCH, 폴더 삭제)은 `memo_blocks.version`과 `updated_at`을 바꾸지 않는다.
- 폴더 삭제: 안의 메모는 폴더 밖으로, `hue`가 비어 있던 메모에는 폴더 색을 같은 트랜잭션에서 옮겨 적는다.
- 없는 `folderId`로 메모를 만들면(POST) 폴더 밖에 만든다. PATCH에서는 400.
- 폴더 작업·옮기기·색 바꾸기는 낙관적으로 반영하고, 실패하면 되돌리고 안내한다. 재전송 큐 없음.
- 글씨 배율 `[0.875, 1, 1.125, 1.25, 1.375]`. 900px 미만 또는 `(pointer: coarse)`면 1 미만 금지.
- 기기 설정 키(`readPref`/`writePref`): `memo.listOpen`(기본 true), `memo.fontScale`(기본 1), `memo.closedFolders`(기본 []).
- 목록 여닫기 단축키 ⌥⌘S(`e.code === "KeyS"`), 900px 이상에서만. ⌘\는 앱 메뉴가 쓴다.
- 오류·안내 문구는 지금처럼 한국어 해요체.
- 새 패키지 없음.

## Review Focus

1. 기기에 보관해 둔 새 메모(`id` 없음)가 폴더 안에서 만들어졌는데, 서버로 가기 전에 그 폴더가 지워짐 → 글은 폴더 밖 메모로 저장된다. (Task 1 API 테스트, Task 2 store 테스트)
2. 메모를 옮긴 직후 다른 기기의 옛 `baseVersion`으로 본문 저장 → 409 없이 저장된다. (Task 1)
3. 본문이 저장 대기 중(`pending`)인 메모를 다시 불러옴 → 폴더·색은 서버 값, 본문은 기기 값. (Task 2)
4. `###제목`(띄어쓰기 없음), `####`, 들여쓴 `# `, `- --`, `--` → 제목/구분선이 아니다. (Task 3)
5. 검색어가 있을 때 닫아 둔 폴더 안의 맞는 메모 → 폴더가 펼쳐져 보이고 Enter로 열린다. (Task 4)

---

### Task 1: DB · 계약 · 서버 API

**Files:**
- Modify: `src/server/db/schema.ts` (`memoFolders` 테이블, `memoBlocks.folderId`·`hue`, 행 타입)
- Create: `drizzle/0003_memo_folders.sql`, `drizzle/meta/0003_snapshot.json`, `drizzle/meta/_journal.json` 항목 (`npm run db:generate`로 만들고, RLS 줄을 손으로 더한다)
- Modify: `src/shared/contracts.ts` (`MemoBlock`에 `folderId`, `hue`; `MemoFolder`)
- Modify: `src/ui/hues.ts` (`isHue`, `nextFolderHue`)
- Modify: `src/features/memo/server/repo.ts` (`toMemoBlock`, `createBlock`, `setPlacement`, 스키마)
- Create: `src/features/memo/server/folders.ts` (폴더 repo)
- Modify: `src/app/api/memo/blocks/route.ts` (GET에 `folders`), `src/app/api/memo/blocks/[id]/route.ts` (PATCH)
- Create: `src/app/api/memo/folders/route.ts` (POST), `src/app/api/memo/folders/[id]/route.ts` (PATCH, DELETE)
- Test: `src/features/memo/server/api.test.ts`, `src/ui/hues.test.ts`

**Interfaces:**
- Produces:
  - `MemoBlock { …, folderId: string | null; hue: Hue | null }`, `MemoFolder { id; name; hue: Hue; createdAt; updatedAt }` (`@/shared/contracts`, `Hue`는 `@/ui/hues`에서 type import)
  - `isHue(v: unknown): v is Hue`, `nextFolderHue(used: readonly Hue[]): Hue` — 안 쓴 색을 `HUES` 순서로, 다 쓰였으면 가장 적게 쓰인 색(동률이면 `HUES` 순서 앞).
  - `GET /api/memo/blocks` → `{ blocks: MemoBlock[]; folders: MemoFolder[] }`
  - `POST /api/memo/blocks` body에 `folderId?: string | null`, `hue?: Hue | null`
  - `PATCH /api/memo/blocks/[id]` `{ folderId?: string | null; hue?: Hue | null }` → 200 `MemoBlock` | 400 | 404
  - `POST /api/memo/folders` `{ name; hue? }` → 201 `MemoFolder`; `PATCH /api/memo/folders/[id]` `{ name?; hue? }` → 200 | 404; `DELETE /api/memo/folders/[id]` → 204 | 404

- [ ] **Step 1: 실패하는 테스트를 쓴다** (`api.test.ts`에 `describe("folders")`)
  - `creates a folder with the first unused hue` — 두 번 만들면 `hue`가 `"pink"`, `"lilac"`; `GET /blocks`의 `folders` 길이 2.
  - `trims folder names and rejects empty or over 40 chars` — `"  회사 "` → `"회사"`, `""`·41자 → 400.
  - `moves a memo without touching version or updatedAt` — PATCH `{ folderId }` 후 `version`·`updatedAt` 그대로, 이어서 옛 `baseVersion`으로 PUT → 200.
  - `rejects moving into a missing folder` — 400. 없는 메모 → 404.
  - `creates a memo with a deleted folderId outside any folder` — `folderId: null`로 201.
  - `deleting a folder keeps its memos and their colour` — 메모 2개(하나는 `hue: "sky"`) 넣고 폴더 삭제 → 둘 다 남고 `folderId: null`, 색 없던 메모의 `hue`는 폴더 색, 다른 하나는 `"sky"`, 둘 다 `version` 그대로.
  - `hues.test.ts`: `nextFolderHue([])` = `"pink"`, 일곱 개 다 쓰고 `"pink"` 두 번이면 `"lilac"`.
- [ ] **Step 2:** `npx vitest run src/features/memo/server/api.test.ts src/ui/hues.test.ts` → FAIL
- [ ] **Step 3:** 스키마·마이그레이션·repo·라우트를 구현한다. `folder_id`는 `references(() => memoFolders.id, { onDelete: "set null" })`. 폴더 삭제는 `db.transaction`에서 `UPDATE memo_blocks SET hue = <폴더 hue> WHERE folder_id = id AND hue IS NULL` 다음 폴더 DELETE. 라우트는 `withUser`·`readBody`·`json`/`problem`. 오류 문구 예: `"폴더를 찾지 못했어요. 다른 기기에서 지웠을 수 있으니 새로고침해 주세요."`
- [ ] **Step 4:** 같은 명령 → PASS. `npm run typecheck`도 통과(다른 곳의 `MemoBlock` 사용처는 테스트 픽스처에 `folderId: null, hue: null` 추가).
- [ ] **Step 5: Commit** — `메모 폴더와 색 저장: memo_folders 테이블, 배치 PATCH, 폴더 API`

### Task 2: 클라이언트 API와 MemoPad 상태

**Files:**
- Modify: `src/features/memo/client.ts`, `src/features/memo/store.ts`, `src/features/memo/draft.ts`
- Test: `src/features/memo/store.test.ts`, `src/features/memo/client.test.ts`

**Interfaces:**
- Consumes: Task 1의 API와 타입.
- Produces:
  - client: `fetchMemos(): Promise<{ blocks: MemoBlock[]; folders: MemoFolder[] }>` (기존 `fetchBlocks`는 이것의 `blocks`), `createBlock({ content?, eventRef?, folderId?, hue? })`, `placeBlock(id, { folderId?, hue? }): Promise<MemoBlock>`, `createFolder(name, hue?)`, `updateFolder(id, { name?, hue? })`, `deleteFolder(id)`.
  - `MemoApi`에 위 함수들. `PadBlock`에 `folderId: string | null; hue: Hue | null`. `PadState`에 `folders: MemoFolder[]`, `PadNotice`에 `{ kind: "placementFailed"; message: string }`.
  - `MemoPad.addBlock(content = "", folderId: string | null = null): string`
  - `MemoPad.place(key, { folderId?, hue? }): Promise<void>` — `id`가 없으면 기기 값만 바꾼다.
  - `MemoPad.createFolder(name): Promise<MemoFolder | null>`, `renameFolder(id, name)`, `recolorFolder(id, hue)`, `deleteFolder(id)` — 모두 `Promise<void>`, 실패 시 되돌리고 `placementFailed` 안내.
  - `MemoDraft`에 `folderId?: string | null; hue?: Hue | null` (v1 키 그대로, 없으면 null).
- [ ] **Step 1: 실패하는 테스트** (`store.test.ts`)
  - `loads folders with the blocks`
  - `server folder and hue win on reload even while text is pending`
  - `a new memo made in a folder is created with that folderId`
  - `placing a memo that is not on the server yet sends it with the create`
  - `a failed move is undone with a notice` — `placeBlock`가 `TypeError` → `folderId` 원래대로, `notice.kind === "placementFailed"`.
  - `conflict copy keeps the folder and hue`
  - `a draft of a never-saved memo restores its folder` — `writeDraft`에 `folderId` 넣고 로드 → `createBlock` 호출 인자에 `folderId`.
  - `deleting a folder moves its memos out and keeps their colour on screen`
- [ ] **Step 2:** `npx vitest run src/features/memo/store.test.ts` → FAIL
- [ ] **Step 3:** 구현. `merge`는 `folderId`·`hue`를 늘 서버 값으로. `resolveConflict`·404 복구·`restoreDrafts`는 `folderId`/`hue`를 이어받는다. `persist`가 두 값을 보관한다.
- [ ] **Step 4:** → PASS
- [ ] **Step 5: Commit** — `메모 상태에 폴더와 배치 변경: 낙관적 반영, 실패 시 되돌리기`

### Task 3: 제목 · 구분선 · 이름과 미리보기

**Files:**
- Create: `src/features/memo/editor/heading.ts`, `src/features/memo/editor/rule.ts`
- Modify: `src/features/memo/editor/index.ts` (확장 등록, 테마, export), `src/features/memo/format.ts` (`plainLine`)
- Test: `src/features/memo/editor/editor.test.ts`, `src/features/memo/format.test.ts`

**Interfaces:**
- Produces:
  - `headingLevel(lineText: string): 0 | 1 | 2 | 3` — `/^(#{1,3})[ \t]+/` (들여쓰기 없음, 글 없어도 됨).
  - `isRuleLine(lineText: string): boolean` — `/^-{3,}[ \t]*$/`.
  - `cycleHeading: StateCommand` — 커서 줄을 보통 → `# ` → `## ` → `### ` → 보통. 들여쓰기·글머리(`listMarker`)는 떼고 제목으로.
  - 클래스: 줄 `cm-memo-h1|h2|h3`, 기호 `cm-memo-mark`(연필색), 구분선 줄 `cm-memo-rule`, 선 위젯 `cm-memo-hr`.
- [ ] **Step 1: 실패하는 테스트**
  - `headingLevel`: `"# a"`→1, `"### a"`→3, `"#### a"`→0, `"###a"`→0, `"  # a"`→0, `"# "`→1.
  - `isRuleLine`: `"---"`, `"-----  "` → true; `"--"`, `"- --"`, `"  ---"`, `"--- a"` → false.
  - `cycleHeading`: `"할 일|"` → `"# 할 일|"` → `"## 할 일|"` → `"### 할 일|"` → `"할 일|"`; `"  - 항목|"` → `"# 항목|"`.
  - 뷰 테스트: 커서가 다른 줄이면 `# ` 숨김(`.cm-memo-mark` 없음, `.cm-memo-h1` 있음), 커서가 그 줄이면 `.cm-memo-mark` 보임. `---` 줄은 커서가 없으면 `.cm-memo-hr`, 있으면 `---` 글자.
  - Enter at end of `"# 제목|"` → `"# 제목\n|"`.
  - `plainLine("## 회의")` = `"회의"`, `plainLine("---")` = `""`; `memoTitle({ content: "---\n# 이름\n본문" })` = `"이름"`.
- [ ] **Step 2:** `npx vitest run src/features/memo/editor src/features/memo/format.test.ts` → FAIL
- [ ] **Step 3:** `ViewPlugin`로 보이는 줄마다 꾸밈을 만든다. 선택이 걸친 줄 번호 집합을 구해 그 줄은 기호를 `Decoration.mark(cm-memo-mark)`, 아니면 `Decoration.replace({})`(atomic 아님). `selectionSet`에도 다시 그린다. 크기: h1 `1.4em`, h2 `1.2em`, h3 `1.08em`, 모두 700, `padding-top: 0.3em`. 이름 줄(`cm-memo-title`)이 우선하도록 테마에서 `.cm-memo-title.cm-memo-h1` 등은 이름 크기 유지.
- [ ] **Step 4:** → PASS
- [ ] **Step 5: Commit** — `메모 편집기에 # 제목과 --- 구분선`

### Task 4: 폴더 목록 화면

**Files:**
- Create: `src/features/memo/folders.ts` (순수 함수), `src/features/memo/folders.test.ts`
- Create: `src/features/memo/MemoList.tsx` (목록 렌더링을 `MemoPage`에서 옮김), `src/features/memo/FolderSheets.tsx` (새 폴더, 폴더 메뉴: 이름·색·지우기)
- Create: `src/features/memo/viewPrefs.ts` (`useMemoPrefs`)
- Modify: `src/features/memo/MemoPage.tsx`, `MemoPage.module.css`, `icons.tsx` (`FolderIcon`, `FolderPlusIcon`, `ChevronIcon`, `MoreIcon`)
- Test: `src/features/memo/MemoPage.test.tsx`

**Interfaces:**
- Consumes: Task 2의 `MemoPad` 메서드와 `PadState.folders`.
- Produces:
  - `memoHue(block: PadBlock, folders: MemoFolder[]): Hue` — `block.hue ?? folder?.hue ?? hueFor(block.id ?? block.key)`.
  - `groupMemos(blocks, folders, opts: { query: string; closed: ReadonlySet<string> }): { folders: Array<{ folder: MemoFolder; open: boolean; memos: PadBlock[] }>; loose: PadBlock[] }` — 폴더 `name.localeCompare(…, "ko")`, 검색어가 있으면 맞는 메모가 없는 폴더는 빼고 나머지는 `open: true`.
  - `flatVisible(groups): PadBlock[]` — 화면 순서(Enter가 여는 첫 메모).
  - `useMemoPrefs(): { listOpen; setListOpen; fontScale; setFontScale; closedFolders: ReadonlySet<string>; toggleFolder(id) }`.
- [ ] **Step 1: 실패하는 테스트**
  - `folders.test.ts`: 정렬(가나다), 검색 시 닫힌 폴더 펼침·빈 폴더 숨김, `memoHue` 세 경우.
  - `MemoPage.test.tsx`: `shows folders above loose memos and toggles a folder`, `+ on a folder row creates the memo in that folder`(POST body `folderId`), `deleting a folder asks first and keeps its memos`(확인 문구 `‘회사’ 폴더를 지울까요?`, 메모 수 문장), `search opens a closed folder that has a match`.
- [ ] **Step 2:** `npx vitest run src/features/memo/folders.test.ts src/features/memo/MemoPage.test.tsx` → FAIL
- [ ] **Step 3:** 구현. 폴더 줄: 버튼(▸/▾ + 색 점 + 이름, `aria-expanded`), `…`(`aria-label="‘회사’ 폴더 메뉴"`), `＋`(`aria-label="‘회사’ 폴더에 새 메모"`). 목록 머리 `📁＋`(`aria-label="새 폴더"`). 빈 폴더 "메모가 없어요". 안내 문구는 `placementFailed` notice로.
- [ ] **Step 4:** → PASS
- [ ] **Step 5: Commit** — `메모 목록에 폴더: 여닫기, 폴더 안에 새 메모, 이름·색·지우기`

### Task 5: 메모 머리 막대 · 글씨 크기 · 목록 여닫기 · 빈 공간 · 제목 버튼

**Files:**
- Create: `src/features/memo/PlacementSheet.tsx` ("폴더와 색"), `src/features/memo/FontSizeSheet.tsx`
- Modify: `src/features/memo/MemoPage.tsx`, `MemoPage.module.css`, `MobileToolbar.tsx`, `icons.tsx` (`SidebarIcon`, `HeadingIcon`)
- Test: `src/features/memo/MemoPage.test.tsx`

**Interfaces:**
- Consumes: Task 2 `MemoPad.place`, Task 3 `cycleHeading`, Task 4 `useMemoPrefs`, `memoHue`.
- Produces:
  - `FONT_SCALES = [0.875, 1, 1.125, 1.25, 1.375] as const`, `clampFontScale(scale: number, touchOrNarrow: boolean): number` (`viewPrefs.ts`).
  - `.page`에 `--memo-scale`, `.editor { font-size: calc(<기준> * var(--memo-scale)) }`. `.page[data-list="closed"]`이면 그리드 한 칸.
  - `MobileToolbarProps.onHeading(): void`.
- [ ] **Step 1: 실패하는 테스트**
  - `the folder chip moves a memo` — 칩(`aria-label="폴더와 색: 회사"`) → Sheet → "개인" → `PATCH` body `{ folderId }`.
  - `picking a colour sends hue, and 폴더 색 따르기 sends null`.
  - `Alt+Cmd+S folds the list on wide screens and remembers it` — `localStorage["daily:memo.listOpen"] === "false"`, 재렌더 후에도 접힘; 휴대폰에선 무시.
  - `Cmd+F while folded opens the list`.
  - `font size steps below 1 are not offered on phones` / `font scale is stored per device`.
  - `clicking the space under the memo puts the cursor at the end`.
  - `the toolbar 제목 button cycles the heading`.
- [ ] **Step 2:** `npx vitest run src/features/memo/MemoPage.test.tsx` → FAIL
- [ ] **Step 3:** 구현. 빈 공간: `.doc` `padding-bottom: max(50dvh, 160px)`, `.doc`의 `onMouseDown`에서 대상이 편집기 밖이고 편집기 아래면 `handle.focus("end")`.
- [ ] **Step 4:** → PASS
- [ ] **Step 5: Commit** — `메모 머리 막대: 폴더와 색, 글씨 크기, 목록 여닫기(⌥⌘S), 끝 여백, 제목 버튼`

### Task 6: 문서 · 전체 점검 · 마이그레이션 · push

**Files:**
- Modify: `docs/superpowers/specs/2026-11-14-daily-routine-app-design.md` (§11 개정 요약 + 링크)

- [ ] **Step 1:** §11을 쓴다(§5.3 "이 밖의 서식은 없다", §9.1 "폴더는 이번에 넣지 않는다"를 고쳤다고 적고 새 설계 문서 링크).
- [ ] **Step 2:** `npm run typecheck && npm run lint && npm test && npm run build` → 모두 0으로 끝난다.
- [ ] **Step 3:** 운영 DB(Supabase, 5432 세션 모드)에 `npm run db:migrate`. 0003은 테이블·칸 추가뿐이라 지금 배포된 코드와도 맞는다. 그래서 push보다 먼저 돌린다.
- [ ] **Step 4: Commit 후 `git push origin feat/initial-app`** — 기본 브랜치라 Vercel이 배포한다. 커밋 상태의 Vercel 확인이 `success`인지 본다.
