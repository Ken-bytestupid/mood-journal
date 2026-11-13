/* 随记 · Service Worker
 * 目标：装到手机后断网也能打开、能写、能存。
 * 策略：
 *   - 导航请求（打开页面）走「缓存优先 + 后台更新」——首屏立刻出来，新版本在后台悄悄换
 *   - 其它同源静态资源走「缓存优先」——所有 JS/CSS/图标都被缓存，断网可用
 *
 * 注意：GitHub Pages 的项目站点部署在 /仓库名/ 子路径下，
 * 所以这里所有路径都从 self.registration.scope（部署根）推出来，不能写死根路径。
 */
const CACHE = 'suiji-v3'
const SCOPE = self.registration.scope

const url = (path) => new URL(path, SCOPE).href

const CORE = [
  SCOPE,
  url('index.html'),
  url('manifest.webmanifest'),
  url('icon.svg'),
  url('icons/icon-180.png'),
  url('icons/icon-192.png'),
  url('icons/icon-512.png'),
]

function putInCache(request, response) {
  if (!response || !response.ok) return response
  const copy = response.clone()
  caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {})
  return response
}

/** 把页面 HTML 统一存到 index.html 这个固定 key 下 */
function putShell(response) {
  if (!response || !response.ok) return response
  const copy = response.clone()
  caches.open(CACHE).then((cache) => cache.put(url('index.html'), copy)).catch(() => {})
  return response
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      await cache.addAll(CORE).catch(() => {})
      // 把 index.html 里引用的带哈希资源也提前存下来，
      // 这样「第一次打开之后」就已经具备离线能力（不用等第二次访问）。
      try {
        const response = await fetch(url('index.html'), { cache: 'no-cache' })
        const html = await response.text()
        const assets = new Set()
        for (const match of html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)) {
          const href = new URL(match[1], SCOPE).href
          if (href.startsWith(SCOPE)) assets.add(href)
        }
        if (assets.size > 0) await cache.addAll([...assets])
      } catch {
        /* 预缓存失败就退化成运行时缓存 */
      }
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const requestUrl = new URL(request.url)
  if (requestUrl.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE)
        const cached = (await cache.match(url('index.html'))) || (await cache.match(SCOPE))
        // 后台拉一次最新页面：有缓存时先给缓存，网络结果留着下次用
        const fresh = fetch(request, { cache: 'no-cache' })
          .then((response) => putShell(response))
          .catch(() => null)

        if (cached) {
          event.waitUntil(fresh)
          return cached
        }
        return (await fresh) || Response.error()
      })(),
    )
    return
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached
      return fetch(request).then((response) => putInCache(request, response))
    }),
  )
})
