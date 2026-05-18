/**
 * API请求工具 — 带超时和重试逻辑
 * 
 * 功能：
 * - 可配置超时时间（默认10秒）
 * - 指数退避重试（默认3次）
 * - 慢网络环境优化
 * - 自动超时取消请求
 */

export interface FetchWithRetryOptions extends RequestInit {
  timeout?: number;      // 超时时间（毫秒），默认10000
  retries?: number;       // 重试次数，默认3
  retryDelay?: number;    // 初始重试延迟（毫秒），默认1000
  onRetry?: (attempt: number, error: Error) => void;  // 重试回调
}

/**
 * 带超时和重试的fetch包装器
 */
export async function fetchWithRetry(
  url: string,
  options: FetchWithRetryOptions = {}
): Promise<Response> {
  const {
    timeout = 10000,
    retries = 3,
    retryDelay = 1000,
    onRetry,
    ...fetchOptions
  } = options;

  let lastError: Error = new Error("Unknown error");

  for (let attempt = 0; attempt <= retries; attempt++) {
    // 创建AbortController用于超时控制
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // 如果是网络错误，重试
      if (!response.ok && response.status >= 500 && attempt < retries) {
        throw new Error(`Server error: ${response.status}`);
      }

      return response;
    } catch (error: any) {
      clearTimeout(timeoutId);
      lastError = error;

      // 判断是否应该重试
      const shouldRetry = 
        attempt < retries && 
        (error.name === "AbortError" ||  // 超时
         error.name === "TypeError" ||     // 网络错误
         error.message?.includes("Failed to fetch"));

      if (shouldRetry) {
        // 计算退避延迟：retryDelay * 2^attempt
        const delay = retryDelay * Math.pow(2, attempt);
        
        if (onRetry) {
          onRetry(attempt + 1, error);
        }

        console.warn(
          `[fetchWithRetry] Attempt ${attempt + 1}/${retries} failed, retrying in ${delay}ms...`,
          { url, error: error.message }
        );

        await sleep(delay);
        continue;
      }

      // 不重试，抛出错误
      throw error;
    }
  }

  throw lastError;
}

/**
 * Sleep工具函数
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 带超时的fetch（无重试）
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number } = {}
): Promise<Response> {
  const { timeout = 10000, ...fetchOptions } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * 检查网络状况
 */
export function getNetworkStatus(): {
  isOnline: boolean;
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
} {
  if (typeof navigator === "undefined") {
    return { isOnline: true };
  }

  const connection = (navigator as any).connection;
  
  return {
    isOnline: navigator.onLine,
    effectiveType: connection?.effectiveType,  // 'slow-2g', '2g', '3g', '4g'
    downlink: connection?.downlink,            // Mbps
    rtt: connection?.rtt,                     // ms
  };
}

/**
 * 根据网络状况动态调整超时时间
 */
export function getAdaptiveTimeout(baseTimeout: number = 10000): number {
  if (typeof navigator === "undefined") {
    return baseTimeout;
  }

  const connection = (navigator as any).connection;
  if (!connection) {
    return baseTimeout;
  }

  // 慢网络增加超时时间
  switch (connection.effectiveType) {
    case "slow-2g":
      return baseTimeout * 3;  // 30秒
    case "2g":
      return baseTimeout * 2;  // 20秒
    case "3g":
      return baseTimeout * 1.5; // 15秒
    default:
      return baseTimeout;        // 10秒
  }
}
