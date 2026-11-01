// 本地模拟 GitHub Pages 的项目子路径部署：把 dist 挂在 /repo/ 下。
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const root = process.argv[2]
const prefix = process.argv[3] ?? '/repo/'
const port = Number(process.argv[4] ?? 5199)

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`)
  const pathname = decodeURIComponent(url.pathname)

  if (!pathname.startsWith(prefix)) {
    response.writeHead(404, { 'content-type': 'text/plain' })
    response.end('not found')
    return
  }

  let relative = pathname.slice(prefix.length)
  if (relative === '' || relative.endsWith('/')) relative += 'index.html'

  const file = normalize(join(root, relative))
  try {
    const data = await readFile(file)
    response.writeHead(200, {
      'content-type': types[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    })
    response.end(data)
    return
  } catch {
    /* 落到下面的 SPA 回退 */
  }

  try {
    const html = await readFile(join(root, 'index.html'))
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' })
    response.end(html)
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain' })
    response.end('not found')
  }
}).listen(port, '0.0.0.0', () => {
  console.log(`serving ${root} at http://127.0.0.1:${port}${prefix}`)
})
