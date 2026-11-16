package com.example.geek_ledger_mobile;

import android.annotation.SuppressLint;
import android.content.Context;
import android.os.Build;
import java.io.File;

/**
 * Synchronous JNI helper exposed to Dart via JNIgen.
 * Avoids async MethodChannel round-trips during startup for storage path and Monet accent color.
 */
public final class NativePlatformHelper {
  private static volatile Context appContext;

  private NativePlatformHelper() {}

  static void init(Context context) {
    if (context != null) {
      appContext = context.getApplicationContext();
    }
  }

  @SuppressLint("PrivateApi")
  private static Context resolveContext() {
    Context ctx = appContext;
    if (ctx != null) {
      return ctx;
    }
    try {
      Class<?> activityThread = Class.forName("android.app.ActivityThread");
      Object app = activityThread.getMethod("currentApplication").invoke(null);
      if (app instanceof Context) {
        ctx = ((Context) app).getApplicationContext();
        appContext = ctx;
        return ctx;
      }
    } catch (Exception ignored) {
      // Best-effort fallback when invoked before Activity initialization.
    }
    return null;
  }

  public static String getStoragePath() {
    Context ctx = resolveContext();
    if (ctx == null) {
      return null;
    }
    return new File(ctx.getFilesDir(), "geek_ledger_state.json").getAbsolutePath();
  }

  /**
   * Returns Android 12+ system Monet accent1_500 ARGB color, or 0 when unavailable.
   * Primitive int avoids boxing overhead over JNI; valid opaque colors are always non-zero.
   */
  public static int getMonetSeedColor() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
      return 0;
    }
    Context ctx = resolveContext();
    if (ctx == null) {
      return 0;
    }
    try {
      return ctx.getColor(android.R.color.system_accent1_500);
    } catch (Exception ignored) {
      return 0;
    }
  }
}
