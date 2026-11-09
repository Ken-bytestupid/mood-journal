# 随记 · mood-journal

随手记录琐事与心情的手机端小应用。打开就是「记录」页，写、拍照、加表情、保存；
所有历史在「我的」里看。数据只存在本机浏览器（IndexedDB），不上传。

这是**可运行的骨架**：结构、数据、交互都已经通了，视觉细节和动效还在等确认。

## 跑起来

```bash
pnpm install
pnpm dev          # http://localhost:5180
```

手机和电脑连同一个 Wi-Fi，用电脑的局域网地址访问：

```
http://<电脑局域网 IP>:5180
```

Windows 上第一次可能要在防火墙提示里允许 Node.js 访问专用网络，否则手机连不上。

生产构建：

```bash
pnpm build        # 类型检查 + 打包到 dist/
pnpm preview      # 预览构建产物，端口 5181
```

## 目录结构

```
src/
  core/                 与界面无关的地基
    types.ts            Entry / Mood 数据结构
    db.ts               IndexedDB 存储层，隐私模式自动退回 localStorage
    time.ts             时间展示、按天分组、连续天数
    image.ts            照片压缩：双档 WebP（1440 查看图 + 480 缩略图），JPEG 自动降级
  modules/              按功能垂直切分
    mood/moods.ts       情绪清单：4 积极 + 4 消极
    entries/store.ts    记录的新增/删除/备份/导入
    entries/useEntries.ts  全局唯一的记录状态（两个页面共享）
  pages/
    RecordPage.tsx      「记录」：心情格 + 工具栏时钟 + 写作卡
    MinePage.tsx        「我的」：统计、历史、详情、导入导出
  ui/
    Sheet.tsx           底部弹层
    Toast.tsx           轻提示
  App.tsx               外壳：两个 tab、页面保活、视口高度
  styles.css            设计 token + 全部样式（浅色/深色两套）
scripts/
  make-icons.py         用 Pillow 生成 PWA 图标
  inspect.mjs           无头浏览器测量 + 截图（开发自检）
  flow.mjs              端到端：选心情→输入→加图→保存→列表→详情
  verify2.mjs           深色模式、表情面板、保存反馈
```

## 交互约定（当前实现）

- **记录页**：打开即可写。顶部左格是「这次的心情」，点开只有三项：**积极 / 消极 / 只是记录**；
  右格显示日期与分钟级时间，保存时写进记录。
- **此刻的心情**：标题左边的胶囊按钮，点开是 4 积极 + 4 消极的具体情绪；选中就把那个 emoji
  挂到这条记录上（不写进正文）。挂了具体情绪会自动把「这次的心情」定到它所属的那一组；
  选「只是记录」则会清掉已挂的情绪。
- **照片**：最多 6 张。自动压成两档 WebP（长边 1440 的查看图 + 长边 480 的缩略图），
  存 Blob 而不是 base64；浏览器不支持 WebP 编码时退回 JPEG。压缩期间保存按钮显示「处理中」。
  一张 3–8MB 的手机原图，落到库里通常 100–130KB（旧方案约 290KB）。
- **自动草稿**：正文 / 标题 / 心情 / 情绪实时存 localStorage，切页面或浏览器被回收都不会丢。
  照片不进草稿（体积大），这一版切页面会丢。
- **保存**：保存成功后按钮变绿显示「已保存」，表单清空，光标收起。
- **我的**：记录总数 / 连续天数 / 本周、积极·消极·只是记录的数量与分布条、数据与存储状态、
  按天分组的历史、点开看详情可删除、导出（系统分享）/导入 JSON 备份、清空。
- **深浅色**：跟随系统。
- **动效**：仅用 CSS（弹层进出、按钮按压缩放、列表淡入、toast），全部遵守
  `prefers-reduced-motion`。

## 数据结构

```ts
Entry {
  id: string
  title: string
  text: string
  polarity: 'positive' | 'negative' | 'plain'   // 这次的心情（粗分类）
  emotionId: string | null                      // 此刻的心情（具体情绪，可空）
  photos: Photo[]        // 双档 WebP Blob：{ thumb, view, width, height }
  createdAt: number
  updatedAt: number
  context?: { weather?: string | null }         // 以后接天气，不用改结构
}
```

旧版本（`moodId` 那一版）的数据在读取时会自动升级成 `polarity + emotionId`，
不需要手动迁移，旧记录也不会丢。

## 数据存储与可靠性

网页应用的数据只能落在「浏览器管理的本机存储」里（iOS/Android 上都是设备磁盘中的数据库文件，
不是云端、不是内存）。`src/core/durability.ts` 在这个前提下做了四层保障：

1. **主库**：IndexedDB（`src/core/db.ts`），单条写入即事务提交；隐私模式自动退回 localStorage。
2. **持久化申请**：启动时调用 `navigator.storage.persist()`，让浏览器承诺不因长期闲置清理数据。
3. **文字镜像**：主库每次变动后，把纯文字副本写进 localStorage（不含图片）。
   主库被系统清掉时，「我的」页会出现「恢复」入口，能捞回文字，图片需重新添加。
4. **状态可见**：「我的 → 数据与存储」显示后端类型、持久化状态、已用/配额、镜像条数、上次导出时间。

导出走系统分享（`navigator.share`），iOS 上可以直接存进「文件」App / iCloud 云盘；
不支持分享的浏览器退回下载。

**边界要清楚**：网页没法把文件直接写进手机的「文件」目录，也没有后台定时任务——这是浏览器沙箱的限制。
要真正"像原生 App 一样把数据放在应用目录、参与系统备份"，需要把前端包成原生壳
（Capacitor / Tauri），数据层换成 SQLite 或文件。

## 已知限制 / 下一步

- 记录不能编辑（只能删除），下一步补编辑。
- 没有搜索、筛选、日历视图、提醒。
- 天气位已留好，未接数据源。
- 旧记录里的 base64 照片在读取时会被还原成 Blob 正常显示，但**不会被重新压缩**；
  想回收那部分空间，可以导出备份再导入一次（导入走的是新管线的压缩格式）。
- 备份 JSON 里的照片仍然是 base64（换设备/换域名要能完整还原），所以备份文件会比库里的数据大。
- 桌面版可以后续用 Tauri 包同一份前端。

## 部署到 GitHub Pages

仓库里已经带了 `.github/workflows/deploy.yml`：推到 `master`（或 `main`）就自动构建并发布。

1. 在 GitHub 上建一个**空仓库**（不要勾选自动生成 README / .gitignore）
2. 本地推送：

```bash
git remote add origin https://github.com/<你的用户名>/mood-journal.git
git push -u origin master
```

3. 仓库 → **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**
4. 等 Actions 跑完，地址是 `https://<你的用户名>.github.io/mood-journal/`

要点：

- 项目站点在 `/仓库名/` 子路径下，工作流会自动把 `BASE` 设成 `/仓库名/`；
  如果仓库名是 `<用户名>.github.io`，则用根路径 `/`。
- `index.html` 里的资源用 `%BASE_URL%` 前缀，Service Worker 用 `self.registration.scope`
  推导路径，所以本地根路径部署和 Pages 子路径部署都能跑（已实测：`/repo/` 子路径下 SW 正常激活、断网可用）。
- 这是纯静态站点，没有服务端；发版 = 推代码，回滚 = `git revert`。
- **数据按地址（origin）隔离**：换域名或换仓库名等于换了存储，旧记录要用「导出 / 导入」搬过去。

