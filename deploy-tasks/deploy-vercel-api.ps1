#Requires -Version 5.0
<#
.SYNOPSIS
    Vercel API 部署脚本 - 适用于 CI/CD 环境
.DESCRIPTION
    通过 Vercel REST API 部署应用，支持更高级的部署配置
.EXAMPLE
    .\deploy-vercel-api.ps1 -Token "xxx" -ProjectId "prj_xxx"
#>

param(
    [Parameter(Mandatory)]
    [string]$Token,

    [Parameter()]
    [string]$OrgId = '',

    [Parameter(Mandatory)]
    [string]$ProjectId,

    [Parameter()]
    [string]$TeamId = '',

    [Parameter()]
    [ValidateSet('production', 'preview')]
    [string]$Environment = 'production',

    [Parameter()]
    [string]$GitRef = 'main'
)

$ErrorActionPreference = 'Stop'

# ============================================================
# 配置
# ============================================================
$ApiBase = 'https://api.vercel.com'

function Write-Success { param($Message) Write-Host "[OK] $Message" -ForegroundColor Green }
function Write-Info { param($Message) Write-Host "[INFO] $Message" -ForegroundColor Cyan }
function Write-Err { param($Message) Write-Host "[ERROR] $Message" -ForegroundColor Red }

Write-Host "`n========================================" -ForegroundColor Magenta
Write-Host "  Nexus App - Vercel API Deploy" -ForegroundColor Magenta
Write-Host "========================================`n" -ForegroundColor Magenta

# ============================================================
# 1. 获取项目信息
# ============================================================
Write-Info "获取项目信息..."

$headers = @{
    Authorization = "Bearer $Token"
    'Content-Type' = 'application/json'
}

$projectUrl = "$ApiBase/v9/projects/$ProjectId"
if ($TeamId) {
    $projectUrl += "?teamId=$TeamId"
}

try {
    $project = Invoke-RestMethod -Uri $projectUrl -Headers $headers -Method Get
    Write-Success "项目: $($project.name)"
} catch {
    Write-Err "无法获取项目信息: $_"
    exit 1
}

# ============================================================
# 2. 创建部署
# ============================================================
Write-Info "创建部署..."

$deployBody = @{
    gitSource = @{
        type = 'GitHub'
        repo = "$env:GITHUB_REPOSITORY"
        ref = $GitRef
        sha = "$env:GITHUB_SHA"
    }
    projectId = $ProjectId
} | ConvertTo-Json -Depth 10

$deployUrl = "$ApiBase/v13/deployments"
if ($TeamId) {
    $deployUrl += "?teamId=$TeamId"
}

try {
    $deploy = Invoke-RestMethod -Uri $deployUrl -Headers $headers -Method Post -Body $deployBody
    $deploymentId = $deploy.id
    $deploymentUrl = $deploy.url
    Write-Success "部署创建成功: $deploymentId"
    Write-Host "预览地址: https://$deploymentUrl" -ForegroundColor Cyan
} catch {
    Write-Err "创建部署失败: $_"
    exit 1
}

# ============================================================
# 3. 等待部署完成
# ============================================================
Write-Info "等待部署完成..."

$maxWait = 300  # 5分钟
$elapsed = 0
$interval = 5

while ($elapsed -lt $maxWait) {
    Start-Sleep -Seconds $interval
    $elapsed += $interval

    $statusUrl = "$ApiBase/v13/deployments/$deploymentId"
    if ($TeamId) {
        $statusUrl += "?teamId=$TeamId"
    }

    try {
        $status = Invoke-RestMethod -Uri $statusUrl -Headers $headers -Method Get

        Write-Host "`r等待中... $elapsed 秒 - 状态: $($status.readyState)" -NoNewline

        if ($status.readyState -eq 'READY') {
            Write-Host "`n`n" -NoNewline
            Write-Success "部署完成!"
            Write-Host "生产地址: https://app.lokfeel.com" -ForegroundColor Green
            exit 0
        } elseif ($status.readyState -eq 'ERROR' -or $status.readyState -eq 'CANCELED') {
            Write-Host "`n`n" -NoNewline
            Write-Err "部署失败: $($status.readyState)"
            exit 1
        }
    } catch {
        Write-Warn "检查状态时出错: $_"
    }
}

Write-Err "部署超时 (超过 $maxWait 秒)"
exit 1

# ============================================================
# 4. 输出结果 (作为 GitHub Actions 输出)
# ============================================================
if ($env:GITHUB_OUTPUT) {
    @"
DEPLOYMENT_ID=$deploymentId
DEPLOYMENT_URL=https://$deploymentUrl
"@ | Out-File -FilePath $env:GITHUB_OUTPUT -Encoding utf8 -Append
}
