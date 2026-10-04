import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.criticalreaction.game',
  appName: '临界反应',
  webDir: 'dist',
  plugins: {
    // 关闭 Capacitor 对系统栏 inset 的处理：它默认会给 decorView 加 padding（状态栏 80px），
    // 与我们的沉浸式全屏（MainActivity 隐藏系统栏 + 游戏内自适应）冲突。
    // 游戏的触摸控件安全区由 index.html 的 env(safe-area-inset-*) CSS 变量自行处理。
    SystemBars: {
      insetsHandling: 'disable'
    }
  }
};

export default config;
