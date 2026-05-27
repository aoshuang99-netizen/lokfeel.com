"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";

/**
 * Google OAuth 终极调试页面
 * 
 * 捕获所有错误并显示，帮助诊断为什么 Google OAuth 从不工作
 */
export default function GoogleOAuthDebugPage() {
  const [logs, setLogs] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [config, setConfig] = useState<any>(null);
  const [testResult, setTestResult] = useState<string>("");

  const addLog = useCallback((message: string) => {
    console.log(`[Google OAuth Debug] ${message}`);
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  }, []);

  const addError = useCallback((message: string, error?: any) => {
    console.error(`[Google OAuth Debug] ❌ ${message}`, error);
    setErrors(prev => [...prev, `[${new Date().toLocaleTimeString()}] ❌ ${message}${error ? `: ${JSON.stringify(error)}` : ''}`]);
  }, []);

  // 捕获所有 JavaScript 错误
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      addError(`JavaScript 错误: ${event.message}`, {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: event.error?.stack,
      });
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      addError(`未处理的 Promise 拒绝: ${event.reason}`, event.reason);
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, [addError]);

  // 检查配置
  const checkConfig = async () => {
    addLog("开始检查 Google OAuth 配置...");
    try {
      const res = await fetch('/api/debug/google-oauth-check');
      const data = await res.json();
      setConfig(data);
      addLog(`配置检查完成: ${data.summary.allConfigured ? '✅ 已配置' : '❌ 未配置'}`);
      
      if (!data.summary.allConfigured) {
        addError("Google OAuth 配置不完整", data);
      }
    } catch (err: any) {
      addError("配置检查失败", err);
    }
  };

  // 测试 signin 端点
  const testSignin = async () => {
    addLog("开始测试 Google OAuth signin 端点...");
    try {
      const res = await fetch('/api/auth/oauth/google/signin?callbackUrl=/dashboard', {
        method: 'GET',
        redirect: 'manual',
      });
      
      addLog(`Signin 端点返回: ${res.status} ${res.statusText}`);
      
      if (res.status === 307 || res.status === 302) {
        const location = res.headers.get('location');
        addLog(`✅ 正确重定向到 Google: ${location?.substring(0, 100)}...`);
        setTestResult(`✅ Signin 端点工作正常！\n\n重定向到: ${location}`);
      } else {
        addError(`Unexpected status: ${res.status}`);
        const text = await res.text();
        addError("Response body", text.substring(0, 500));
      }
    } catch (err: any) {
      addError("Signin 端点测试失败", err);
    }
  };

  // 实际测试 Google OAuth 登录
  const testGoogleLogin = () => {
    addLog("开始 Google OAuth 登录测试...");
    addLog("即将重定向到: /api/auth/oauth/google/signin?callbackUrl=/debug/google-oauth");
    addLog("请在重定向后，检查 URL 中是否有 error 参数");
    
    // 监听 beforeunload 以确保日志已保存
    window.addEventListener('beforeunload', () => {
      localStorage.setItem('google-oauth-debug-logs', JSON.stringify(logs));
      localStorage.setItem('google-oauth-debug-errors', JSON.stringify(errors));
    });

    // 重定向到 Google OAuth signin
    window.location.href = '/api/auth/oauth/google/signin?callbackUrl=' + encodeURIComponent('/debug/google-oauth');
  };

  // 检查 URL 中的错误参数
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get('error');
    const errorDescription = params.get('error_description');
    const errorId = params.get('errorId');

    if (error) {
      addError(`Google OAuth 返回错误: ${error}`, {
        error_description: errorDescription,
        errorId,
      });
    }
  }, [addError]);

  // 加载时自动检查配置
  useEffect(() => {
    checkConfig();
  }, [checkConfig]);

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2 font-display">
            🔍 Google OAuth 终极调试
          </h1>
          <p className="text-foreground-muted">
            此页面捕获所有错误，帮助诊断为什么 Google OAuth 从不工作
          </p>
        </div>

        {/* 操作按钮 */}
        <div className="flex flex-wrap gap-3 justify-center">
          <Button onClick={checkConfig} variant="outline">
            📋 检查配置
          </Button>
          <Button onClick={testSignin} variant="outline">
            🧪 测试 Signin 端点
          </Button>
          <Button onClick={testGoogleLogin} variant="default">
            🚀 实际测试 Google 登录
          </Button>
        </div>

        {/* 配置状态 */}
        {config && (
          <div className="bg-background-secondary rounded-2xl p-6 border border-card-border">
            <h2 className="text-xl font-bold text-foreground mb-4">⚙️ 配置状态</h2>
            <pre className="text-sm overflow-auto bg-background-tertiary p-4 rounded-xl">
              {JSON.stringify(config, null, 2)}
            </pre>
          </div>
        )}

        {/* 测试结果 */}
        {testResult && (
          <div className="bg-background-secondary rounded-2xl p-6 border border-card-border">
            <h2 className="text-xl font-bold text-foreground mb-4">🧪 测试结果</h2>
            <pre className="text-sm overflow-auto bg-background-tertiary p-4 rounded-xl whitespace-pre-wrap">
              {testResult}
            </pre>
          </div>
        )}

        {/* 错误日志 */}
        {errors.length > 0 && (
          <div className="bg-error-muted rounded-2xl p-6 border border-error-border">
            <h2 className="text-xl font-bold text-error mb-4">❌ 错误日志 ({errors.length})</h2>
            <div className="space-y-2">
              {errors.map((error, i) => (
                <div key={i} className="text-sm font-mono bg-background-tertiary p-3 rounded-lg">
                  {error}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 所有日志 */}
        <div className="bg-background-secondary rounded-2xl p-6 border border-card-border">
          <h2 className="text-xl font-bold text-foreground mb-4">📝 所有日志 ({logs.length})</h2>
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {logs.map((log, i) => (
              <div key={i} className="text-sm font-mono text-foreground-muted">
                {log}
              </div>
            ))}
          </div>
        </div>

        {/* 操作指南 */}
        <div className="bg-primary/10 rounded-2xl p-6 border border-primary/20">
          <h2 className="text-xl font-bold text-foreground mb-4">📖 操作指南</h2>
          <ol className="space-y-2 text-sm text-foreground-muted list-decimal pl-5">
            <li>点击 <strong>检查配置</strong> — 确认 Google OAuth 环境变量已配置</li>
            <li>点击 <strong>测试 Signin 端点</strong> — 确认后端端点工作正常</li>
            <li>点击 <strong>实际测试 Google 登录</strong> — 实际测试完整的 OAuth 流程</li>
            <li>如果出错，<strong>截图此页面</strong>并发送给开发者</li>
            <li>或者点击下面的 <strong>复制日志</strong> 按钮，粘贴到聊天中</li>
          </ol>
          
          <div className="mt-4 flex gap-3">
            <Button 
              onClick={() => {
                const allLogs = [...logs, ...errors].join('\n');
                navigator.clipboard.writeText(allLogs);
                alert('✅ 日志已复制到剪贴板！');
              }}
              variant="outline"
            >
              📋 复制所有日志
            </Button>
            <Button 
              onClick={() => {
                setLogs([]);
                setErrors([]);
                setTestResult("");
                setConfig(null);
              }}
              variant="ghost"
            >
              🗑️ 清除日志
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
