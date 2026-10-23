# 测试机信息采集 一键安装 / 更新
# - 下载采集脚本到 %USERPROFILE%\device-info（已有的「测试机信息.xlsx」保留不动）
# - 没有 Python 3.9+ 时自动安装（当前用户安装，不需要管理员权限）
# - 在安装目录建独立的 Python 环境（venv），装 openpyxl、pymobiledevice3，不影响电脑上其他 Python 项目
# - 找不到 adb 时自动下载 platform-tools
# - 检查苹果驱动（采集 iOS 需要 iTunes 或爱思助手）
# - 创建桌面快捷方式「采集测试机信息」
param(
  [string]$InstallDir = (Join-Path $env:USERPROFILE 'device-info'),
  [string[]]$Sources = @(
    'https://yami876.github.io/mobile-test-toolkit/device-kit/',
    'https://cdn.jsdelivr.net/gh/yami876/mobile-test-toolkit@main/device-kit/'
  ),
  [switch]$NoShortcut,   # 测试用：不创建桌面快捷方式
  [switch]$NoLaunch      # 测试用：装完不运行采集
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # 关掉进度条，下载快很多
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$PythonVersion = '3.12.10'
$KitFiles = @('采集设备信息.py', 'ios采集.py', 'requirements.txt', 'version.txt')
$PipIndexes = @('https://pypi.tuna.tsinghua.edu.cn/simple', 'https://mirrors.aliyun.com/pypi/simple', 'https://pypi.org/simple')

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Ok($msg) { Write-Host "    $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "    $msg" -ForegroundColor Yellow }
function WriteUtf8NoBom($path, $text) { [IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding $false)) }
function Download($urls, $to, $timeout = 600) {
  foreach ($u in $urls) {
    try {
      Write-Host "    正在下载：$u"
      Invoke-WebRequest -Uri $u -OutFile $to -UseBasicParsing -TimeoutSec $timeout
      return $true
    } catch { Warn "下载失败：$($_.Exception.Message)，换下一个地址" }
  }
  return $false
}

Write-Host '================ 测试机信息采集 一键安装 / 更新 ================' -ForegroundColor Cyan
Write-Host "安装目录：$InstallDir"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

# ---------- 1. 下载采集脚本 ----------
Step '下载采集脚本'
$tmp = Join-Path $env:TEMP ('device-kit-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$downloaded = $false
foreach ($src in $Sources) {
  try {
    foreach ($f in $KitFiles) {
      $to = Join-Path $tmp $f
      if ($src -match '^https?://') {
        # 文件名是中文，URL 里要编码
        $from = $src + [uri]::EscapeDataString($f) + '?t=' + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
        Invoke-WebRequest -Uri $from -OutFile $to -UseBasicParsing -TimeoutSec 60
      } else {
        Copy-Item -LiteralPath (Join-Path $src $f) -Destination $to -Force   # 本地目录（测试用）
      }
    }
    $downloaded = $true
    Ok "已从 $src 下载"
    break
  } catch {
    Warn "从 $src 下载失败：$($_.Exception.Message)，换下一个地址"
  }
}
if (-not $downloaded) { throw '采集脚本下载失败，请检查网络（需要能访问工具站或 jsdelivr）后重试' }
foreach ($f in $KitFiles) { Copy-Item -LiteralPath (Join-Path $tmp $f) -Destination (Join-Path $InstallDir $f) -Force }
Remove-Item -LiteralPath $tmp -Recurse -Force
$kitVersion = (Get-Content -LiteralPath (Join-Path $InstallDir 'version.txt') -Raw).Trim()
Ok "脚本版本 $kitVersion"
if (Test-Path -LiteralPath (Join-Path $InstallDir '测试机信息.xlsx')) { Ok '已有「测试机信息.xlsx」，保留不动' }

# ---------- 2. Python ----------
Step '检查 Python 环境（需要 3.9 以上）'
function Test-Python($exe, $pre = @()) {
  try {
    # 不能接 Select-Object -First：它会提前结束管道、杀掉 python 进程，退出码变成 -1
    $out = @(& $exe @pre -c "import sys;print('%d.%d' % sys.version_info[:2])" 2>$null)
    if ($LASTEXITCODE -ne 0 -or -not $out) { return $null }
    $v = "$($out[0])".Trim()
    $p = $v.Split('.')
    if ([int]$p[0] -eq 3 -and [int]$p[1] -ge 9) { return $v }
  } catch { }
  return $null
}
$venvPy = Join-Path $InstallDir 'venv\Scripts\python.exe'
$py = $null; $pyPre = @()
if ((Test-Path -LiteralPath $venvPy) -and (Test-Python $venvPy)) {
  Ok '已有独立 Python 环境，直接复用（更新安装）'
} else {
  # 依次找：py 启动器、PATH 里的 python（排除微软商店的占位程序）、当前用户默认安装位置
  # 优先 3.10~3.13：太新的版本 pymobiledevice3 的部分依赖可能还没有安装包
  $cands = @()
  if (Get-Command py -ErrorAction SilentlyContinue) {
    foreach ($m in '3.13', '3.12', '3.11', '3.10', '3') { $cands += , @('py', @("-$m")) }
  }
  foreach ($c in @(Get-Command python, python3 -All -ErrorAction SilentlyContinue)) {
    if ($c.Source -notmatch 'WindowsApps') { $cands += , @($c.Source, @()) }
  }
  foreach ($d in @(Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python3*\python.exe') -ErrorAction SilentlyContinue | Sort-Object FullName -Descending)) {
    $cands += , @($d.FullName, @())
  }
  foreach ($c in $cands) {
    $v = Test-Python $c[0] $c[1]
    if ($v) { $py = $c[0]; $pyPre = $c[1]; Ok "使用已安装的 Python $v（$py）"; break }
  }
  if (-not $py) {
    Warn '没有找到 Python 3.9+，自动安装 Python（当前用户，约 25MB）'
    $exeName = "python-$PythonVersion-amd64.exe"
    $setup = Join-Path $env:TEMP $exeName
    $ok = Download @("https://registry.npmmirror.com/-/binary/python/$PythonVersion/$exeName", "https://www.python.org/ftp/python/$PythonVersion/$exeName") $setup
    if (-not $ok) { throw 'Python 下载失败。可以手动安装 Python 3.9+（https://www.python.org）后重新运行安装' }
    Write-Host '    正在安装 Python，大约 1~2 分钟...'
    $p = Start-Process -FilePath $setup -ArgumentList '/quiet', 'InstallAllUsers=0', 'PrependPath=1', 'Include_test=0', 'Include_launcher=1', 'InstallLauncherAllUsers=0' -Wait -PassThru
    Remove-Item -LiteralPath $setup -Force -ErrorAction SilentlyContinue
    $py = Join-Path $env:LOCALAPPDATA ('Programs\Python\Python' + ($PythonVersion.Split('.')[0..1] -join '') + '\python.exe')
    if ($p.ExitCode -ne 0 -or -not (Test-Python $py)) { throw "Python 安装失败（退出码 $($p.ExitCode)）。可以手动安装 Python 3.9+ 后重新运行安装" }
    Ok "已安装 Python $PythonVersion（$py）"
  }
  Write-Host '    正在创建独立 Python 环境...'
  $venvDir = Join-Path $InstallDir 'venv'
  if (Test-Path -LiteralPath $venvDir) { Remove-Item -LiteralPath $venvDir -Recurse -Force }
  & $py @pyPre -m venv $venvDir
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $venvPy)) { throw '创建 Python 环境失败' }
  Ok "已创建：$venvDir"
}

# ---------- 3. 依赖包 ----------
Step '安装依赖包（openpyxl、pymobiledevice3，首次约需 1~3 分钟）'
$req = Join-Path $InstallDir 'requirements.txt'
$installed = $false
foreach ($idx in $PipIndexes) {
  Write-Host "    使用源：$idx"
  & $venvPy -m pip install -q --disable-pip-version-check -r $req -i $idx
  if ($LASTEXITCODE -eq 0) { $installed = $true; break }
  Warn '安装失败，换下一个源'
}
if (-not $installed) { throw '依赖包安装失败，请看上面的 pip 报错（多数是网络问题），处理后重新运行安装' }
Ok '依赖包已就绪'

# ---------- 4. adb ----------
Step '检查 adb（采集 Android 用）'
$adbDir = $null
$cmd = Get-Command adb -ErrorAction SilentlyContinue
if ($cmd) { $adbDir = Split-Path $cmd.Source }
if (-not $adbDir) {
  $dirs = @('D:\Program Files\platform-tools', 'C:\Program Files\platform-tools', (Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools'), (Join-Path $InstallDir 'platform-tools'))
  if ($env:ANDROID_HOME) { $dirs += (Join-Path $env:ANDROID_HOME 'platform-tools') }
  if ($env:ANDROID_SDK_ROOT) { $dirs += (Join-Path $env:ANDROID_SDK_ROOT 'platform-tools') }
  $adbDir = $dirs | Where-Object { Test-Path -LiteralPath (Join-Path $_ 'adb.exe') } | Select-Object -First 1
}
if ($adbDir) {
  Ok "使用已有的 adb（$adbDir）"
} else {
  Warn '没有找到 adb，自动下载 platform-tools（约 7MB）'
  $zip = Join-Path $env:TEMP 'platform-tools-latest-windows.zip'
  $ok = Download @('https://mirrors.cloud.tencent.com/AndroidSDK/platform-tools-latest-windows.zip', 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip') $zip
  if ($ok) {
    $target = Join-Path $InstallDir 'platform-tools'
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
    Expand-Archive -LiteralPath $zip -DestinationPath $InstallDir -Force   # 压缩包里自带 platform-tools 目录
    Remove-Item -LiteralPath $zip -Force
    $adbDir = $target
    Ok "已安装 adb 到 $adbDir"
  } else {
    Warn 'adb 下载失败：Android 设备暂时采集不了（iOS 不受影响）。可以自行安装 adb 后重新运行安装'
  }
}

# ---------- 5. 苹果驱动 ----------
Step '检查苹果驱动（采集 iOS 用）'
$appleSvc = Get-Service -ErrorAction SilentlyContinue | Where-Object { $_.Name -like '*Apple Mobile Device*' -or $_.DisplayName -like '*Apple Mobile Device*' } | Select-Object -First 1
$usbmux = $false
try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1', 27015); $usbmux = $c.Connected; $c.Close() } catch { }
if ($usbmux) {
  Ok '苹果驱动正常'
} elseif ($appleSvc) {
  Warn "已安装苹果驱动，但服务没在运行（$($appleSvc.Status)）。采集 iOS 前请打开一次 iTunes / 爱思助手，或重启电脑"
} else {
  Warn '没有检测到苹果驱动：只采集 Android 不受影响；要采集 iOS，请安装 iTunes（微软商店搜索 iTunes）或爱思助手'
}

# ---------- 6. 启动脚本 + 快捷方式 ----------
Step '创建启动脚本'
$launcher = Join-Path $InstallDir '采集测试机信息.bat'
$lines = @(
  '@echo off',
  'chcp 65001 >nul',
  'title 采集测试机信息',
  'rem 采集所有已连接的 Android / iOS 设备，写入「测试机信息.xlsx」',
  'rem 默认写入本目录的 测试机信息.xlsx；把别的 Excel 拖到本文件（或桌面快捷方式）上，就写入那个表',
  'cd /d "%~dp0"',
  'set PYTHONUTF8=1',
  'set PYTHONIOENCODING=utf-8'
)
if ($adbDir) { $lines += ('set "PATH=' + $adbDir + ';%PATH%"') }
$lines += @(
  'set "XLSX=%~dp0测试机信息.xlsx"',
  'if not "%~1"=="" set "XLSX=%~f1"',
  'echo 写入表格：%XLSX%',
  'echo 请先关闭这个 Excel；Android 手机打开 USB 调试，iPhone / iPad 解锁并点「信任此电脑」',
  'echo.',
  '"%~dp0venv\Scripts\python.exe" "%~dp0采集设备信息.py" -o "%XLSX%"',
  'echo.',
  'if exist "%XLSX%" (',
  '  choice /c YN /n /m "是否打开表格？[Y/N] "',
  '  if not errorlevel 2 start "" "%XLSX%"',
  ') else pause'
)
WriteUtf8NoBom $launcher ($lines -join "`r`n")
Ok $launcher

if (-not $NoShortcut) {
  $desktop = [Environment]::GetFolderPath('Desktop')
  $lnk = Join-Path $desktop '采集测试机信息.lnk'
  $ws = New-Object -ComObject WScript.Shell
  $sc = $ws.CreateShortcut($lnk)
  $sc.TargetPath = $launcher
  $sc.WorkingDirectory = $InstallDir
  $sc.IconLocation = "$env:SystemRoot\System32\shell32.dll,15"
  $sc.Description = '采集已连接的 Android / iOS 测试机信息，写入 Excel'
  $sc.Save()
  Ok "桌面快捷方式：$lnk"
}

Write-Host "`n================ 安装完成 ================" -ForegroundColor Green
Write-Host '以后双击桌面的「采集测试机信息」即可采集：结果写入安装目录的「测试机信息.xlsx」。'
Write-Host '已有自己的测试机表格：放到安装目录并命名为「测试机信息.xlsx」，或者直接把 Excel 拖到桌面快捷方式上。'
Write-Host '提示：下载的一键安装 .bat 现在可以删除；更新脚本时重新运行一次即可，表格不会被覆盖。' -ForegroundColor Yellow
if (-not $NoLaunch) {
  Start-Process -FilePath 'explorer.exe' -ArgumentList "`"$InstallDir`""
}
