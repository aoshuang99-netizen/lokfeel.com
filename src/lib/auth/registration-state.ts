/**
 * GA-20 — 注册表单状态的“安全持久化”边界（纯函数，无 IO）。
 *
 * 背景：远端主分支（以及本地候选，直到 GA-20 修复前）的
 * `src/app/(auth)/register/page.tsx` 用 `saveRegState(phase, formData, sentInfo)`
 * 把整个 formData（含 password / dob / gender / sexuality）和 sentInfo.code
 * 序列化进 localStorage，保留 24h —— 明文密码落盘，属 P0 隐私风险。
 *
 * 本模块把“哪些字段可以落盘”收敛到一个白名单边界：
 *   - 写入：`buildPersistableRegState()` 只产出非敏感字段；敏感字段物理上
 *     不进入返回值，因此无论调用方传什么，JSON.stringify 都不含密码/验证码。
 *   - 读取：`parsePersistedRegState()` 同时接受新格式与旧格式（旧版整个
 *     formData 直接塞进 payload），但只挑选白名单字段返回 —— 旧遗留的敏感
 *     缓存即便还在磁盘上，也读不出密码。
 *
 * 这些函数是纯的（时间由调用方注入、无 window 访问），便于 TDD 与回归。
 * 真正的 localStorage IO 仍留在页面组件里，只负责调用这两个函数。
 */

export const REG_STATE_KEY = 'lokfeel_register_state';
/** 持久化信封版本；结构变更时可据此丢弃旧缓存。 */
export const REG_STATE_VERSION = 2;
/** 24 小时，与旧实现一致：过期即丢弃。 */
export const REG_STATE_TTL_MS = 24 * 60 * 60 * 1000;

export type RegPhase = 'form' | 'verify';

/** 表单状态的最小形状：只声明我们会读取的键，其余一律忽略。 */
export interface RegFormLike {
  name?: unknown;
  email?: unknown;
  password?: unknown;
  dob?: unknown;
  gender?: unknown;
  sexuality?: unknown;
  agreeToTerms?: unknown;
  confirmAge?: unknown;
  [key: string]: unknown;
}

export interface RegSentInfoLike {
  maskedIdentifier?: unknown;
  devMode?: unknown;
  code?: unknown;
  [key: string]: unknown;
}

/** 允许落盘的白名单结构 —— 不含 password / dob / gender / sexuality / code。 */
export interface PersistableRegState {
  phase: RegPhase;
  email: string;
  name: string;
  agreeToTerms: boolean;
  confirmAge: boolean;
  sentInfo: { maskedIdentifier: string; devMode: boolean };
  savedAt: number;
}

const SENSITIVE_KEYS = new Set([
  'password',
  'confirmPassword',
  'dob',
  'dateOfBirth',
  'birthDate',
  'gender',
  'sexuality',
  'code',
  'token',
  'autoLoginToken',
  'verificationCode',
]);

/** 弱类型输入收敛为字符串；非字符串一律空串（防对象/数组把内容带进白名单）。 */
function asSafeString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asSafeBool(value: unknown): boolean {
  return value === true;
}

function pickSentInfo(sentInfo: RegSentInfoLike | null | undefined): PersistableRegState['sentInfo'] {
  if (!sentInfo || typeof sentInfo !== 'object') return { maskedIdentifier: '', devMode: false };
  return {
    maskedIdentifier: asSafeString(sentInfo.maskedIdentifier),
    devMode: asSafeBool(sentInfo.devMode),
  };
}

function normalizePhase(value: unknown): RegPhase {
  return value === 'verify' ? 'verify' : 'form';
}

/**
 * 构造可安全落盘的状态。敏感字段（password/dob/gender/sexuality/code/token…）
 * 从不被读取，因此物理上不可能出现在返回值里。
 */
export function buildPersistableRegState(
  phase: RegPhase,
  form: RegFormLike | null | undefined,
  sentInfo: RegSentInfoLike | null | undefined,
  savedAt: number,
): PersistableRegState {
  const f = form && typeof form === 'object' ? form : {};
  return {
    phase: normalizePhase(phase),
    email: asSafeString(f.email),
    name: asSafeString(f.name),
    agreeToTerms: asSafeBool(f.agreeToTerms),
    confirmAge: asSafeBool(f.confirmAge),
    sentInfo: pickSentInfo(sentInfo),
    savedAt: typeof savedAt === 'number' && Number.isFinite(savedAt) ? savedAt : Date.now(),
  };
}

/**
 * 解析持久化状态：新格式直接白名单投影；旧格式（整个 formData/sentInfo）
 * 也只读取其中的非敏感白名单键，敏感数据不会被带入返回对象。
 */
export function parsePersistedRegState(raw: string | null, now: number): PersistableRegState | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const obj = parsed as Record<string, unknown>;

  // 新格式：顶层就是白名单字段（可能带一层 { value, version } 信封）。
  const candidate = (obj.value && typeof obj.value === 'object' && !Array.isArray(obj.value))
    ? (obj.value as Record<string, unknown>)
    : obj;

  // 旧格式：敏感字段藏在 formData / sentInfo 子对象里。
  const legacyForm = (candidate.formData && typeof candidate.formData === 'object')
    ? (candidate.formData as RegFormLike)
    : undefined;
  const legacySent = (candidate.sentInfo && typeof candidate.sentInfo === 'object')
    ? (candidate.sentInfo as RegSentInfoLike)
    : undefined;

  const sourceForm: RegFormLike = legacyForm ?? candidate as RegFormLike;
  const sourceSent: RegSentInfoLike | undefined = legacySent
    ?? (candidate.sentInfo && typeof candidate.sentInfo === 'object'
      ? candidate.sentInfo as RegSentInfoLike
      : undefined);

  const state = buildPersistableRegState(
    normalizePhase(candidate.phase),
    sourceForm,
    sourceSent,
    typeof candidate.savedAt === 'number' ? candidate.savedAt : 0,
  );

  // 过期：savedAt=0（无法判定）或超过 TTL 一律丢弃。
  if (state.savedAt <= 0 || now - state.savedAt > REG_STATE_TTL_MS) return null;
  return state;
}

/**
 * 调试/审计辅助：判断一段原始持久化 JSON 是否含已知敏感键（用于负例断言）。
 * 生产运行路径不依赖它 —— 白名单本身已从源头阻断敏感字段。
 */
export function containsSensitiveKey(raw: string): boolean {
  for (const key of SENSITIVE_KEYS) {
    if (raw.includes(`"${key}"`)) return true;
  }
  return false;
}
