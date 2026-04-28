import { NextResponse } from 'next/server'

/**
 * POST /api/blocked-log
 * 记录被地区限制拦截的访问（轻量级，不依赖数据库）
 * 可用于后续分析拦截频率和路径
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { path, timestamp } = body

    // 在生产环境中，可以将日志发送到 Vercel Logs 或分析服务
    // 当前仅输出到服务器日志
    console.log(`[BLOCKED] Region-blocked access: path=${path}, time=${timestamp}`)

    return NextResponse.json({ logged: true }, { status: 200 })
  } catch {
    return NextResponse.json({ logged: false }, { status: 200 })
  }
}
