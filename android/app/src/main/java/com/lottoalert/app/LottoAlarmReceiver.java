package com.lottoalert.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * 절전(Doze) 중에도 울리는 알람을 받아 결과 확인을 바로 실행한다.
 * 알람 수신 직후에는 짧게 네트워크 사용이 허용되므로, 조회 한 번은 이 안에서 끝낸다(goAsync로 수신기 수명 연장).
 */
public class LottoAlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        final PendingResult pending = goAsync();
        final Context app = context.getApplicationContext();
        new Thread(() -> {
            try {
                LottoWorker.execute(app, false, "alarm");
            } finally {
                pending.finish();
            }
        }).start();
    }
}
