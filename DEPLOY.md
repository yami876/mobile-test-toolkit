# 部署指引

完整流程：**本地预览 → 装 Git → 推 GitHub → Vercel 自动部署**。

按顺序跟着做，全程预计 10～20 分钟（含等待）。

---

## 第 0 步：本地预览（确认页面没问题）

```powershell
cd d:\项目测试\cursor_test\mobile-test-toolkit
python -m http.server 8000
```

浏览器访问 <http://localhost:8000>，逐个点开 10 个小工具确认能用。

**如果某个工具按钮没反应**：按 F12 看 Console，常见原因是 CDN 加载失败（公司网或代理问题），换网络再试。

按 `Ctrl + C` 停止服务器。

---

## 第 1 步：装 Git

```powershell
winget install --id Git.Git -e --source winget
```

> 装完**关掉再重开 PowerShell**，否则 `git` 命令找不到。

验证：
```powershell
git --version
```
能输出 `git version 2.xx.x` 就 OK。

首次配置身份（终身只配一次）：
```powershell
git config --global user.name "yami"
git config --global user.email "yami.wu@xtool.com"
```

---

## 第 2 步：注册 GitHub 账号

1. 打开 <https://github.com>
2. 右上角 **Sign up** → 邮箱注册（建议用 yami.wu@xtool.com 公司邮箱，方便团队识别）
3. 注册后到邮箱收验证邮件，点击激活

---

## 第 3 步：在 GitHub 创建空仓库

1. 登录后右上角 **+** → **New repository**
2. 填写：
   - **Repository name**：`mobile-test-toolkit`
   - **Description**：移动端测试工具集（可选）
   - **Public** ✅（公开 — Vercel 免费部署需要）
   - **Initialize this repository with...** 三个勾全部**不要勾**（本地已经有内容了，勾了会冲突）
3. 点 **Create repository**

页面会跳到一个空仓库，记下顶部那个 HTTPS 地址：
```
https://github.com/你的用户名/mobile-test-toolkit.git
```

---

## 第 4 步：把本地代码推上去

```powershell
cd d:\项目测试\cursor_test\mobile-test-toolkit

# 初始化本地 git 仓库
git init

# 把所有文件加入暂存
git add .

# 第一次提交
git commit -m "首次提交：移动端测试工具集 v1"

# 改默认分支名为 main（GitHub 默认是 main）
git branch -M main

# 关联远程仓库（把 URL 换成你的）
git remote add origin https://github.com/你的用户名/mobile-test-toolkit.git

# 推送
git push -u origin main
```

最后一步 `git push` 会弹出一个浏览器窗口让你登录 GitHub 授权，**点 Authorize 确认**。

> 如果没弹窗，命令行会让你输入用户名和密码 — 这里**密码不是 GitHub 登录密码**，而是 Personal Access Token。最简单的办法是去 GitHub 装 `GitHub CLI`，或者用上面的浏览器授权方式重试。

推送成功后刷新 GitHub 仓库页面，所有文件应该都出现了。

---

## 第 5 步：用 Vercel 部署

1. 打开 <https://vercel.com>
2. 点 **Sign Up** → 选 **Continue with GitHub**（用 GitHub 账号登录最方便）
3. 授权 Vercel 访问你的 GitHub 仓库
4. 登录后点 **Add New...** → **Project**
5. 找到 `mobile-test-toolkit` 仓库 → 点 **Import**
6. 配置页面：
   - **Framework Preset**：Other（默认就是）
   - **Build Command**、**Output Directory** 全部**留空**
   - **Root Directory**：保持 `.`
7. 点 **Deploy**
8. 等 20～40 秒，部署完成会跳到 Dashboard
9. 顶部就是你的网址：`mobile-test-toolkit-xxxx.vercel.app`

点开就是线上版！

---

## 第 6 步：后续怎么更新

本地改完任何代码：

```powershell
cd d:\项目测试\cursor_test\mobile-test-toolkit
git add .
git commit -m "改了什么，简短描述"
git push
```

`git push` 完，Vercel 会**自动重新部署**，大约 30 秒后线上版就更新了。

---

## 第 7 步（可选）：分享给团队

直接把 Vercel 网址发到团队群：

> 📱 移动端测试工具集，浏览器打开即用
> https://mobile-test-toolkit-xxxx.vercel.app

如果想要更短/更专业的网址，可以在 Vercel **Project Settings → Domains** 绑定自定义域名（比如 `tools.xtool.com`，需要域名管理权限）。

---

## 常见坑

| 现象 | 原因 / 解决 |
|---|---|
| `git: 不是命令` | 装完 Git 没重开 PowerShell |
| `git push` 失败 401 | GitHub 登录授权没完成，重新跑会弹浏览器 |
| Vercel 部署后页面 404 | 检查 Root Directory 是不是项目根 |
| 小工具点开后样式炸了 | Tailwind CDN 加载失败，刷新或换网络 |
| 二维码工具没生成 | qrcodejs CDN 被墙，换 unpkg.com 镜像或本地引入 |

---

## 团队协作流程（建议）

1. 团队成员 fork 仓库或加成 Collaborator
2. 加新工具走 PR：
   ```powershell
   git checkout -b add-xxx-tool
   # 改代码
   git push -u origin add-xxx-tool
   ```
3. GitHub 上提 PR，你 review 后合并
4. Vercel 自动部署到生产
5. PR 还能预览：Vercel 会给每个 PR 一个独立的预览网址
