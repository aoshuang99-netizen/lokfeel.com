@echo off
cd /d "D:\HongQiang-Project\HongQiang-Project\20260402202519\nexus-app"
echo Building Next.js project...
call npx next build . 2>&1
echo.
echo Build completed with exit code: %ERRORLEVEL%
pause
