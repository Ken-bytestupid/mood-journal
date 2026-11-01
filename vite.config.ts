import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // GitHub Pages 的项目站点在 /仓库名/ 子路径下，构建时用 BASE 传进去；
  // 本地开发和 Cloudflare 这类根路径部署不用传，默认 '/'。
  base: process.env.BASE ?? '/',
  plugins: [react()],
  server: { host: '0.0.0.0', port: 5180, strictPort: true },
  preview: { host: '0.0.0.0', port: 5181, strictPort: true },
})
