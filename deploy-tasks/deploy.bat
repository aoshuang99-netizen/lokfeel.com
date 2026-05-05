@echo off
REM ===========================================
REM Nexus App - 完整部署脚本
REM ===========================================

echo ===========================================
echo Nexus App 部署脚本
echo ===========================================

REM 1. 进入项目目录
cd /d "%~dp0"

echo.
echo [1/6] 安装依赖...
call npm install

echo.
echo [2/6] 生成 Prisma 客户端...
call npx prisma generate

echo.
echo [3/6] 推送数据库 Schema 到 Turso...
call npx prisma db push

echo.
echo [4/6] 构建项目...
call npm run build

echo.
echo [5/6] 登录 Vercel (如果没有登录)...
call vercel login

echo.
echo [6/6] 部署到 Vercel...
call vercel --prod

echo.
echo ===========================================
echo 部署完成！
echo ===========================================
pause
