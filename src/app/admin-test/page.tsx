// src/app/admin-test/page.tsx
'use client';

import { useState, useEffect } from 'react';

interface TestResult {
  name: string;
  url: string;
  expected: string;
  actual: string;
  status: 'pass' | 'fail' | 'pending' | 'error';
  message?: string;
}

interface TestGroup {
  title: string;
  icon: string;
  tests: Omit<TestResult, 'actual' | 'status'>[];
}

const testGroups: TestGroup[] = [
  {
    title: '🔐 认证系统',
    icon: '🔐',
    tests: [
      { name: '登录页面', url: '/admin-login', expected: '200' },
      { name: 'Dashboard (未登录)', url: '/admin', expected: '307' },
      { name: 'Session 检查', url: '/api/admin/session', expected: '200|401' },
      { name: 'Login API', url: '/api/admin/login', expected: '400|401' },
    ],
  },
  {
    title: '📊 核心页面',
    icon: '📊',
    tests: [
      { name: 'Dashboard', url: '/admin', expected: '200' },
      { name: '用户列表', url: '/admin/users', expected: '200' },
      { name: '匹配列表', url: '/admin/matches', expected: '200' },
      { name: '订阅管理', url: '/admin/subscriptions', expected: '200' },
    ],
  },
  {
    title: '📈 数据分析',
    icon: '📈',
    tests: [
      { name: 'Analytics概览', url: '/admin/analytics', expected: '200' },
      { name: 'Events事件', url: '/admin/analytics/events', expected: '200' },
      { name: 'Funnel漏斗', url: '/admin/analytics/funnel', expected: '200' },
      { name: 'Retention留存', url: '/admin/analytics/retention', expected: '200' },
      { name: 'Realtime实时', url: '/admin/analytics/realtime', expected: '200' },
    ],
  },
  {
    title: '👥 用户管理',
    icon: '👥',
    tests: [
      { name: '用户详情页', url: '/admin/users/test-id', expected: '200' },
      { name: '用户回收站', url: '/api/admin/users/trash', expected: '200' },
    ],
  },
  {
    title: '💕 匹配与订阅',
    icon: '💕',
    tests: [
      { name: '匹配详情API', url: '/api/admin/matches', expected: '200' },
      { name: '订阅API', url: '/api/admin/subscriptions', expected: '200' },
    ],
  },
  {
    title: '⚙️ 设置与权限',
    icon: '⚙️',
    tests: [
      { name: '系统设置', url: '/admin/settings', expected: '200' },
      { name: '管理员列表', url: '/admin/settings/admins', expected: '200' },
      { name: '角色配置', url: '/admin/settings/roles', expected: '200' },
      { name: '审计日志', url: '/admin/settings/audit', expected: '200' },
      { name: 'RBAC权限', url: '/admin/settings/rbac', expected: '200' },
      { name: '旧路由-审计', url: '/admin/audit', expected: '307' },
      { name: '旧路由-RBAC', url: '/admin/rbac', expected: '307' },
    ],
  },
  {
    title: '📝 内容与营销',
    icon: '📝',
    tests: [
      { name: '内容管理', url: '/admin/content', expected: '200' },
      { name: '营销工具', url: '/admin/marketing', expected: '200' },
      { name: '功能开关', url: '/admin/features', expected: '200' },
      { name: '告警系统', url: '/admin/alerts', expected: '200' },
      { name: '审核工作站', url: '/admin/review', expected: '200' },
    ],
  },
  {
    title: '🔌 API端点',
    icon: '🔌',
    tests: [
      { name: 'Dashboard Summary', url: '/api/admin/dashboard/summary', expected: '200' },
      { name: 'Users API', url: '/api/admin/users', expected: '200' },
      { name: 'Alerts API', url: '/api/admin/alerts', expected: '200' },
      { name: 'Funnel API', url: '/api/admin/analytics/funnel', expected: '200' },
      { name: 'Retention API', url: '/api/admin/analytics/retention', expected: '200' },
      { name: 'RBAC Roles', url: '/api/admin/rbac/roles', expected: '200' },
      { name: 'RBAC Permissions', url: '/api/admin/rbac/permissions', expected: '200' },
      { name: 'Logout', url: '/api/admin/logout', expected: '200|307' },
    ],
  },
  {
    title: '🏥 健康检查',
    icon: '🏥',
    tests: [
      { name: 'Public Health', url: '/api/health', expected: '200' },
      { name: '数据库连接', url: '/api/db-check', expected: '200' },
      { name: 'Auth系统', url: '/api/auth/check-user', expected: '200' },
      { name: 'Bot状态', url: '/api/bots/status', expected: '200' },
    ],
  },
];

export default function AdminTestPage() {
  const [results, setResults] = useState<TestResult[]>([]);
  const [running, setRunning] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [selectedGroups, setSelectedGroups] = useState<Record<string, boolean>>(
    Object.fromEntries(testGroups.map((g) => [g.title, true]))
  );

  const runTest = async (test: Omit<TestResult, 'actual' | 'status'>): Promise<TestResult> => {
    try {
      const startTime = Date.now();
      const response = await fetch(test.url, {
        method: test.url.includes('login') ? 'POST' : 'GET',
        headers: test.url.includes('login') ? { 'Content-Type': 'application/json' } : {},
        body: test.url.includes('login') ? JSON.stringify({ email: 'test@test.com', password: 'wrong' }) : undefined,
      });
      const duration = Date.now() - startTime;
      const actual = response.status.toString();

      const expectedCodes = test.expected.split('|');
      const passed = expectedCodes.includes(actual);

      return {
        ...test,
        actual,
        status: passed ? 'pass' : 'fail',
        message: `${duration}ms`,
      };
    } catch (error: unknown) {
      const err = error as Error;
      return {
        ...test,
        actual: 'ERROR',
        status: 'error',
        message: err.message || 'Network error',
      };
    }
  };

  const runAllTests = async () => {
    setRunning(true);
    setResults([]);

    const allTests = testGroups.flatMap((g) =>
      selectedGroups[g.title] ? g.tests : []
    );

    const newResults: TestResult[] = [];
    for (const test of allTests) {
      const result = await runTest(test);
      newResults.push(result);
      setResults([...newResults]);
    }

    setRunning(false);
  };

  const runGroupTests = async (group: TestGroup) => {
    const groupResults = await Promise.all(
      group.tests.map((t) => runTest(t))
    );
    setResults((prev) => {
      const others = prev.filter((r) => !group.tests.some((t) => t.name === r.name));
      return [...others, ...groupResults];
    });
  };

  const toggleGroup = (title: string) => {
    setCollapsed((prev) => ({ ...prev, [title]: !prev[title] }));
  };

  const copyErrors = () => {
    const errors = results.filter((r) => r.status === 'fail' || r.status === 'error');
    const text = errors
      .map((e) => `[${e.status.toUpperCase()}] ${e.name}\nURL: ${e.url}\n预期: ${e.expected}\n实际: ${e.actual}\n${e.message || ''}`)
      .join('\n\n');

    navigator.clipboard.writeText(text).then(() => {
      alert(`已复制 ${errors.length} 个错误到剪贴板`);
    });
  };

  const stats = {
    total: results.length,
    passed: results.filter((r) => r.status === 'pass').length,
    failed: results.filter((r) => r.status === 'fail').length,
    errors: results.filter((r) => r.status === 'error').length,
    pending: results.filter((r) => r.status === 'pending').length,
  };

  const getGroupResults = (group: TestGroup) => {
    return results.filter((r) => group.tests.some((t) => t.name === r.name));
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-white p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">🔬 Admin Dashboard V4 自动化测试</h1>
          <p className="text-zinc-400">测试 app.lokfeel.com 所有端点</p>
        </div>

        {/* Stats Bar */}
        <div className="bg-zinc-900 rounded-lg p-4 mb-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex gap-6">
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-400">{stats.total}</div>
                <div className="text-xs text-zinc-400">总计</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-400">{stats.passed}</div>
                <div className="text-xs text-zinc-400">通过</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-red-400">{stats.failed + stats.errors}</div>
                <div className="text-xs text-zinc-400">失败</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-yellow-400">{stats.pending}</div>
                <div className="text-xs text-zinc-400">待测</div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={runAllTests}
                disabled={running}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-700 rounded-lg font-medium transition"
              >
                {running ? '⏳ 测试中...' : '▶ 运行全部测试'}
              </button>
              <button
                onClick={copyErrors}
                disabled={stats.failed + stats.errors === 0}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-zinc-700 disabled:opacity-50 rounded-lg font-medium transition"
              >
                📋 复制错误列表
              </button>
            </div>
          </div>

          {/* Progress Bar */}
          {stats.total > 0 && (
            <div className="mt-4">
              <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-green-500 to-blue-500 transition-all duration-300"
                  style={{ width: `${(stats.passed / stats.total) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Test Groups */}
        <div className="space-y-4">
          {testGroups.map((group) => {
            const groupResults = getGroupResults(group);
            const groupStats = {
              total: groupResults.length,
              passed: groupResults.filter((r) => r.status === 'pass').length,
            };

            return (
              <div key={group.title} className="bg-zinc-900 rounded-lg overflow-hidden">
                {/* Group Header */}
                <div
                  className="flex items-center justify-between p-4 cursor-pointer hover:bg-zinc-800 transition"
                  onClick={() => toggleGroup(group.title)}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={selectedGroups[group.title]}
                      onChange={(e) => {
                        e.stopPropagation();
                        setSelectedGroups((prev) => ({
                          ...prev,
                          [group.title]: !prev[group.title],
                        }));
                      }}
                      className="w-4 h-4 rounded bg-zinc-700 border-zinc-600"
                    />
                    <span className="text-xl">{group.icon}</span>
                    <span className="font-medium">{group.title}</span>
                    <span className="text-zinc-500 text-sm">
                      ({groupStats.passed}/{groupStats.total})
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    {selectedGroups[group.title] && groupStats.total > 0 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          runGroupTests(group);
                        }}
                        className="px-3 py-1 text-sm bg-zinc-700 hover:bg-zinc-600 rounded transition"
                      >
                        ▶ 运行
                      </button>
                    )}
                    <span className="text-zinc-500">
                      {collapsed[group.title] ? '▼' : '▲'}
                    </span>
                  </div>
                </div>

                {/* Test List */}
                {!collapsed[group.title] && (
                  <div className="border-t border-zinc-800">
                    <table className="w-full">
                      <thead className="bg-zinc-800/50">
                        <tr className="text-left text-zinc-400 text-sm">
                          <th className="px-4 py-2 w-16">状态</th>
                          <th className="px-4 py-2">测试名称</th>
                          <th className="px-4 py-2">URL</th>
                          <th className="px-4 py-2 w-20">预期</th>
                          <th className="px-4 py-2 w-20">实际</th>
                          <th className="px-4 py-2 w-20">耗时</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.tests.map((test) => {
                          const result = groupResults.find((r) => r.name === test.name);
                          const status = result?.status || 'pending';

                          return (
                            <tr
                              key={test.name}
                              className="border-t border-zinc-800/50 hover:bg-zinc-800/30"
                            >
                              <td className="px-4 py-2">
                                {status === 'pass' && <span className="text-green-400">✅</span>}
                                {status === 'fail' && <span className="text-red-400">❌</span>}
                                {status === 'error' && <span className="text-orange-400">⚠️</span>}
                                {status === 'pending' && <span className="text-zinc-500">⏳</span>}
                              </td>
                              <td className="px-4 py-2 font-medium">{test.name}</td>
                              <td className="px-4 py-2 text-zinc-400 font-mono text-sm">{test.url}</td>
                              <td className="px-4 py-2 text-blue-400">{test.expected}</td>
                              <td className={`px-4 py-2 ${
                                status === 'pass' ? 'text-green-400' :
                                status === 'fail' || status === 'error' ? 'text-red-400' :
                                'text-zinc-500'
                              }`}>
                                {result?.actual || '-'}
                              </td>
                              <td className="px-4 py-2 text-zinc-500 text-sm">
                                {result?.message || '-'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
