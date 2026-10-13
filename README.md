# 移动端测试工具集

测试团队内部用的移动端测试辅助站。

- **首页**：在线小工具（站内自研，浏览器打开即用）
- **第三方工具导航**：常用外部工具（PerfDog、Charles、Appium 等）按分类整理

## 在线访问

https://yami876.github.io/mobile-test-toolkit/

## 仓库地址

| 仓库 | 地址 | 说明 |
|---|---|---|
| GitHub | https://github.com/yami876/mobile-test-toolkit | 线上站点（GitHub Pages）从这里的 `main` 分支部署；推送工具的一键安装也从这里下载 |
| GitLab（公司） | https://git.makeblock.com/yami.wu/mobile-test-toolkit | 公司内部备份 |

改完代码两个仓库都要推：

```powershell
git push gitlab main
git push origin main   # origin = GitHub，推完一两分钟线上更新
```

## 本地预览

```powershell
cd d:\repo\mobile-test-toolkit
python -m http.server 8000
# 浏览器打开 http://localhost:8000
```

## 目录结构

```
mobile-test-toolkit/
├── index.html                      首页（站内小工具陈列）
├── data/
│   └── tools.js                    工具清单数据
└── tools/
    ├── directory.html              第三方工具导航页（搜索+分类）
    ├── ua-parser.html              【小工具】UA 字符串解析
    └── adb-cheatsheet.html         【小工具】ADB 命令速查
```

## 团队成员怎么加新工具

### 场景 A：加一个"在线小工具"（重点）

1. 在 `tools/` 目录复制一份已有的小工具 `.html`，改名（比如 `qrcode.html`）
2. 改里面的页面标题和功能逻辑
3. 打开 `data/tools.js`，在 `TOOLS` 数组里追加：

```js
{
  name: '二维码生成',
  desc: '输入文本/URL，一键生成二维码并下载',
  url: 'tools/qrcode.html',
  platforms: ['通用'],
  category: 'mini',
  tags: ['二维码', 'qrcode'],
  icon: '📱',          // 首页大卡片图标，emoji 即可
  internal: true,      // 必须！标记为站内小工具
},
```

保存刷新页面就能看到。

### 场景 B：加一个"第三方工具"（导航卡片）

打开 `data/tools.js`，追加：

```js
{
  name: 'WebPageTest',
  desc: '在线网页性能测试，可模拟移动端网络',
  url: 'https://www.webpagetest.org/',
  platforms: ['通用'],
  category: 'perf',          // perf/log/capture/proxy/ui/automation
  tags: ['性能', '在线'],
  // 注意：不要加 internal，加了就会跑到首页去
},
```

## 当前进度

**站内小工具（2 个）**
- 🔍 UA 字符串解析
- ⌨️ ADB 命令速查

**计划中的小工具**（按优先级排）
- 抓包代理二维码生成（手机扫码连代理）
- 测试设备信息收集表（点一下导出 markdown）
- 屏幕分辨率 / DPI 查询
- 时间戳与日期互转
- JSON / Base64 / URL 编解码
- 正则在线测试
- 颜色对比 / 取色器

**第三方工具**：22 个，按 6 大分类收录

## 贡献流程

1. 从 `main` 拉新分支：`git checkout -b add-xxx`
2. 改代码，本地预览没问题
3. 提 PR，合并后 Vercel 自动部署

## 技术栈

- HTML + Tailwind CSS（CDN 引入，无构建）
- 原生 JavaScript
- 部署：Vercel / Cloudflare Pages
