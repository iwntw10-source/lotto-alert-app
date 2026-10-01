# 로또 알림이 — 작업 안내

로또 6/45·연금복권 720+ 용지 QR 을 찍으면 저장해 두고, 추첨 후 당첨 여부를 알려 주는 안드로이드 앱. 패키지 `com.lottoalert.app`(스토어 게시 후 변경 불가).
이 파일은 PC·클라우드·NAS 어디서 작업하든 같은 맥락으로 시작하기 위한 것이다. 비밀 값(서명 키 비밀번호 등)은 절대 적지 말 것.

## 사용자와 일하는 방식
- **답은 항상 한국어로.** 사용자는 개발자가 아니다 — 쉬운 말로, 짧게.
- 사용자가 직접 해야 하는 일(콘솔 설정 등)은 **단계별 목록**으로.
- 작업 후 기본 흐름: versionCode 올려 **App Tester(Firebase App Distribution)** 배포.

## 구조
- Capacitor 8, 프레임워크 없음: `www/index.html` + `www/app.js`(화면) + `www/lotto.js`(순수 로직) + `www/config.js`(AdMob, 아직 테스트 ID).
- 플러그인: @capacitor-mlkit/barcode-scanning(촬영·갤러리 QR), @capacitor/camera, local-notifications, CapacitorHttp(CORS 우회), 네이티브 `LottoWorker`(WorkManager).
- `test/lotto.test.js` — `npm test`. 로직을 고치면 반드시 돌릴 것.
- 아이콘·스플래시·스토어 그래픽: `npm run assets` (`tools/make-assets.js`). 개인정보처리방침은 `docs/`(GitHub Pages).
- `docs/Play콘솔_등록_가이드.md` — Play Console 설문·스토어 등록정보 초안.

## 검증된 사실 (바꾸기 전에 다시 확인)
- 로또 QR: `...?v=<회차4자리>q<12자리>q...`
- 연금복권 QR: `http://qr.dhlottery.co.kr/?v=pd<3자리 접두><회차3자리><조1자리>s<번호6자리>` — 접두 3자리는 무시(값이 다양함).
- 당첨번호: `https://www.dhlottery.co.kr/lt645/selectPstLt645Info.do?srchLtEpsd=N`, 폴백 `https://smok95.github.io/lotto/results/N.json`.
- 회차: 로또 1회 = 2002-12-07 20:35 KST, +7일. 연금복권 333회 = 2026-09-17 19:05 KST(목), +7일. 결과는 추첨 후 ~30분 뒤.
- LocalNotifications 는 `isExactNotification:false` 고정(아니면 "알람 및 리마인더" 설정 화면으로 튕긴다).
- Play 스크린샷은 긴 변/짧은 변 2:1 이하 — 1080×2160 으로 크롭해 둠.

## 빌드 · 배포
```
export JAVA_HOME="/c/Users/jski1/.jdks/jbr-21.0.11"
npx cap sync android && cd android && ./gradlew assembleRelease     # Play 용은 bundleRelease (서명은 android/keystore.properties — 내용 기록 금지)
firebase appdistribution:distribute app/build/outputs/apk/release/app-release.apk --app 1:908127218945:android:6245a88b5bcabdfb903f00 --groups testers --project health-timeline-5854a --release-notes "<한국어>"
```
- versionCode 는 `android/app/build.gradle`. "앱 테스터"는 Firebase App Distribution 이다(Play Console 과 무관).

## 사용자가 아직 해야 하는 일
- 사업자등록 완료 → Play Console 조직 계정 → AAB 업로드·스토어 등록정보(가이드 참고) → 심사.
- AdMob 실제 광고 단위 ID 로 `www/config.js` 교체.
- 아이폰은 보류(우선순위 낮음, WorkManager 대체가 필요).
