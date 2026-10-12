@echo off
chcp 65001 >nul
title CTC 数据推送 一键安装
echo 正在下载最新的安装程序...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $ProgressPreference='SilentlyContinue'; $p=Join-Path $env:TEMP 'ctc-daily-install.ps1'; $ok=$false; foreach($u in 'https://yami876.github.io/mobile-test-toolkit/push-kit/install.ps1','https://cdn.jsdelivr.net/gh/yami876/mobile-test-toolkit@main/push-kit/install.ps1'){ try { Invoke-WebRequest -Uri ($u+'?t='+[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()) -OutFile $p -UseBasicParsing -TimeoutSec 60; $ok=$true; break } catch { Write-Host ('download failed: '+$u) } }; if(-not $ok){ Write-Host 'Cannot download installer. Check network.' -ForegroundColor Red; exit 1 }; & $p"
echo.
pause
