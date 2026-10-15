# CTC 数据推送 一键安装 / 更新
# - 下载推送程序到 %USERPROFILE%\.ctc-daily（已有的配置、登录信息保留）
# - 没有 Node 18+ 时自动下载免安装版 Node（不需要管理员权限）
# - 创建桌面快捷方式「CTC 推送配置」并打开配置页
param(
  [string]$InstallDir = (Join-Path $env:USERPROFILE '.ctc-daily'),
  [string[]]$Sources = @(
    'https://yami876.github.io/mobile-test-toolkit/push-kit/',
    'https://cdn.jsdelivr.net/gh/yami876/mobile-test-toolkit@main/push-kit/'
  ),
  [switch]$ForcePortableNode,   # 测试用：即使系统有 Node 也下载免安装版
  [switch]$NoShortcut,          # 测试用：不创建桌面快捷方式
  [switch]$NoLaunch             # 测试用：装完不打开配置页
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # 关掉进度条，下载快很多
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$NodeVersion = 'v22.12.0'
$KitFiles = @('ctc-daily.mjs', 'ctc-auth.mjs', 'server.mjs', 'config.html', 'config.template.json', 'version.txt', 'run-hidden.vbs')

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Ok($msg) { Write-Host "    $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "    $msg" -ForegroundColor Yellow }
function WriteUtf8NoBom($path, $text) { [IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding $false)) }

Write-Host '================ CTC 数据推送 一键安装 / 更新 ================' -ForegroundColor Cyan
Write-Host "安装目录：$InstallDir"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

# ---------- 1. 下载推送程序 ----------
Step '下载推送程序'
$tmp = Join-Path $env:TEMP ('ctc-daily-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$downloaded = $false
foreach ($src in $Sources) {
  try {
    foreach ($f in $KitFiles) {
      $from = $src + $f
      $to = Join-Path $tmp $f
      if ($src -match '^https?://') {
        Invoke-WebRequest -Uri ($from + '?t=' + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()) -OutFile $to -UseBasicParsing -TimeoutSec 60
      } else {
        Copy-Item -LiteralPath $from -Destination $to -Force   # 本地目录（测试用）
      }
    }
    $downloaded = $true
    Ok "已从 $src 下载"
    break
  } catch {
    Warn "从 $src 下载失败：$($_.Exception.Message)，换下一个地址"
  }
}
if (-not $downloaded) { throw '推送程序下载失败，请检查网络（需要能访问工具站或 jsdelivr）后重试' }
foreach ($f in $KitFiles) { Copy-Item -LiteralPath (Join-Path $tmp $f) -Destination (Join-Path $InstallDir $f) -Force }
Remove-Item -LiteralPath $tmp -Recurse -Force
$kitVersion = (Get-Content -LiteralPath (Join-Path $InstallDir 'version.txt') -Raw).Trim()
Ok "程序版本 $kitVersion"

# ---------- 2. 配置文件 ----------
Step '准备配置文件'
$configPath = Join-Path $InstallDir 'config.json'
if (Test-Path -LiteralPath $configPath) {
  Ok '已有配置，保留不动（更新安装）'
} else {
  Copy-Item -LiteralPath (Join-Path $InstallDir 'config.template.json') -Destination $configPath
  Ok '已生成空白配置，稍后在配置页里填写'
}

# ---------- 3. Node 环境 ----------
Step '检查 Node 环境'
$node = $null
if (-not $ForcePortableNode) {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) {
    $v = (& $cmd.Source --version) -replace '^v', ''
    if ([int]($v.Split('.')[0]) -ge 18) { $node = $cmd.Source; Ok "使用系统已安装的 Node v$v（$node）" }
    else { Warn "系统 Node 版本 v$v 太旧（需要 18 以上），改用免安装版" }
  }
}
$portable = Join-Path $InstallDir 'node\node.exe'
if (-not $node -and (Test-Path -LiteralPath $portable)) { $node = $portable; Ok "使用已下载的免安装版 Node（$node）" }
if (-not $node) {
  $zipName = "node-$NodeVersion-win-x64"
  $mirrors = @("https://npmmirror.com/mirrors/node/$NodeVersion/$zipName.zip", "https://nodejs.org/dist/$NodeVersion/$zipName.zip")
  $zip = Join-Path $env:TEMP "$zipName.zip"
  $ok = $false
  foreach ($m in $mirrors) {
    try {
      Write-Host "    正在下载免安装版 Node $NodeVersion（约 30MB）：$m"
      Invoke-WebRequest -Uri $m -OutFile $zip -UseBasicParsing -TimeoutSec 600
      $ok = $true
      break
    } catch { Warn "下载失败：$($_.Exception.Message)，换下一个地址" }
  }
  if (-not $ok) { throw 'Node 下载失败。可以手动安装 Node 18+（https://nodejs.org）后重新运行安装' }
  $extract = Join-Path $env:TEMP ("node-extract-" + [guid]::NewGuid().ToString('N'))
  Expand-Archive -LiteralPath $zip -DestinationPath $extract -Force
  $nodeDir = Join-Path $InstallDir 'node'
  if (Test-Path -LiteralPath $nodeDir) { Remove-Item -LiteralPath $nodeDir -Recurse -Force }
  Move-Item -LiteralPath (Join-Path $extract $zipName) -Destination $nodeDir
  Remove-Item -LiteralPath $extract -Recurse -Force
  Remove-Item -LiteralPath $zip -Force
  $node = $portable
  Ok "已安装免安装版 Node 到 $nodeDir"
}

# ---------- 4. 启动脚本 + 快捷方式 ----------
Step '创建启动脚本'
$launcher = Join-Path $InstallDir '打开推送配置.bat'
WriteUtf8NoBom $launcher (@(
  '@echo off',
  'chcp 65001 >nul',
  'rem 打开 CTC 数据推送配置页（关闭本窗口即停止配置页，不影响定时推送）',
  'cd /d "%~dp0"',
  'start "" http://127.0.0.1:8766',
  ('"' + $node + '" server.mjs'),
  'pause'
) -join "`r`n")
Ok $launcher

if (-not $NoShortcut) {
  $desktop = [Environment]::GetFolderPath('Desktop')
  $lnk = Join-Path $desktop 'CTC 推送配置.lnk'
  $ws = New-Object -ComObject WScript.Shell
  $sc = $ws.CreateShortcut($lnk)
  $sc.TargetPath = $launcher
  $sc.WorkingDirectory = $InstallDir
  $sc.IconLocation = "$env:SystemRoot\System32\shell32.dll,14"
  $sc.Description = 'CTC 数据推送配置'
  $sc.Save()
  Ok "桌面快捷方式：$lnk"
}

# ---------- 5. 已有定时任务改用当前的 Node，并开启错过后补推 ----------
# 只处理属于本安装目录的任务（同一台电脑装了多份时互不影响）
$tasks = @(Get-ScheduledTask -TaskPath '\CTCDaily\' -ErrorAction SilentlyContinue |
  Where-Object { $_.Actions[0].WorkingDirectory -eq $InstallDir })
if ($tasks.Count) {
  Step '更新已有定时任务（Node 路径、错过后开机补推、后台运行不弹窗口）'
  # 后台运行：wscript + run-hidden.vbs 隐藏启动 node；禁用了 VBScript 的电脑退回 conhost --headless
  $sysDir = Join-Path $env:SystemRoot 'System32'
  $useVbs = Test-Path (Join-Path $sysDir 'vbscript.dll')
  $vbs = Join-Path $InstallDir 'run-hidden.vbs'
  foreach ($t in $tasks) {
    $arg = $t.Actions[0].Arguments
    # 不管旧任务是直接跑 node 还是已经包了一层，只取 node 自己的参数
    $i = $arg.IndexOf('ctc-daily.mjs')
    if ($i -ge 0) { $arg = $arg.Substring($i) }
    # 旧版任务没有 --at：补上计划时间，补推时脚本才知道原计划是哪天
    if ($arg -notmatch '--at ' -and $t.Triggers.Count) {
      $arg = "$arg --at $(([datetime]$t.Triggers[0].StartBoundary).ToString('HH:mm'))"
    }
    if ($useVbs) {
      $new = New-ScheduledTaskAction -Execute (Join-Path $sysDir 'wscript.exe') -Argument "//B //Nologo `"$vbs`" `"$node`" $arg" -WorkingDirectory $InstallDir
    } else {
      $new = New-ScheduledTaskAction -Execute (Join-Path $sysDir 'conhost.exe') -Argument "--headless `"$node`" $arg" -WorkingDirectory $InstallDir
    }
    $set = $t.Settings
    $set.StartWhenAvailable = $true
    Set-ScheduledTask -TaskPath '\CTCDaily\' -TaskName $t.TaskName -Action $new -Settings $set | Out-Null
  }
  Ok "已更新 $(@($tasks).Count) 个定时任务"
}

Write-Host "`n================ 安装完成 ================" -ForegroundColor Green
Write-Host '接下来在配置页里：飞书登录 → 选项目 → 填群机器人 Webhook、选人员 → 预览 / 立即推送验证 → 保存并应用定时任务'
Write-Host '提示：下载的「CTC推送一键安装.bat」现在可以删除；桌面的「CTC 推送配置」快捷方式请保留，以后从它打开配置页。' -ForegroundColor Yellow
if (-not $NoLaunch) {
  # 配置页已经在运行（比如更新安装）就直接打开，否则启动
  $running = $false
  try { $running = (Invoke-WebRequest -Uri 'http://127.0.0.1:8766/api/ping' -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch { }
  if ($running) {
    Warn '配置页已经在运行：这次更新的程序要关掉原来的「打开推送配置」窗口、重新打开后才生效'
    Start-Process 'http://127.0.0.1:8766'
  } else {
    Start-Process -FilePath $launcher -WorkingDirectory $InstallDir
  }
}
