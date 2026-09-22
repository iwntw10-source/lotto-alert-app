package com.lottoalert.app;

import android.Manifest;
import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.work.Constraints;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.NumberFormat;
import java.util.Calendar;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.TimeUnit;

/**
 * 추첨 당일 밤에 앱이 꺼져 있어도 당첨번호를 조회해 내 복권과 비교하고 결과 알림을 띄운다.
 * 실행 시각은 "추첨 35분 뒤"(토 21:10 KST)를 벽시계로 계산하는 1회성 작업을 매주 자기 자신이 다시 예약하는 방식이다.
 * (PeriodicWork는 실행이 밀리면 시각이 조금씩 어긋나서 쓰지 않음)
 */
public class LottoWorker extends Worker {
    static final String UNIQUE = "lotto-weekly";
    static final String PREFS = "lotto_bg";
    static final String CHANNEL = "lotto_result";
    static final String KEY_FORCE = "force";
    private static final int NOTI_ID = 2001;
    private static final String TAG = "LottoWorker";

    private static final long WEEK = 7L * 24 * 3600 * 1000;
    private static final long PUBLISH_DELAY = 30L * 60 * 1000; // 결과 조회 가능 시점 (JS의 lotto.js와 동일)
    private static final long RUN_DELAY = 35L * 60 * 1000;     // 워커 실행 시점 = 추첨 + 35분
    private static final long RETRY_MS = 10L * 60 * 1000;
    private static final long RETRY_SLOW_MS = 30L * 60 * 1000; // 추첨 2시간 뒤부터는 30분 간격
    private static final long GIVE_UP_MS = 12L * 3600 * 1000;  // 밤새 절전이어도 아침까지는 계속 시도
    private static final long JOB_LAG_MS = 3L * 60 * 1000;     // 백업 작업은 알람보다 3분 늦게
    private static final int ALARM_REQUEST = 3001;

    private static final String PRIMARY = "https://www.dhlottery.co.kr/lt645/selectPstLt645Info.do?srchLtEpsd=";
    private static final String MIRROR = "https://smok95.github.io/lotto/results/";
    private static final String UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";

    public LottoWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    // ---- 회차/시각 계산 (1회 = 2002-12-07 20:35 KST = 11:35 UTC) ----
    private static long firstDrawMs() {
        Calendar c = Calendar.getInstance(TimeZone.getTimeZone("UTC"));
        c.clear();
        c.set(2002, Calendar.DECEMBER, 7, 11, 35, 0);
        return c.getTimeInMillis();
    }

    static long drawTime(int drawNo) {
        return firstDrawMs() + (drawNo - 1) * WEEK;
    }

    static int latestDrawNo(long now) {
        return (int) (Math.floorDiv(now - firstDrawMs() - PUBLISH_DELAY, WEEK) + 1);
    }

    /** 지금 이후 가장 가까운 "추첨 + 35분"까지 남은 시간 */
    static long delayUntilNextRun(long now) {
        long n = Math.floorDiv(now - firstDrawMs() - RUN_DELAY, WEEK) + 2; // 회차
        return drawTime((int) n) + RUN_DELAY - now;
    }

    // ---- 예약 ----
    // 두 갈래로 예약한다: (1) WorkManager 작업 (재부팅에도 유지), (2) 절전(Doze) 중에도 깨워주는 알람.
    // Doze 중에는 작업이 제시간에 실행돼도 네트워크가 막혀 조회가 실패하는 것을 에뮬레이터에서 확인했다.
    // 알람은 울린 직후 짧게 네트워크 사용이 허용된다. 먼저 성공한 쪽이 알리고, last_notified로 중복을 막는다.
    // 알람이 먼저(T), 작업은 3분 뒤(T+3분): 같은 시각이면 작업이 먼저 실패하고 다음 예약으로 알람을 덮어써 버린다.
    // 알람이 성공하면 그 실행이 다음 주를 예약하면서(REPLACE) 대기 중인 작업도 함께 교체한다.
    static void scheduleAll(Context ctx, long delayMs, ExistingWorkPolicy policy) {
        OneTimeWorkRequest req = new OneTimeWorkRequest.Builder(LottoWorker.class)
                .setInitialDelay(Math.max(delayMs, 0) + JOB_LAG_MS, TimeUnit.MILLISECONDS)
                .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build();
        WorkManager.getInstance(ctx).enqueueUniqueWork(UNIQUE, policy, req);
        setAlarm(ctx, delayMs);
    }

    private static PendingIntent alarmIntent(Context ctx) {
        return PendingIntent.getBroadcast(ctx, ALARM_REQUEST, new Intent(ctx, LottoAlarmReceiver.class),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static int bootCount(Context ctx) {
        return Settings.Global.getInt(ctx.getContentResolver(), Settings.Global.BOOT_COUNT, 0);
    }

    private static void setAlarm(Context ctx, long delayMs) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        long at = System.currentTimeMillis() + Math.max(delayMs, 0);
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, alarmIntent(ctx)); // 정확한 알람 권한이 필요 없는 방식
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putLong("alarm_at", at).putInt("alarm_boot", bootCount(ctx)).apply();
    }

    /** 앱 실행 때마다 호출: 이미 예약돼 있으면(재시도 중 포함) 그대로 둔다 */
    static void ensureScheduled(Context ctx) {
        long now = System.currentTimeMillis();
        long next = delayUntilNextRun(now);
        OneTimeWorkRequest req = new OneTimeWorkRequest.Builder(LottoWorker.class)
                .setInitialDelay(next + JOB_LAG_MS, TimeUnit.MILLISECONDS)
                .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build();
        WorkManager.getInstance(ctx).enqueueUniqueWork(UNIQUE, ExistingWorkPolicy.KEEP, req);
        // 알람은 재부팅하면 사라진다. 아직 유효한지(시각이 미래 & 부팅 횟수 동일) 확인해서 없을 때만 다시 건다 (재시도 알람을 덮어쓰지 않도록)
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (sp.getLong("alarm_at", 0) <= now || sp.getInt("alarm_boot", -1) != bootCount(ctx)) setAlarm(ctx, next);
    }

    static void cancel(Context ctx) {
        WorkManager.getInstance(ctx).cancelUniqueWork(UNIQUE);
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(alarmIntent(ctx));
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove("alarm_at").apply();
    }

    // ---- 작업 본체 ----
    @NonNull
    @Override
    public Result doWork() {
        // 디버그: force면 알림 여부/시각을 무시하고 최신 회차로 실행
        execute(getApplicationContext(), getInputData().getBoolean(KEY_FORCE, false), "work");
        return Result.success();
    }

    /** WorkManager 작업과 알람 수신기가 함께 쓰는 본체. 동시에 오면 차례로 실행해 중복 알림을 막는다. */
    /** 디버그 빌드에서만 테스트용 값(시간 이동, 재시도 간격)을 읽는다. 릴리스 빌드에서는 항상 기본값. */
    private static long dbg(Context ctx, String key, long def) {
        if ((ctx.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) == 0) return def;
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(key, def);
    }

    private static long nowMs(Context ctx) {
        return System.currentTimeMillis() + dbg(ctx, "debug_now_offset", 0);
    }

    static synchronized void execute(Context ctx, boolean force, String src) {
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        long now = nowMs(ctx);

        if (!force && !sp.getBoolean("notify", true)) return; // 알림 꺼짐: 체인 종료 (켜면 다시 예약)

        try {
            int latest = latestDrawNo(now);
            int lastNotified = sp.getInt("last_notified", 0);
            JSONArray tickets = new JSONArray(sp.getString("tickets", "[]"));

            // 결과가 나왔고 아직 알리지 않은 회차 중, 등록된 복권이 있는 가장 최근 회차
            int target = 0;
            for (int i = 0; i < tickets.length(); i++) {
                int d = tickets.getJSONObject(i).getInt("drawNo");
                if (d <= latest && (force || d > lastNotified) && d > target) target = d;
            }

            Log.d(TAG, "run src=" + src + " force=" + force + " latest=" + latest + " lastNotified=" + lastNotified + " target=" + target);
            if (target > 0) {
                Draw draw = null;
                boolean fetchFailed = false;
                try {
                    draw = fetchDraw(target);
                } catch (IOException e) {
                    fetchFailed = true;
                    Log.d(TAG, "fetch failed: " + e);
                }
                if (draw == null) {
                    Log.d(TAG, "no result (failed=" + fetchFailed + ") sinceDraw=" + (now - drawTime(target)) / 60000 + "min");
                    // 아직 발표 전이거나 조회 실패: 추첨 후 12시간까지 재시도 (처음 2시간은 10분, 이후 30분 간격)
                    long since = now - drawTime(target);
                    if (!force && since < GIVE_UP_MS) {
                        scheduleAll(ctx, since < 2L * 3600 * 1000 ? dbg(ctx, "debug_retry_ms", RETRY_MS) : RETRY_SLOW_MS, ExistingWorkPolicy.REPLACE);
                        return;
                    }
                    // 포기하고 다음 주로 (알림 없이). 앱을 열면 앱 안에서 확인할 수 있다.
                } else {
                    notifyResult(ctx, target, draw, tickets);
                    sp.edit().putInt("last_notified", target).apply();
                    Log.d(TAG, "notified draw " + target);
                }
            }
        } catch (Exception ignored) {
            // 저장 데이터 파싱 오류 등: 이번 주는 건너뛰고 다음 주 예약
        }

        if (!force) {
            long next = delayUntilNextRun(nowMs(ctx));
            scheduleAll(ctx, next, ExistingWorkPolicy.REPLACE);
            Log.d(TAG, "rescheduled in " + next / 60000 + " min");
        }
    }

    // ---- 판정/알림 ----
    private static void notifyResult(Context ctx, int drawNo, Draw draw, JSONArray tickets) throws Exception {
        int games = 0, wins = 0, best = 9;
        long total = 0;
        for (int i = 0; i < tickets.length(); i++) {
            JSONObject t = tickets.getJSONObject(i);
            if (t.getInt("drawNo") != drawNo) continue;
            JSONArray gs = t.getJSONArray("games");
            for (int g = 0; g < gs.length(); g++) {
                games++;
                int rank = rankOf(gs.getJSONArray(g), draw);
                if (rank > 0) {
                    wins++;
                    best = Math.min(best, rank);
                    total += draw.prize(rank);
                }
            }
        }
        if (games == 0) return;

        String title, body;
        if (wins > 0) {
            title = "🎉 제" + drawNo + "회 " + best + "등 당첨!";
            body = (total > 0 ? "총 " + won(total) + " · " : "") + games + "게임 중 " + wins + "게임 당첨 · 눌러서 확인하세요";
        } else {
            title = "제" + drawNo + "회 결과: 아쉽게 낙첨";
            body = "등록한 " + games + "게임이 모두 낙첨이에요. 다음 추첨은 토요일 20:35!";
        }
        post(ctx, title, body);
    }

    private static int rankOf(JSONArray game, Draw draw) throws Exception {
        int hit = 0;
        boolean bonus = false;
        for (int i = 0; i < game.length(); i++) {
            int n = game.getInt(i);
            for (int w : draw.numbers) if (w == n) hit++;
            if (n == draw.bonus) bonus = true;
        }
        if (hit == 6) return 1;
        if (hit == 5 && bonus) return 2;
        if (hit == 5) return 3;
        if (hit == 4) return 4;
        if (hit == 3) return 5;
        return 0;
    }

    static String won(long n) {
        if (n >= 100_000_000L) {
            long eok = n / 100_000_000L, man = (n % 100_000_000L) / 10_000L;
            return eok + "억" + (man > 0 ? " " + NumberFormat.getInstance(Locale.KOREA).format(man) + "만" : "") + "원";
        }
        return NumberFormat.getInstance(Locale.KOREA).format(n) + "원";
    }

    private static void post(Context ctx, String title, String body) {
        if (Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "추첨 결과", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("추첨 당일 밤 당첨 결과 알림");
            ctx.getSystemService(NotificationManager.class).createNotificationChannel(ch);
        }
        Intent open = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        if (open != null) open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_lotto)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(pi);
        NotificationManagerCompat.from(ctx).notify(NOTI_ID, b.build());
    }

    // ---- 당첨번호 조회 (동행복권 → 미러 폴백). 발표 전이면 null, 둘 다 통신 실패면 IOException ----
    static class Draw {
        int[] numbers = new int[6];
        int bonus;
        long[] prizes = new long[6]; // 1..5등

        long prize(int rank) {
            if (prizes[rank] > 0) return prizes[rank];
            return rank == 4 ? 50000 : rank == 5 ? 5000 : 0;
        }
    }

    static Draw fetchDraw(int drawNo) throws IOException {
        IOException last = null;
        boolean answered = false;
        try {
            Draw d = parsePrimary(http(PRIMARY + drawNo), drawNo);
            if (d != null) return d;
            answered = true;
        } catch (Exception e) {
            last = e instanceof IOException ? (IOException) e : new IOException(e);
        }
        try {
            Draw d = parseMirror(http(MIRROR + drawNo + ".json"), drawNo);
            if (d != null) return d;
            answered = true;
        } catch (Exception e) {
            if (last == null) last = e instanceof IOException ? (IOException) e : new IOException(e);
        }
        if (answered) return null;
        throw last != null ? last : new IOException("조회 실패");
    }

    private static Draw parsePrimary(String body, int drawNo) throws Exception {
        JSONArray list = new JSONObject(body).getJSONObject("data").getJSONArray("list");
        if (list.length() == 0) return null;
        JSONObject it = list.getJSONObject(0);
        if (it.optInt("ltEpsd") != drawNo) return null;
        Draw d = new Draw();
        for (int i = 0; i < 6; i++) d.numbers[i] = it.getInt("tm" + (i + 1) + "WnNo");
        d.bonus = it.getInt("bnsWnNo");
        for (int r = 1; r <= 5; r++) d.prizes[r] = it.optLong("rnk" + r + "WnAmt", 0);
        return d;
    }

    private static Draw parseMirror(String body, int drawNo) throws Exception {
        JSONObject o = new JSONObject(body);
        if (o.optInt("draw_no") != drawNo) return null;
        JSONArray nums = o.getJSONArray("numbers");
        Draw d = new Draw();
        for (int i = 0; i < 6; i++) d.numbers[i] = nums.getInt(i);
        d.bonus = o.getInt("bonus_no");
        JSONArray div = o.optJSONArray("divisions");
        if (div != null) for (int r = 1; r <= 5 && r <= div.length(); r++) d.prizes[r] = div.getJSONObject(r - 1).optLong("prize", 0);
        return d;
    }

    private static String http(String url) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        try {
            c.setConnectTimeout(10000);
            c.setReadTimeout(15000);
            c.setRequestProperty("User-Agent", UA);
            c.setRequestProperty("Accept", "application/json");
            if (c.getResponseCode() != 200) throw new IOException("HTTP " + c.getResponseCode());
            try (InputStream in = c.getInputStream()) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                return out.toString("UTF-8");
            }
        } finally {
            c.disconnect();
        }
    }
}
