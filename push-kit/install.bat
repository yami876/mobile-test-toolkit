@echo off
chcp 65001 >nul
title CTC 数据推送 一键安装
set "SELF=%~f0"
echo 正在下载最新的安装程序...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $ProgressPreference='SilentlyContinue'; $p=Join-Path $env:TEMP 'ctc-daily-install.ps1'; $ok=$false; foreach($u in 'https://yami876.github.io/mobile-test-toolkit/push-kit/install.ps1','https://cdn.jsdelivr.net/gh/yami876/mobile-test-toolkit@main/push-kit/install.ps1'){ try { Invoke-WebRequest -Uri ($u+'?t='+[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()) -OutFile $p -UseBasicParsing -TimeoutSec 60; $ok=$true; break } catch { Write-Host ('download failed: '+$u) } }; if(-not $ok){ Write-Host 'Cannot download installer. Check network.' -ForegroundColor Red; exit 1 }; try { & $p } finally { Remove-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue }"
if errorlevel 1 (
  echo.
  pause
  exit /b 1
)
rem 安装成功：清理下载目录里重复下载的安装包副本（同名带 (1)(2) 的），最后删掉本文件
powershell -NoProfile -Command "$s=Get-Item -LiteralPath $env:SELF; $base=$s.BaseName -replace '\s*\(\d+\)$',''; Get-ChildItem -LiteralPath $s.DirectoryName -Filter '*.bat' | Where-Object { $_.FullName -ne $s.FullName -and ($_.BaseName -replace '\s*\(\d+\)$','') -eq $base } | Remove-Item -Force -ErrorAction SilentlyContinue"
echo.
echo 安装包已自动清理，以后从桌面的「CTC 推送配置」打开配置页。
pause
(goto) 2>nul & del "%SELF%"
