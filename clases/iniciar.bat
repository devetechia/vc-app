@echo off
cd /d "%~dp0"
echo ========================================
echo  Academia Biblica - Vida Cristiana
echo ========================================
echo.
echo Iniciando servidores...
echo.

start "API - Vida Cristiana (5000)" python server.py
start "Academia - http://localhost:8001" python -m http.server 8001

echo API:      http://localhost:5000/api/health
echo Academia: http://localhost:8001
echo.
echo No cierres las dos ventanas negras mientras uses la academia.
echo Para detener, cierra esas ventanas o ejecuta: taskkill /F /IM python.exe
echo.
pause
