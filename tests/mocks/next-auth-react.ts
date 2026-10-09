/**
 * `next-auth/react` 的测试替身。
 *
 * 为什么需要：`next-auth@5.0.0-beta` 是 **纯 ESM** 包（`"type": "module"`），
 * 而 jest 以 CJS 运行（Node 22 尚不支持 jest 里的 `require(esm)`）。
 * 于是任何 import 到 `next-auth/react` 的模块链在单测里都会直接抛
 * `Must use import to load ES Module`，与"被测逻辑是否正确"完全无关。
 *
 * 这里只提供单测需要的、无副作用的桩实现；真实的会话行为由 E2E 覆盖。
 *
 * @see jest.config.js 的 moduleNameMapper
 */

import { createElement, type ReactNode } from 'react';

export interface MockSession {
  user: { id: string; email?: string | null; name?: string | null };
  expires: string;
}

/** 默认未登录。需要已登录的用例请在自己的文件里 `jest.mock` 覆盖。 */
export function useSession(): {
  data: MockSession | null;
  status: 'loading' | 'authenticated' | 'unauthenticated';
  update: () => Promise<null>;
} {
  return {
    data: null,
    status: 'unauthenticated',
    update: async () => null,
  };
}

export const getSession = async (): Promise<MockSession | null> => null;

export const signIn = async (): Promise<{
  ok: boolean;
  error: null;
  url: null;
}> => ({ ok: true, error: null, url: null });

export const signOut = async (): Promise<{
  ok: boolean;
  error: null;
  url: null;
}> => ({ ok: true, error: null, url: null });

export const SessionProvider = ({ children }: { children?: ReactNode }) =>
  createElement('div', null, children);

const nextAuthReactMock = {
  useSession,
  getSession,
  signIn,
  signOut,
  SessionProvider,
};

export default nextAuthReactMock;
