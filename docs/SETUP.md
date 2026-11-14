# 직접 설정해야 하는 것들

이 앱을 실제로 쓰려면 아래 계정 4개와 환경 변수 11개가 필요합니다. 순서대로 따라 하면 30~40분쯤 걸립니다.

| 서비스 | 쓰는 곳 | 비용 |
|---|---|---|
| Google Cloud | 로그인, 캘린더 연결 | 무료 |
| Supabase | 데이터베이스(서울 리전) | 무료 플랜 |
| Vercel | 앱 호스팅 | 무료(Hobby) |
| cron-job.org | 매분 알림 확인 | 무료 |

> 키를 넣기 전에도 로컬에서 화면은 볼 수 있어요. 맨 아래 [로컬에서 먼저 띄워 보기](#로컬에서-먼저-띄워-보기)를 참고하세요.

---

## 환경 변수 한눈에 보기

| 변수 | 무엇 | 어디서 얻나 |
|---|---|---|
| `APP_URL` | 앱 주소 | 로컬은 `http://localhost:3000`, 배포 후에는 Vercel 주소 |
| `ALLOWED_EMAIL` | 로그인을 허용할 이메일. **개인 Gmail**을 먼저 쓰고, 예비로 회사 메일을 쉼표로 이어 쓸 수 있어요 | 예: `me@gmail.com,me@company.com` |
| `AUTH_SECRET` | 로그인 쿠키 서명 키 | `openssl rand -base64 32` |
| `ENCRYPTION_KEY` | Google 토큰 암호화 키(32바이트) | `openssl rand -base64 32` |
| `CRON_SECRET` | 알림 예약 호출 비밀번호 | `openssl rand -base64 32` |
| `GOOGLE_CLIENT_ID` | Google OAuth 클라이언트 ID | [1단계](#1-google-cloud-로그인캘린더) |
| `GOOGLE_CLIENT_SECRET` | Google OAuth 클라이언트 비밀번호 | [1단계](#1-google-cloud-로그인캘린더) |
| `DATABASE_URL` | DB 연결 주소 | [2단계](#2-supabase-데이터베이스). 로컬은 `pglite:./.data/pglite` |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | 웹 푸시 공개키 | `npx web-push generate-vapid-keys` |
| `VAPID_PRIVATE_KEY` | 웹 푸시 비밀키 | 위 명령의 Private Key |
| `VAPID_SUBJECT` | 웹 푸시 연락처 | `mailto:본인이메일` |
| `DEV_LOGIN` | (선택, 로컬 전용) Google 없이 로그인 | 로컬에서만 `1`. **배포 환경에는 넣지 마세요** |

비밀값 세 개와 VAPID 키는 한 번에 만들 수 있어요.

```bash
echo "AUTH_SECRET=$(openssl rand -base64 32)"
echo "ENCRYPTION_KEY=$(openssl rand -base64 32)"
echo "CRON_SECRET=$(openssl rand -base64 32)"
npx web-push generate-vapid-keys
```

- 키 값은 `.env.local`(로컬)과 Vercel 환경 변수(배포)에만 넣으세요. git에는 올라가지 않아요.
- `ENCRYPTION_KEY`를 바꾸면 저장된 Google 연결이 풀려요. 그때는 설정에서 다시 연결하면 됩니다.

---

## 1. Google Cloud (로그인·캘린더)

1. [Google Cloud 콘솔](https://console.cloud.google.com/)에서 **개인 Google 계정**으로 새 프로젝트를 만들어요(예: `daily-routine`).
2. **API 및 서비스 → 라이브러리**에서 **Google Calendar API**를 사용 설정해요.
3. **API 및 서비스 → OAuth 동의 화면**에서 설정해요.
   - 사용자 유형은 **외부**로 고르세요.
   - 앱 이름은 아무거나(예: `데일리`), 지원 이메일과 개발자 연락처는 본인 이메일로 넣어요.
   - 범위(Scopes)에 아래 다섯 개를 추가해요.
     - `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`
     - `https://www.googleapis.com/auth/calendar.events`
     - `https://www.googleapis.com/auth/calendar.readonly`
   - 테스트 사용자에 **개인 이메일과 회사 이메일**을 넣어요.
4. **API 및 서비스 → 사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID**에서 만들어요.
   - 애플리케이션 유형은 **웹 애플리케이션**이에요.
   - 승인된 JavaScript 원본: `http://localhost:3000`. 배포 후에 Vercel 주소도 추가해요.
   - 승인된 리디렉션 URI(로컬과 배포 모두, 6개):
     - `http://localhost:3000/api/auth/callback/google`
     - `http://localhost:3000/api/connect/personal/callback`
     - `http://localhost:3000/api/connect/work/callback`
     - `https://<Vercel 주소>/api/auth/callback/google`
     - `https://<Vercel 주소>/api/connect/personal/callback`
     - `https://<Vercel 주소>/api/connect/work/callback`
   - 만들고 나면 나오는 값을 `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`에 넣어요.
5. **꼭 해야 하는 마무리:** OAuth 동의 화면에서 **"앱 게시"(프로덕션으로 전환)**를 눌러요.
   - "테스트" 상태로 두면 Google 연결이 **7일마다 끊겨요.**
   - 게시한 뒤 로그인할 때 "확인되지 않은 앱" 경고가 떠요. 혼자 쓰는 앱이라 정상이에요. **고급 → 이동**을 눌러 진행하면 돼요.

### 처음 로그인한 뒤 연결하기

로그인은 본인 확인만 해요. 캘린더는 로그인한 뒤 따로 연결해요.

1. **개인 Gmail**로 로그인해요.
2. **설정 → 개인 캘린더 연결하기**에서 같은 개인 Gmail 계정을 골라 캘린더 권한을 허용해요. 새 일정은 여기에 저장돼요.
3. **설정 → 회사 캘린더 연결하기**에서 회사 계정을 골라요. 읽기 권한만 요청해요.

회사 계정으로 직접 연결하면 회사 Google 관리자 화면에 이 앱이 연결된 앱으로 남아요. 원하지 않으면 아래 공유 방식을 쓰세요.

### 회사 캘린더 연결이 막혀 있을 때

앱의 **설정 → 회사 캘린더 연결하기**에서 "외부 앱 연결이 막혀 있어요"가 뜨면 아래처럼 해요.

1. **회사 계정**으로 Google 캘린더(웹)를 열어요.
2. 왼쪽 내 캘린더에서 본인 캘린더의 **설정 및 공유 → 특정 사용자 또는 그룹과 공유**로 가요.
3. **개인 이메일**을 추가해요. 권한은 "모든 일정 세부정보 보기"로 주세요. 회사 정책상 안 되면 "한가함/바쁨 정보만 보기"도 괜찮아요(일정이 "바쁨"으로만 보여요).
4. 개인 계정 메일함에 온 공유 초대를 수락해요.
5. 앱의 **설정 → 공유받은 캘린더에서 고르기**에서 회사 캘린더를 골라요.

---

## 2. Supabase (데이터베이스)

1. [Supabase](https://supabase.com/)에서 새 프로젝트를 만들어요.
   - Region은 **Northeast Asia (Seoul)**로 고르세요.
   - DB 비밀번호는 따로 적어 두세요.
2. 프로젝트 화면 맨 위의 **Connect** 버튼 → **Connection String** 탭 → **Transaction pooler**(포트 `6543`) 주소를 복사해요.
   형태는 `postgresql://postgres.<프로젝트ID>:[YOUR-PASSWORD]@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres`예요.
   `[YOUR-PASSWORD]` 자리에 DB 비밀번호를 넣은 값이 `DATABASE_URL`이에요. 비밀번호를 잊었으면 **Project Settings → Database → Reset database password**에서 새로 정해요.
   - `NEXT_PUBLIC_SUPABASE_URL`이나 publishable/anon 키는 이 앱에 **필요 없어요.** 서버가 Postgres에 직접 연결하기 때문이에요.
3. 테이블을 만들어요(처음 한 번, 그리고 앱을 업데이트해서 스키마가 바뀔 때마다).

   ```bash
   DATABASE_URL="<위 주소에서 포트만 5432로 바꾼 값>" npm run db:migrate
   ```

   테이블을 만들 때는 같은 주소의 **5432 포트(세션 모드)**를 쓰세요. 앱 자체는 6543 포트(트랜잭션 모드)로 연결해요. 연결은 항상 TLS로 암호화돼요.
   - 마이그레이션이 모든 테이블에 RLS(행 단위 보안)를 켜요. Supabase의 REST API로는 아무 데이터도 읽거나 쓸 수 없고, 앱은 테이블 소유자 계정으로 접속해서 영향이 없어요.

- 무료 플랜은 7일 동안 접속이 없으면 일시 정지돼요. 4단계의 cron이 매분 앱을 부르기 때문에 정지되지 않아요.

---

## 3. Vercel (배포)

1. 이 저장소를 본인 GitHub에 올려요(비공개 저장소 권장).
2. [Vercel](https://vercel.com/)에서 **Add New → Project**로 저장소를 가져와요.
3. **Environment Variables**에 위 표의 변수를 모두 넣어요. `DEV_LOGIN`은 빼요.
   `APP_URL`은 배포 후 받은 주소(예: `https://daily-routine-xxx.vercel.app`)로 바꾸고 다시 배포해요.
4. 1단계 4번의 Google 리디렉션 URI에 Vercel 주소를 추가했는지 확인해요.

---

## 4. cron-job.org (알림 예약)

할 일 마감 알림과 주간 업로드 알림은 서버가 매분 확인해서 보내요. Vercel 무료 플랜은 예약 작업을 하루 한 번만 돌릴 수 있어서, 외부 무료 서비스로 매분 깨워요.

1. [cron-job.org](https://cron-job.org/)에 가입하고 **Create cronjob**을 눌러요.
2. 아래처럼 설정하고 저장해요.
   - URL: `https://<Vercel 주소>/api/cron/tick`
   - Schedule: **Every minute**
   - Advanced → Request method는 **POST**
   - Advanced → Headers에 `Authorization` 헤더를 추가하고, 값은 `Bearer <CRON_SECRET 값>`으로 넣어요.
3. **Test run**을 눌러 응답이 `200`인지 확인해요. `401`이면 헤더 값이 틀린 거예요.

---

## 5. 아이폰에서 쓰기

1. 아이폰 **Safari**로 Vercel 주소를 열고 로그인해요.
2. 공유 버튼을 누르고 **홈 화면에 추가**를 골라요.
3. 홈 화면에 생긴 아이콘으로 앱을 열고 **설정 → 알림 켜기**를 눌러요.
   - iOS 16.4 이상이어야 하고, 홈 화면에 추가한 앱에서만 알림을 켤 수 있어요.

---

## 6. 신한 거래내역 엑셀

- 신한은행 인터넷뱅킹(PC)의 **거래내역 조회** 화면에서 기간을 정하고 **엑셀 저장**을 눌러 받아요.
- 앱의 **자산 → 거래내역 엑셀 올리기**로 올리거나, 맥에서는 파일을 창에 끌어다 놓으면 돼요. 기간이 겹쳐도 같은 거래가 두 번 잡히지 않아요.
- 파일은 4MB까지 올릴 수 있어요. 더 크면 조회 기간을 나눠서 받아 주세요.
- **처음 한 번 부탁드릴 것:** 입출금, 적금, 투자 계좌의 엑셀을 하나씩, 개인정보(이름, 계좌번호 일부, 거래 상대)를 가려서 주세요. 지금 엑셀 읽는 부분은 일반적인 신한 형식을 기준으로 만들었기 때문에, 실제 파일로 한 번 맞춰야 정확해져요.
  - 투자계좌가 신한은행 계좌인지 신한투자증권 계좌인지도 알려 주세요.

---

## 로컬에서 먼저 띄워 보기

키가 하나도 없어도 화면은 볼 수 있어요. 이 상태에서는 Google 캘린더와 알림이 동작하지 않아요.

```bash
cp .env.example .env.local
# .env.local에서 아래 세 줄만 채우면 됩니다
#   DEV_LOGIN=1
#   AUTH_SECRET=<openssl rand -base64 32 결과>
#   ENCRYPTION_KEY=<openssl rand -base64 32 결과>
npm install
npm run dev
```

브라우저에서 `http://localhost:3000`을 열고 **개발용 로그인**을 누르면 돼요. 데이터는 `./.data/pglite`에 저장돼요.

---

## 문제가 생기면

| 증상 | 확인할 것 |
|---|---|
| 로그인하면 "허용되지 않은 계정이에요" | 로그인한 이메일이 `ALLOWED_EMAIL`에 들어 있는지 확인하세요. 여러 개면 쉼표로 이어 써요. |
| "이 계정으로는 로그인할 수 없게 막혀 있어요" | 회사 계정이 외부 앱을 막은 거예요. 개인 Gmail로 로그인하세요. |
| 일정을 추가할 수 없어요 | 설정에서 개인 캘린더를 아직 연결하지 않았어요. **개인 캘린더 연결하기**를 눌러 주세요. |
| 일주일쯤 지나 캘린더 연결이 풀림 | OAuth 동의 화면이 아직 "테스트" 상태예요. 1단계 5번을 해 주세요. |
| 회사 일정이 "바쁨"으로만 보임 | 회사 캘린더 공유 권한이 "바쁨 정보만"이에요. 회사 정책이 허용하면 "모든 일정 세부정보"로 바꾸세요. |
| 알림이 안 옴 | 순서대로 확인하세요. ① 아이폰이면 홈 화면 앱에서 알림을 켰는지 ② cron-job.org Test run이 `200`인지 ③ 할 일의 알림이 켜져 있는지 |
| 엑셀을 올리면 "거래내역 표를 찾지 못했어요" | 신한 인터넷뱅킹 거래내역 화면에서 받은 엑셀인지 확인하고, 그래도 안 되면 개인정보를 가린 파일을 보내 주세요. |
