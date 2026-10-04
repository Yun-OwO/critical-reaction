package com.criticalreaction.game;

import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

  @Override
  public void onCreate(Bundle savedInstanceState) {
    // 必须在 super.onCreate 之前注册：Bridge 在 super 里收集插件表，晚注册不会进 JS 全局桥
    registerPlugin(NativeHapticsPlugin.class);
    super.onCreate(savedInstanceState);
    applyImmersiveMode();
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    // 对话框/切换应用回来后系统栏会重新出现，拿到焦点即重新进入沉浸式
    if (hasFocus) applyImmersiveMode();
  }

  /** 沉浸式全屏：隐藏状态栏/导航栏（下滑临时呼出），画面延伸进刘海与系统栏区域。 */
  private void applyImmersiveMode() {
    // NO_LIMITS 强制窗口内容铺满整个屏幕（不留给状态栏/手势条任何 inset）——
    // 部分国产 ROM（MIUI）会忽略 setDecorFitsSystemWindows(false)，必须用窗口标志硬保证
    getWindow().addFlags(
        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
            | WindowManager.LayoutParams.FLAG_FULLSCREEN);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      getWindow().getAttributes().layoutInDisplayCutoutMode =
          WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      getWindow().setDecorFitsSystemWindows(false);
      android.view.WindowInsetsController controller = getWindow().getInsetsController();
      if (controller != null) {
        controller.hide(android.view.WindowInsets.Type.statusBars() | android.view.WindowInsets.Type.navigationBars());
        controller.setSystemBarsBehavior(
            android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
      }
    } else {
      getWindow().getDecorView().setSystemUiVisibility(
          View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
              | View.SYSTEM_UI_FLAG_FULLSCREEN
              | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
              | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
              | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
              | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }
  }
}
