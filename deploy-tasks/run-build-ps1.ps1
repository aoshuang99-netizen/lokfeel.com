$node = "C:\nodejs\node-v22.13.1-win-x64\node.exe"
$prisma = "D:\HongQiang-Project\HongQiang-Project\20260402202519\nexus-app\node_modules\prisma\build\index.js"
$next = "D:\HongQiang-Project\HongQiang-Project\20260402202519\nexus-app\node_modules\next\dist\bin\next"
$schema = "D:\HongQiang-Project\HongQiang-Project\20260402202519\nexus-app\prisma\schema.prisma"

Write-Host "Running Prisma generate..." -ForegroundColor Cyan
& $node $prisma generate --schema=$schema 2>&1 | Tee-Object -FilePath "C:\Users\AS\Desktop\prisma-output.txt"

Write-Host "Running Next.js build..." -ForegroundColor Cyan
& $node $next build 2>&1 | Tee-Object -FilePath "C:\Users\AS\Desktop\build-output.txt"

Write-Host "Build complete. Check C:\Users\AS\Desktop\build-output.txt for results." -ForegroundColor Green
