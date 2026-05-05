@echo off
REM ===========================================
REM 数据库 Schema 推送脚本
REM 将 Prisma Schema 推送到 Turso 数据库
REM ===========================================

echo ===========================================
echo 推送数据库 Schema 到 Turso
echo ===========================================

cd /d "%~dp0"

echo.
echo [1/3] 生成 Prisma 客户端...
call npx prisma generate

echo.
echo [2/3] 推送 Schema 到 Turso 数据库...
call npx prisma db push

echo.
echo [3/3] 验证数据库连接...
call npx prisma studio

echo.
echo ===========================================
echo 数据库 Schema 推送完成！
echo ===========================================
pause
