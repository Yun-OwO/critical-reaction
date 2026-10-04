import { defineConfig } from 'vite';
import { cpSync } from 'node:fs';

export default defineConfig({
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173
  },
  plugins: [
    {
      // 游戏美术资源在根目录 assets/（dev 下 vite 会兜底伺服根文件，但 build 只拷 public/）。
      // 构建后手动并入 dist/assets/，与打包 JS 的同名目录合并（子目录不冲突）。
      name: 'copy-game-assets',
      apply: 'build',
      closeBundle: () => {
        cpSync('assets', 'dist/assets', { recursive: true });
      }
    }
  ]
});
