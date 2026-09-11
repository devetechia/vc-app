@echo off
cd /d "%~dp0"
echo ========================================
echo  Academia Biblica - Vida Cristiana
echo ========================================
echo.
echo Iniciando servidor...
echo.

start "Academia Biblica (Puerto 5000)" python server.py
timeout /t 2 >nul
start http://localhost:5000

echo.
echo Academia abierta en: http://localhost:5000
echo API Healthcheck en:  http://localhost:5000/api/health
echo.
echo Para detener, cierra la ventana del servidor o ejecuta:
echo taskkill /F /IM python.exe
echo.
pause
