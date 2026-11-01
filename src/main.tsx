import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ToastProvider } from './ui/Toast'
import './styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('缺少 #root 挂载点')

createRoot(container).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
)

// Service Worker 只在正式构建里注册：开发服务器上注册会把 HMR 的模块缓存住，改代码不生效
// 用 BASE_URL 拼路径，GitHub Pages 的 /仓库名/ 子路径部署也能找到
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      /* 离线能力拿不到不影响主流程 */
    })
  })
}
