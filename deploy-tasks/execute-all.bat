@echo off
setlocal EnableExtensions

cd /d "D:\HongQiang-Project\HongQiang-Project\20260402202519\nexus-app"

REM Define paths
set "NODE_PATH=C:\nodejs\node-v22.13.1-win-x64"
set "PROJECT_DIR=D:\HongQiang-Project\HongQiang-Project\20260402202519\nexus-app"
set "BIN_DIR=%PROJECT_DIR%\node_modules\.bin"
set "SCHEMA_PATH=%PROJECT_DIR%\prisma\schema.prisma"

REM Redirect all output to log file
set "LOG_FILE=%PROJECT_DIR%\deploy-log.txt"

echo Starting deployment at %date% %time% > "%LOG_FILE%"
echo Current directory: %CD% >> "%LOG_FILE%"
echo Schema path: %SCHEMA_PATH% >> "%LOG_FILE%"
echo.

echo ===========================================
echo [1/4] Generating Prisma Client...
echo ===========================================
echo [1/4] Generating Prisma Client... >> "%LOG_FILE%"
call "%BIN_DIR%\prisma.cmd" generate --schema="%SCHEMA_PATH%" >> "%LOG_FILE%" 2>&1
set GEN_RESULT=%ERRORLEVEL%
echo Prisma generate exit code: %GEN_RESULT% >> "%LOG_FILE%"
if %GEN_RESULT% NEQ 0 (
    echo Prisma generate failed!
    goto :error
)
echo.

echo ===========================================
echo [2/4] Applying Database Migrations...
echo ===========================================
echo [2/4] Applying Database Migrations... >> "%LOG_FILE%"
call "%BIN_DIR%\prisma.cmd" migrate deploy --schema="%SCHEMA_PATH%" >> "%LOG_FILE%" 2>&1
set MIG_RESULT=%ERRORLEVEL%
echo Prisma migrate exit code: %MIG_RESULT% >> "%LOG_FILE%"
if %MIG_RESULT% NEQ 0 (
    echo Migration failed! Trying db push as fallback... >> "%LOG_FILE%"
    call "%BIN_DIR%\prisma.cmd" db push --schema="%SCHEMA_PATH%" --skip-generate --force >> "%LOG_FILE%" 2>&1
    set PUSH_RESULT=%ERRORLEVEL%
    echo Prisma db push exit code: %PUSH_RESULT% >> "%LOG_FILE%"
    if %PUSH_RESULT% NEQ 0 (
        echo Database update failed!
        goto :error
    )
)
echo.

echo ===========================================
echo [3/4] Building Project...
echo ===========================================
echo [3/4] Building Project... >> "%LOG_FILE%"
call "%NODE_PATH%\npm.cmd" run build >> "%LOG_FILE%" 2>&1
set BUILD_RESULT=%ERRORLEVEL%
echo Build exit code: %BUILD_RESULT% >> "%LOG_FILE%"
if %BUILD_RESULT% NEQ 0 (
    echo Build failed!
    goto :error
)
echo.

echo ===========================================
echo [4/4] Deploying to Vercel...
echo ===========================================
echo [4/4] Deploying to Vercel... >> "%LOG_FILE%"
call vercel --prod >> "%LOG_FILE%" 2>&1
set VERCE_RESULT=%ERRORLEVEL%
echo Vercel exit code: %VERCE_RESULT% >> "%LOG_FILE%"
if %VERCE_RESULT% NEQ 0 (
    echo Vercel deployment failed!
    goto :error
)
echo.

echo ===========================================
echo All tasks completed successfully!
echo ===========================================
echo Deployment completed at %date% %time% >> "%LOG_FILE%"
goto :end

:error
echo ===========================================
echo Task failed with error!
echo ===========================================
echo Deployment failed at %date% %time% >> "%LOG_FILE%"
exit /b 1

:end
endlocal
