#Requires -Version 5.0
<#
.SYNOPSIS
    Vercel 部署脚本 - 适用于本地开发环境
.DESCRIPTION
    使用 Vercel CLI 部署应用到 Vercel 平台
.EXAMPLE
    .\deploy-vercel.ps1
    .\deploy-vercel.ps1 -Environment production
    .\deploy-vercel.ps1 -Environment preview -Token "your-token"
#>

param(
    [Parameter()]
    [ValidateSet('production', 'preview')]
    [string]$Environment = 'production',

    [Parameter()]
    [string]$Token = '',

    [Parameter()]
    [switch]$SkipBuild,

    [Parameter()]
    [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = $PSScriptRoot

# 颜色定义
function Write-Success { param($Message) Write-Host "[OK] $Message" -ForegroundColor Green }
function Write-Info { param($Message) Write-Host "[INFO] $Message" -ForegroundColor Cyan }
function Write-Warn { param($Message) Write-Host "[WARN] $Message" -ForegroundColor Yellow }
function Write-Err { param($Message) Write-Host "[ERROR] $Message" -ForegroundColor Red }

Write-Host "`n========================================" -ForegroundColor Magenta
Write-Host "  Nexus App - Vercel Deploy Script" -ForegroundColor Magenta
Write-Host "========================================`n" -ForegroundColor Magenta

# ============================================================
# 1. 检查 Vercel CLI
# ============================================================
Write-Info "检查 Vercel CLI..."
$vercelVersion = vercel --version 2>$null
if (-not $vercelVersion) {
    Write-Info "安装 Vercel CLI..."
    npm install -g vercel
}

# ============================================================
# 2. 登录检查
# ============================================================
Write-Info "检查 Vercel 登录状态..."
if (-not $Token) {
    $Token = Read-Host "请输入 Vercel Token (或直接按 Enter 使用已登录账户)"
}

if ($Token) {
    $env.VERCEL_TOKEN = $Token
}

# ============================================================
# 3. 链接项目 (如果需要)
# ============================================================
Write-Info "链接 Vercel 项目..."
$linkResult = vercel link --yes 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Warn "项目链接可能已存在或失败: $linkResult"
}

# ============================================================
# 4. 本地构建验证
# ============================================================
if (-not $SkipBuild) {
    Write-Info "执行本地构建..."
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Err "构建失败!"
        exit 1
    }
    Write-Success "构建完成"
}

# ============================================================
# 5. 运行测试
# ============================================================
if (-not $SkipTests) {
    Write-Info "运行测试..."
    npm run lint
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Lint 检查失败!"
        exit 1
    }

    npx tsc --noEmit
    if ($LASTEXITCODE -ne 0) {
        Write-Err "TypeScript 类型检查失败!"
        exit 1
    }

    Write-Success "代码检查通过"
}

# ============================================================
# 6. 部署
# ============================================================
Write-Info "开始部署到 $Environment 环境..."

$deployArgs = @()

switch ($Environment) {
    'production' {
        $deployArgs += '--prod'
    }
    'preview' {
        # Preview 环境使用随机域名
    }
}

$deployArgs += '--yes'

$result = vercel deploy $deployArgs 2>&1
$exitCode = $LASTEXITCODE

Write-Host "`n----------------------------------------"
Write-Host "部署输出:" -ForegroundColor Yellow
Write-Host $result
Write-Host "----------------------------------------`n"

if ($exitCode -eq 0) {
    Write-Success "部署成功!"

    if ($Environment -eq 'production') {
        Write-Host "`n生产环境已更新: https://app.lokfeel.com" -ForegroundColor Green
    } else {
        Write-Host "`nPreview 环境已部署" -ForegroundColor Green
    }
} else {
    Write-Err "部署失败! (Exit Code: $exitCode)"
    exit $exitCode
}

# ============================================================
# 7. 生产环境 - 数据库迁移
# ============================================================
if ($Environment -eq 'production') {
    Write-Info "检查是否需要数据库迁移..."

    $migrate = Read-Host "是否执行数据库迁移? (y/N)"

    if ($migrate -eq 'y' -or $migrate -eq 'Y') {
        Write-Info "执行 Prisma 迁移..."
        npx prisma migrate deploy

        if ($LASTEXITCODE -eq 0) {
            Write-Success "数据库迁移完成"
        } else {
            Write-Warn "数据库迁移可能需要检查"
        }
    }
}

Write-Host "`n========================================" -ForegroundColor Magenta
Write-Host "  部署脚本执行完毕" -ForegroundColor Magenta
Write-Host "========================================`n" -ForegroundColor Magenta
