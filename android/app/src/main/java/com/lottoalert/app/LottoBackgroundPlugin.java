package com.lottoalert.app;

import android.content.Context;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** JS -> 네이티브: 등록된 복권을 워커가 읽을 수 있게 저장하고, 주간 결과 알림 작업을 예약/해제한다. */
@CapacitorPlugin(name = "LottoBackground")
public class LottoBackgroundPlugin extends Plugin {

    @PluginMethod
    public void sync(PluginCall call) {
        Context ctx = getContext();
        String tickets = call.getString("tickets", "[]");
        boolean notify = !Boolean.FALSE.equals(call.getBoolean("notify", true));
        ctx.getSharedPreferences(LottoWorker.PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString("tickets", tickets)
                .putBoolean("notify", notify)
                .apply();
        if (notify) LottoWorker.ensureScheduled(ctx);
        else LottoWorker.cancel(ctx);
        call.resolve();
    }
}
