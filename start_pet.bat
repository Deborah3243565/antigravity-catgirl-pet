@echo off
chcp 65001 >nul
title 启动 Gemini 星星猫娘桌宠

cd /d "%~dp0"
echo ==============================================
echo   🌟 Gemini 星星猫娘 · Antigravity 桌宠启动器
echo ==============================================
echo.
echo 正在挂载到 Antigravity 界面右下角...
node scripts\inject_pet.js
echo.
echo [OK] 启动成功！星星猫娘已常驻在 Antigravity 界面右下角。
timeout /t 3 >nul
exit
