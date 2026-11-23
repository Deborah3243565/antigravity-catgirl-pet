@echo off
chcp 65001 >nul
title Antigravity 星星猫娘桌宠 · 一键修复新版不显示问题
cd /d "%~dp0"

echo ============================================================
echo   🌟 Gemini 星星猫娘 · 新版 Antigravity 一键适配修复工具
echo ============================================================
echo.
echo [1/2] 正在扫描并修复 Antigravity 快捷方式调试参数...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\fix_cdp.ps1"

echo.
echo [2/2] 正在检查当前 Antigravity 调试端口状态...

set "PORT_FOUND=0"
if exist "%APPDATA%\Antigravity\DevToolsActivePort" set "PORT_FOUND=1"
if exist "%LOCALAPPDATA%\Antigravity\DevToolsActivePort" set "PORT_FOUND=1"

if "%PORT_FOUND%"=="1" (
  echo   [OK] 检测到 DevToolsActivePort，正在立即挂载星星猫娘...
  echo.
  node scripts\inject_pet.js
) else (
  echo   [!] 当前尚未检测到 DevToolsActivePort（新版 Antigravity 默认或自动更新后未开启 CDP 端口）。
  echo.
  echo   请按以下两步操作即可恢复显示：
  echo      1. 完全退出当前 Antigravity（菜单 File -^> Exit 或关闭所有窗口）；
  echo      2. 从桌面或开始菜单快捷方式重新打开 Antigravity。
  echo.
  echo   重启后如未自动显示，双击 start_pet.bat 即可立即挂载！
)

echo.
pause
