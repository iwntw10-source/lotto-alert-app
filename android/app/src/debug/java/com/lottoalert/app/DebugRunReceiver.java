package com.lottoalert.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import androidx.work.Data;
import androidx.work.ExistingWorkPolicy;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;

/**
 * 디버그 빌드 전용: 토요일 밤을 기다리지 않고 결과 알림 워커를 즉시 실행해 본다.
 *   adb shell am broadcast -n com.lottoalert.app/.DebugRunReceiver
 * (release 빌드에는 포함되지 않음)
 */
public class DebugRunReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        // --es set_key debug_now_offset --el set_val -132000000 : 디버그 전용 테스트 값 저장 (시간 이동, 재시도 간격 debug_retry_ms)
        String key = intent.getStringExtra("set_key");
        if (key != null) {
            context.getSharedPreferences(LottoWorker.PREFS, Context.MODE_PRIVATE).edit().putLong(key, intent.getLongExtra("set_val", 0)).apply();
            return;
        }
        // --ei delay N : 실제 주간 예약(체인)을 N초 뒤로 당겨서 "앱을 종료한 상태에서 예약 시각에 알림이 오는지" 검증
        int delay = intent.getIntExtra("delay", -1);
        if (delay >= 0) {
            LottoWorker.scheduleAll(context, delay * 1000L, ExistingWorkPolicy.REPLACE);
            return;
        }
        // --ez force false 로 실제 토요일 밤과 같은 경로(이미 알린 회차 건너뛰기, 다음 주 재예약)를 실행
        boolean force = intent.getBooleanExtra("force", true);
        Data data = new Data.Builder().putBoolean(LottoWorker.KEY_FORCE, force).build();
        WorkManager.getInstance(context).enqueue(new OneTimeWorkRequest.Builder(LottoWorker.class).setInputData(data).build());
    }
}
