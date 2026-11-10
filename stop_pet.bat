@echo off
chcp 65001 >nul
echo 正在关闭星星猫娘桌面挂件...
taskkill /F /IM pythonw.exe /FI "WINDOWTITLE eq Gemini Star Catgirl*" >nul 2>&1
wmic process where "commandline like '%%desktop_pet.py%%'" delete >nul 2>&1
echo 已关闭桌宠。
timeout /t 1 >nul
exit
