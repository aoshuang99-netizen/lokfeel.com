"use client";

/**
 * ✅ [P1-6 阶段 4 — 前端已换源至 IM] 聊天详情页。
 *
 * 方案 A（2026-09-27 确认，见 docs/CHAT-MERGE-AUDIT.md §4）确定 IM（Conversation + IMMessage）
 * 为终局消息模型。阶段 4 的改造原则是「**保留已验证的 UI 外壳，只替换数据源**」——
 * 避免同时引入「未验证的新 UI」+「数据源变更」两层风险（见 §10：IM 侧的 chat-container.tsx
 * 因混用 socket.io 与 Pusher 两套实时通道而始终未能上线，不采用它）。
 *
 * 本文件的阶段 4 变更：
 *   1. 会话头信息：`/api/chat/${roomId}`（三级回退链）→ `/api/im/conversations/${roomId}`
 *      单次调用。后者同时接受 Conversation.id 与 ChatRoom.id，**前端不再需要猜 id**，
 *      也修掉了原回退链的真实缺陷：用第 51 个之后的会话打开详情时，第二级回退
 *      （拉全量列表遍历查找，take:50）恒失败。
 *   2. 读消息：`/api/chat/${roomId}/messages` → `/api/im/messages/${conversationId}`，
 *      形状经 `@/lib/chat/adapter` 适配为 UI 原有 Message 接口，渲染代码零改动。
 *      轮询改为 **seq 增量**（`afterSeq`），替代原来的每 5 秒全量重拉。
 *   3. 发消息：`/api/chat/${roomId}/messages` → `/api/im/send`（带 clientMsgId 幂等）。
 *   4. 打开会话即标记已读（`POST /api/im/conversations/${id}`）——
 *      改造前的详情页从不标记已读，导致列表未读徽章只增不减。
 *   5. 视频通话接线（`NEXT_PUBLIC_ENABLE_VIDEO_CALL=1` 时启用），见文件末尾。
 *
 * 即日起冻结：禁止在本文件新增聊天功能。新增能力一律通过 IM 侧实现（阶段 5 本文件将
 * 被 IM 原生 UI 取代）。保留 `[roomId]` 目录名与路由参数名不变，以免破坏既有链接与书签。
 */
import { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { CardVerificationWall } from "@/components/payment/CardVerificationWall";
import { toUiMessage, toUiMessages, maxSeq } from "@/lib/chat/adapter";
import { VideoCallModal } from "@/components/video-call/VideoCallModal";
import { useVideoCallStore } from "@/store/videoCallStore";
import {
  ArrowLeft,
  MoreVertical,
  Phone,
  Video,
  Image as ImageIcon,
  Mic,
  Send,
  Smile,
  Sparkles,
  Clock,
  Lock,
  Zap,
  X,
  ShieldAlert,
  Ban,
  ChevronRight,
  Circle,
  Bot,
  User,
  RefreshCw,
  Loader2,
} from "lucide-react";
import Link from "next/link";
import { isBrokenAvatarUrl, getAvatarKind, parseEmojiAvatar, getRealPhotoAvatarUrl } from "@/lib/avatar-utils";
import { ReportModal } from "@/components/chat/report-modal";
import { QUICK_REPLIES, AI_SUGGESTIONS } from "@/constants";

// ══════════════════════════════════════
// EMOJI LIST
// ══════════════════════════════════════

const EMOJIS = [
  "😀", "😂", "🥰", "😍", "😘", "😊", "😉", "🤔",
  "😎", "🥳", "😏", "😌", "😢", "😭", "😤", "😡",
  "❤️", "💕", "💖", "💗", "💝", "💘", "🔥", "✨",
  "🌹", "🌸", "🌺", "🌻", "🌙", "⭐", "☀️", "🌈",
];

// ══════════════════════════════════════
// FEATURE FLAG — 视频通话
// ══════════════════════════════════════

/**
 * WebRTC 视频通话开关。
 *
 * 为什么用开关而不是直接启用（这是阶段 4 唯一需要产品决策的项）：
 *   WebRTC 全套实现（`useWebRTC` / `usePusherSignaling` / `VideoCallModal` / `videoCallStore`）
 *   在仓库里是**完整可用**的，但从未接线到任何线上页面（D5）——而它依赖 Pusher 信令通道。
 *   直接默认开启等于把一条从未在线上验证过的链路（信令 + STUN/TURN + 权限申请）一次性推给
 *   全部用户，风险与本次"前端换源"这一目标的收益不成比例。
 *
 * 因此策略是：**接线完成 + 默认关闭**。翻开关只需设置环境变量，无需改代码、无需重新评审：
 *   NEXT_PUBLIC_ENABLE_VIDEO_CALL=1
 *
 * 启用前请先在 staging 验证：Pusher 信令可达、ICE 候选可协商、摄像头权限引导正常
 * （见 docs/IM-UNSHIPPED-FEATURES.md 中 WebRTC 条目）。
 */
const VIDEO_CALL_ENABLED = process.env.NEXT_PUBLIC_ENABLE_VIDEO_CALL === "1";

// ══════════════════════════════════════
// MESSAGE INTERFACE
// ══════════════════════════════════════

interface Message {
  id: string;
  content: string;
  senderId: string;
  sender?: {
    id: string;
    name: string;
    avatar: string | null;
    isBot?: boolean;
    isSelf?: boolean;
  };
  createdAt: string;
  type?: "text" | "image" | "voice";
  metadata?: any;
}

interface RoomInfo {
  id: string;
  otherUser: {
    id: string;
    name: string;
    avatar: string | null;
    isOnline?: boolean;
    lastSeen?: string;
    isBot?: boolean;
  };
  isVault?: boolean;
  vaultExpiresAt?: string;
}

interface UserLimits {
  isPremium: boolean;
  maxChats: number;
  currentChats: number;
  messagesSent: number;
  messagesRemaining: number;
}

/** Reusable inline avatar — replaces 4 duplicate avatar rendering blocks */
function InlineAvatar({ avatar, name, className = "", emojiSize }: {
  avatar: string | null | undefined;
  name: string | undefined;
  className?: string;
  emojiSize?: string;
}) {
  const kind = getAvatarKind(avatar);
  const parsed = parseEmojiAvatar(avatar);

  if (kind === 'emoji' && parsed) {
    return (
      <div className={`w-full h-full bg-gradient-to-br from-amber-500/80 to-rose-500/80 flex items-center justify-center ${className}`}>
        <span className="select-none leading-none" style={{ fontSize: emojiSize || 'clamp(0.9rem, 180%, 1.8rem)', lineHeight: '1' }}>
          {parsed.emoji}
        </span>
      </div>
    );
  }

  // Always use real photo: user photo or gender-aware fallback
  const photoUrl = (kind === 'photo' && avatar && !isBrokenAvatarUrl(avatar))
    ? avatar
    : getRealPhotoAvatarUrl(name || 'default', undefined, 'thumb');
  
  return (
    <img
      src={photoUrl}
      alt={name || "User"}
      className={`w-full h-full object-cover ${className}`}
      crossOrigin="anonymous"
      onError={(e) => {
        const img = e.currentTarget;
        // Prevent infinite loop: only set fallback once
        if (!img.dataset.fallbackApplied) {
          img.dataset.fallbackApplied = 'true';
          img.src = getRealPhotoAvatarUrl(name || 'default', undefined, 'thumb');
        }
      }}
    />
  );
}

/**
 * 判断消息内容是否是可渲染的图片地址。
 *
 * P1-6 阶段 5（G-7）加固：`type === 'image'` 只说明*意图*，并不保证 `content`
 * 一定是地址 —— 历史数据（或客户端直传）里可能存的是任意文本。
 * 若不加判断直接塞进 `<img src>`，浏览器会发起一次必然失败的请求并渲染破图。
 * 因此这里做白名单式判断，非地址一律回退为文本渲染，**不丢内容**。
 */
function isRenderableImageUrl(content: string | null | undefined): boolean {
  if (!content) return false;
  const v = content.trim();
  if (v.length === 0 || v.length > 4096) return false;
  return /^(https?:\/\/|data:image\/|\/)/i.test(v);
}

/**
 * 聊天图片气泡。
 *
 * P1-6 阶段 5（G-7）：改造前 IMAGE 消息与 TEXT 走同一条 `<p>{msg.content}</p>` 路径，
 * 用户看到的是一串裸 URL（见 docs/CHAT-MERGE-AUDIT.md §11.3 G-7）。
 * 这里改为真正的图片渲染，并补齐三件线上必需的事：
 *   · 加载失败 → 降级为可点击链接（而不是破图）
 *   · 点击 → 新标签页打开原图（`noopener noreferrer` 防 tabnabbing）
 *   · 约束尺寸 → 不影响气泡布局与滚动位置
 */
function ChatImageBubble({ src, filename }: { src: string; filename?: string }) {
  const [broken, setBroken] = useState(false);

  if (broken) {
    return (
      <a
        href={src}
        target="_blank"
        rel="noopener noreferrer"
        className="underline text-sm break-all"
      >
        {filename || 'View image'}
      </a>
    );
  }

  return (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg"
    >
      <img
        src={src}
        alt={filename || 'Shared image'}
        loading="lazy"
        decoding="async"
        className="rounded-lg max-w-full max-h-72 w-auto h-auto object-contain bg-black/20"
        onError={() => setBroken(true)}
      />
    </a>
  );
}

export default function ChatRoomPage() {
  const params = useParams();
  const roomId = params.roomId as string;

  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [roomInfo, setRoomInfo] = useState<RoomInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [showAiSuggestions, setShowAiSuggestions] = useState(true);
  const [userLimits, setUserLimits] = useState<UserLimits | null>(null);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showCardVerificationModal, setShowCardVerificationModal] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [isBlocking, setIsBlocking] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [isBotTyping, setIsBotTyping] = useState(false);
  /** 阶段 4：会话统一 id（Conversation.id），由 /api/im/conversations/[id] 解析得到 */
  const [conversationId, setConversationId] = useState<string>("");
  const [showVideoCall, setShowVideoCall] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [sendingImage, setSendingImage] = useState(false);
  const hasInitialLoaded = useRef(false);

  // ══════════════════════════════════════
  // 阶段 4：ref 镜像
  // ══════════════════════════════════════
  // 轮询 effect 的依赖数组刻意只含 [roomId]（避免 roomInfo/messages 每次变化都重建定时器），
  // 因此它调用的 refreshMessages 必须是零依赖的稳定函数，否则会捕获过期闭包。
  // 改造前这里确实存在该缺陷：轮询永远调用首次渲染的版本，导致"用 roomInfo 补全头像"
  // 的逻辑在轮询路径中从不生效（只在首次加载时生效）。
  // 解法：把会变化的值放进 ref，callback 本身依赖数组为空。
  const conversationIdRef = useRef<string>("");
  const roomInfoRef = useRef<RoomInfo | null>(null);
  const currentUserIdRef = useRef<string>("");
  /** 已加载到的最大 seq；0 表示尚未加载，首次走全量 */
  const lastSeqRef = useRef<number>(0);

  // ═══════════════════════════════════════════════════════
  // 阶段 4：数据访问层（IM）
  // 这三个函数刻意用 useCallback 且**声明在 effect 之前**：轮询 effect 依赖它们，
  // 必须引用稳定，否则每次渲染都会重建定时器；且不能在依赖数组里引用 TDZ 变量。
  // ═══════════════════════════════════════════════════════

  /**
   * 标记会话已读。
   * 改造前的详情页从不调用任何已读接口 —— 列表未读徽章因此只增不减。
   * 失败不阻塞主流程（已读属于体验优化，不是数据完整性要求）。
   */
  const markConversationRead = useCallback(async () => {
    const convId = conversationIdRef.current;
    if (!convId) return;
    try {
      await fetch(`/api/im/conversations/${convId}`, { method: "POST" });
    } catch (e) {
      console.warn("[Chat] mark read failed:", e);
    }
  }, []);

  /**
   * 解析会话头信息。
   * `/api/im/conversations/[id]` 同时接受 Conversation.id 与 ChatRoom.id，
   * 因此这里是**单次调用**，取代改造前的三级回退链（那条链在第 51 个之后的会话上恒失效）。
   */
  const loadRoomInfo = useCallback(async () => {
    try {
      const res = await fetch(`/api/im/conversations/${roomId}`);
      if (!res.ok) {
        console.error("[Chat] conversation detail failed:", res.status);
        toast.error("Failed to load chat room");
        return;
      }
      const data = await res.json();

      // 统一 id —— 后续所有 IM 调用都以它为准
      const convId: string = data.conversationId || data.id || roomId;
      conversationIdRef.current = convId;
      setConversationId(convId);

      const info: RoomInfo = {
        id: data.id || convId,
        otherUser: {
          id: data.otherUser?.id || "",
          name: data.otherUser?.name || "Unknown",
          avatar: data.otherUser?.avatar || null,
          isOnline: !!data.otherUser?.isOnline,
          lastSeen: data.otherUser?.lastSeen,
          isBot: !!data.otherUser?.isBot,
        },
        isVault: !!data.isVault,
        vaultExpiresAt: data.vaultExpiresAt,
      };
      roomInfoRef.current = info;
      setRoomInfo(info);
    } catch (e) {
      console.error("[Chat] Failed to load chat room:", e);
      toast.error("Failed to load chat room");
    }
  }, [roomId]);

  /**
   * 拉取消息。`reset=true` 走全量（最近 50 条）；否则按 afterSeq 增量。
   *
   * 为什么增量游标用 seq 而非时间戳：同一毫秒内的多条消息用 `createdAt > lastTs`
   * 比较会漏掉一部分（改造前的注释已指出该问题）。seq 由服务端在事务内单调分配，可靠。
   */
  const refreshMessages = useCallback(async (opts?: { reset?: boolean }) => {
    const convId = conversationIdRef.current;
    if (!convId) return;

    try {
      const reset = !!opts?.reset;
      const afterSeq = reset ? 0 : lastSeqRef.current;

      const url =
        afterSeq > 0
          ? `/api/im/messages/${convId}?afterSeq=${afterSeq}`
          : `/api/im/messages/${convId}`;

      const res = await fetch(url);
      if (!res.ok) {
        const errText = await res.text().catch(() => "Unknown error");
        console.error("[Chat] messages API error:", res.status, errText);
        return;
      }
      const data = await res.json();
      const raw = Array.isArray(data.messages) ? data.messages : [];
      if (raw.length === 0) return;

      // IM 形状 → UI 形状。必须适配：IM 响应没有顶层 senderId 与 sender.isSelf，
      // 缺失会让 isMessageFromMe() 恒为 false —— 所有气泡都会渲染成"对方发的"。
      const mapped = toUiMessages(raw, currentUserIdRef.current || undefined);

      // 头像/昵称补全：IM 的 sender.avatar 取自 profile，可能为空，用对方信息兜底。
      // 语义与改造前的 Legacy 版本一致，未改变渲染结果。
      const other = roomInfoRef.current?.otherUser;
      const enriched = mapped.map((msg) => {
        if (!msg.sender || msg.sender.isSelf) return msg;
        if (!msg.sender.avatar && other?.avatar) {
          return { ...msg, sender: { ...msg.sender, avatar: other.avatar, isBot: other.isBot } };
        }
        return {
          ...msg,
          sender: {
            ...msg.sender,
            name: other?.name || msg.sender.name,
            isBot: other?.isBot,
          },
        };
      });

      if (afterSeq > 0) {
        // 增量：按 id 去重后追加（幂等，重复轮询不会重复渲染）
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          const add = enriched.filter((m) => !seen.has(m.id));
          return add.length > 0 ? [...prev, ...add] : prev;
        });
      } else {
        // 全量：保留尚未落库的乐观消息（temp-），避免被服务端结果抹掉
        setMessages((prev) => {
          const seen = new Set(enriched.map((m) => m.id));
          const keepTemp = prev.filter(
            (m) => m.id.startsWith("temp-") && !seen.has(m.id),
          );
          return keepTemp.length > 0 ? [...enriched, ...keepTemp] : enriched;
        });
      }

      const seq = maxSeq(raw);
      if (seq > lastSeqRef.current) lastSeqRef.current = seq;

      // 推断当前用户 id（IM 响应不直接告知"我是谁"，从 isSelf 反推一次即可）
      if (!currentUserIdRef.current) {
        const self = enriched.find((m) => m.sender?.isSelf);
        if (self?.senderId) currentUserIdRef.current = self.senderId;
      }
    } catch (e) {
      console.error("[Chat] Failed to load messages:", e);
    }
  }, []);

  // ── 初始加载：解析会话 → 拉消息 → 标记已读 ──
  useEffect(() => {
    if (!roomId || hasInitialLoaded.current) return;
    hasInitialLoaded.current = true; // 防止后续渲染重复触发
    setLoading(true);

    (async () => {
      try {
        await loadRoomInfo(); // 先解析出统一 conversationId
        await refreshMessages({ reset: true });
        await markConversationRead(); // 打开即已读（改造前缺失）
      } finally {
        setLoading(false);
      }
    })();

    loadUserLimits();
  }, [roomId, loadRoomInfo, refreshMessages, markConversationRead]);

  // ── 轮询：5s（标签页隐藏时暂停），已改为 seq 增量 ──
  useEffect(() => {
    if (!roomId) return;

    let intervalId: ReturnType<typeof setInterval>;
    let isVisible = true;

    const handleVisibility = () => {
      isVisible = !document.hidden;
      if (isVisible) {
        // Tab became visible - immediately check for new messages
        refreshMessages();
        startPolling();
      } else {
        stopPolling();
      }
    };

    const startPolling = () => {
      stopPolling();
      intervalId = setInterval(() => {
        if (isVisible) refreshMessages();
      }, 5000);
    };

    const stopPolling = () => {
      if (intervalId) clearInterval(intervalId);
    };

    startPolling();
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [roomId, refreshMessages]);

  // Scroll to bottom when messages change
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const loadUserLimits = async () => {
    try {
      const res = await fetch("/api/user/limits");
      if (res.ok) {
        const data = await res.json();
        setUserLimits(data);
      }
    } catch (e) {
      console.error("Failed to load user limits", e);
    }
  };

  const handleSend = async (content: string = newMessage) => {
    if (!content.trim() || sending) return;

    // Check free user limits
    if (userLimits && !userLimits.isPremium && userLimits.messagesRemaining <= 0) {
      setShowUpgradeModal(true);
      return;
    }

    setSending(true);
    setNewMessage("");
    setShowQuickReplies(false);
    setShowEmojiPicker(false);

    // Optimistic update
    const tempId = `temp-${Date.now()}`;
    const tempMessage: Message = {
      id: tempId,
      content,
      senderId: "me",
      sender: {
        id: currentUserId || "me",
        name: "You",
        avatar: null,
        isBot: false,
      },
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempMessage]);

    try {
      const convId = conversationIdRef.current;
      if (!convId) {
        toast.error("Conversation not ready");
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        return;
      }

      // clientMsgId 幂等：网络抖动重试时服务端返回原消息而非新建，避免重复发言
      const clientMsgId = `c-${tempId}`;
      const res = await fetch("/api/im/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: convId, content, clientMsgId }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        console.error('[Chat] Send error:', errData);
        // 错误码契约与改造前一致（/api/im/send 经共享守卫返回同样的 code）
        if (res.status === 403 && errData.code === "CARD_VERIFICATION_REQUIRED") {
          setShowCardVerificationModal(true);
          setMessages((prev) => prev.filter((m) => m.id !== tempId));
          return;
        }
        if (res.status === 403 && errData.code === "UPGRADE_REQUIRED") {
          setShowUpgradeModal(true);
          setMessages((prev) => prev.filter((m) => m.id !== tempId));
          return;
        }
        throw new Error(errData.message || errData.error || "Failed to send");
      }

      const data = await res.json();

      // IM 响应 → UI 形状（补顶层 senderId 与 sender.isSelf，否则气泡会渲染到错误一侧）
      const realMsg: Message = toUiMessage(data.message, currentUserIdRef.current || undefined);

      // 推进 seq 游标，使后续轮询只拉新消息
      if (typeof data.message?.seq === "number" && data.message.seq > lastSeqRef.current) {
        lastSeqRef.current = data.message.seq;
      }
      if (!currentUserIdRef.current && realMsg.senderId) {
        currentUserIdRef.current = realMsg.senderId;
        setCurrentUserId(realMsg.senderId);
      }

      // Replace temp message with real one
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? realMsg : m))
      );

      // Update limits
      if (userLimits) {
        setUserLimits({
          ...userLimits,
          messagesSent: userLimits.messagesSent + 1,
          messagesRemaining: Math.max(0, userLimits.messagesRemaining - 1),
        });
      }

      // Trigger Bot response with typing indicator + 2s delay (simulate real human behavior)
      if (roomInfo?.otherUser?.isBot) {
        console.log('[Chat] Bot conversation detected, showing typing indicator then refreshing for reply');
        // Show typing indicator immediately
        setIsBotTyping(true);
        // Wait 2 seconds before polling for the bot reply (simulate real person reading + typing)
        setTimeout(() => {
          setIsBotTyping(false);
          refreshMessages();
        }, 2000);
      }
    } catch (e) {
      console.error('[Chat] Failed to send:', e);
      toast.error("Failed to send message");
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
    } finally {
      setSending(false);
    }
  };

  const handleBlockUser = async () => {
    if (!roomInfo?.otherUser?.id) return;
    setIsBlocking(true);
    try {
      const res = await fetch(`/api/users/${roomInfo.otherUser.id}/block`, {
        method: "POST",
      });
      if (res.ok) {
        toast.success(`${roomInfo.otherUser.name} has been blocked`);
        setShowMoreMenu(false);
        window.location.href = "/dashboard/chats";
      } else {
        toast.error("Failed to block user");
      }
    } catch (e) {
      toast.error("Failed to block user");
    } finally {
      setIsBlocking(false);
    }
  };

  /**
   * 发起视频通话。
   *
   * 说明：这一步是**功能补全**，不只是"合并" —— WebRTC 全套实现
   * （useWebRTC / usePusherSignaling / VideoCallModal / videoCallStore）此前从未接线到
   * 任何线上页面（审计缺陷 D5），唯一引用方是不曾上线的 chat-container.tsx。
   *
   * 默认关闭：见文件顶部 VIDEO_CALL_ENABLED 的说明。开启方式为设置
   * `NEXT_PUBLIC_ENABLE_VIDEO_CALL=1`（前端可见变量，需重新构建）。
   * 信令走 Pusher（与项目 serverless 部署链兼容）；未配置 Pusher 时会话无法建立，
   * 但不会影响消息收发。
   */
  const startVideoCall = useCallback(() => {
    const targetId = roomInfoRef.current?.otherUser?.id;
    if (!targetId) {
      toast.error("Unable to start call: unknown recipient");
      return;
    }
    setShowVideoCall(true);
    // store 负责 getUserMedia、创建 offer 并发信令
    void useVideoCallStore.getState().initiateCall(targetId);
  }, []);

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatLastSeen = (dateStr?: string) => {
    if (!dateStr) return "Offline";
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  // Determine if a message is from the current user
  const isMessageFromMe = (msg: Message): boolean => {
    if (msg.sender?.isSelf) return true;
    if (msg.senderId === currentUserId) return true;
    if (msg.senderId === "me") return true;
    return false;
  };

  // Determine if a message is from a bot
  const isMessageFromBot = (msg: Message): boolean => {
    if (msg.sender?.isBot) return true;
    if (msg.senderId?.startsWith("bot-") || msg.senderId?.startsWith("bot_")) return true;
    if (msg.senderId === roomInfo?.otherUser?.id && roomInfo?.otherUser?.isBot) return true;
    return false;
  };

  // ═══════════════════════════════════════════════════════
  // LOADING STATE
  // ═══════════════════════════════════════════════════════
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full border-2 border-primary border-t-transparent animate-spin mx-auto mb-4" />
          <p className="text-foreground-muted">Loading conversation...</p>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════
  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background">
      {/* ═══════════════════════════════════════════════════════
          CHAT HEADER
          ═══════════════════════════════════════════════════════ */}
      <div className="flex items-center justify-between px-4 py-3 bg-background-secondary border-b border-card-border flex-shrink-0">
        <div className="flex items-center gap-3">
          {/* Back Button (Mobile) */}
          <Link
            href="/dashboard/chats"
            className="md:hidden p-2 -ml-2 rounded-full hover:bg-background-tertiary"
          >
            <ArrowLeft className="w-5 h-5 text-foreground" />
          </Link>

          {/* Avatar with Online Status */}
          <div className="relative">
            <div className="w-10 h-10 rounded-full overflow-hidden flex items-center justify-center">
              <InlineAvatar avatar={roomInfo?.otherUser?.avatar} name={roomInfo?.otherUser?.name} emojiSize="clamp(1rem, 200%, 2rem)" />
            </div>
            {/* Online Status */}
            {roomInfo?.otherUser?.isOnline ? (
              <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-background-secondary" />
            ) : (
              <div className="absolute bottom-0 right-0 w-3 h-3 bg-foreground-muted/40 rounded-full border-2 border-background-secondary" />
            )}

          </div>

          {/* User Info */}
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-foreground text-sm">
                {roomInfo?.otherUser?.name || "Unknown"}
              </h3>

            </div>
            <p className="text-xs text-foreground-muted">
              {roomInfo?.otherUser?.isOnline 
                ? "Online" 
                : formatLastSeen(roomInfo?.otherUser?.lastSeen)
              }
            </p>
          </div>
        </div>

        {/* Header Actions */}
        <div className="flex items-center gap-1">
          <button disabled className="p-2 rounded-full opacity-40 cursor-not-allowed transition-colors" title="Voice calls coming soon">
            <Phone className="w-5 h-5 text-foreground-muted" />
          </button>
          {VIDEO_CALL_ENABLED ? (
            <button
              onClick={startVideoCall}
              disabled={!roomInfo?.otherUser?.id}
              className="p-2 rounded-full hover:bg-background-tertiary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="Start video call"
            >
              <Video className="w-5 h-5 text-foreground-muted" />
            </button>
          ) : (
            <button disabled className="p-2 rounded-full opacity-40 cursor-not-allowed transition-colors" title="Video calls coming soon">
              <Video className="w-5 h-5 text-foreground-muted" />
            </button>
          )}
          <div className="relative">
            <button
              onClick={() => setShowMoreMenu(!showMoreMenu)}
              className="p-2 rounded-full hover:bg-background-tertiary transition-colors"
            >
              <MoreVertical className="w-5 h-5 text-foreground-muted" />
            </button>

            {/* More Menu Dropdown */}
            <AnimatePresence>
              {showMoreMenu && (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  className="absolute right-0 top-full mt-2 w-48 bg-background-tertiary rounded-xl border border-card-border shadow-xl z-50"
                >
                  <button
                    onClick={() => {
                      setShowReportModal(true);
                      setShowMoreMenu(false);
                    }}
                    className="w-full px-4 py-3 text-left text-sm text-foreground hover:bg-background-tertiary flex items-center gap-2"
                  >
                    <ShieldAlert className="w-4 h-4" />
                    Report User
                  </button>
                  <button
                    onClick={handleBlockUser}
                    disabled={isBlocking}
                    className="w-full px-4 py-3 text-left text-sm text-red-400 hover:bg-background-tertiary flex items-center gap-2"
                  >
                    <Ban className="w-4 h-4" />
                    {isBlocking ? "Blocking..." : "Block User"}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════
          VAULT BANNER (if applicable)
          ═══════════════════════════════════════════════════════ */}
      {roomInfo?.isVault && (
        <div className="bg-gradient-to-r from-primary/20 to-secondary/20 px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-primary" />
            <span className="text-sm text-foreground">
              Vault Chat - Exchange contacts to unlock
            </span>
          </div>
          <div className="flex items-center gap-1 text-sm text-primary">
            <Clock className="w-4 h-4" />
            <span>48h</span>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════
          MESSAGES AREA
          ═══════════════════════════════════════════════════════ */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-16 h-16 rounded-full bg-background-tertiary flex items-center justify-center mb-4">
              {(roomInfo?.otherUser?.isBot) ? (
                <Bot className="w-8 h-8 text-orange-400" />
              ) : (
                <Sparkles className="w-8 h-8 text-foreground-subtle" />
              )}
            </div>
            <p className="text-foreground-muted mb-2">
              {(roomInfo?.otherUser?.isBot)
                ? `Start chatting with ${roomInfo?.otherUser?.name || "them"}`
                : "No messages yet"
              }
            </p>
            <p className="text-foreground-subtle text-sm">
              {(roomInfo?.otherUser?.isBot)
                ? "Say hello and start the conversation!"
                : "Start the conversation!"
              }
            </p>
          </div>
        ) : (
          messages.map((msg, index) => {
            const fromMe = isMessageFromMe(msg);
            const fromBot = isMessageFromBot(msg);
            const showAvatar = !fromMe && (index === 0 || isMessageFromMe(messages[index - 1]));

            return (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex ${fromMe ? "justify-end" : "justify-start"}`}
              >
                <div className={`flex items-end gap-2 max-w-[80%] ${fromMe ? "flex-row-reverse" : ""}`}>
                  {/* Avatar (only show for first message in group) */}
                  {!fromMe && showAvatar && (
                    <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 relative">
                      {roomInfo?.otherUser?.avatar && !isBrokenAvatarUrl(roomInfo.otherUser.avatar) ? (
                        roomInfo.otherUser.avatar.startsWith("emoji:") ? (
                          <div className="w-full h-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
                            <span
                              className="select-none leading-none"
                              style={{
                                fontSize: 'clamp(0.9rem, 180%, 1.8rem)',
                                lineHeight: '1',
                                textAlign: 'center',
                                verticalAlign: 'middle',
                              }}
                            >
                              {roomInfo.otherUser.avatar.split(":")[1]}
                            </span>
                          </div>
                        ) : (
                          <img
                            src={roomInfo.otherUser.avatar}
                            alt={roomInfo.otherUser.name}
                            className="w-full h-full object-cover"
                            onError={(e) => { e.currentTarget.style.display = 'none'; const p = e.currentTarget.parentElement; if (p) { const fb = document.createElement('div'); fb.className = 'w-full h-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-foreground text-xs font-bold'; fb.textContent = roomInfo?.otherUser?.name?.[0] || '?'; p.appendChild(fb); } }}
                          />
                        )
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-foreground text-xs font-bold">
                          {roomInfo?.otherUser?.name?.[0] || "?"}
                        </div>
                      )}
                      {/* Bot indicator on avatar */}
                      {fromBot && (
                        <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-orange-500 rounded-full flex items-center justify-center">
                          <Bot className="w-2 h-2 text-foreground" />
                        </div>
                      )}
                    </div>
                  )}
                  {!fromMe && !showAvatar && <div className="w-8" />}

                  {/* Message Bubble */}
                  <div
                    className={`px-4 py-2.5 rounded-2xl max-w-[75%] ${
                      fromMe
                        ? "bg-gradient-to-br from-purple-700/90 to-purple-600/90 text-foreground rounded-br-md"
                        : fromBot
                        ? "bg-purple-900/30 text-foreground rounded-bl-md border border-purple-500/10"
                        : "bg-primary/10 text-foreground rounded-bl-md"
                    }`}
                  >

                    {/* P1-6 阶段 5（G-7）：图片消息走图片渲染，文本消息保持原样。
                        判断条件是「声明为 image **且** 内容确实是地址」——
                        后者不成立时回退为文本，保证历史脏数据不丢内容。 */}
                    {msg.type === "image" && isRenderableImageUrl(msg.content) ? (
                      <ChatImageBubble src={msg.content.trim()} />
                    ) : (
                      <p className="text-sm leading-relaxed whitespace-pre-wrap break-words [word-break:break-word]">{msg.content}</p>
                    )}
                    <p className={`text-xs mt-1 ${fromMe ? "text-foreground-muted" : "text-foreground-muted"}`}>
                      {formatTime(msg.createdAt)}
                    </p>
                  </div>
                </div>
              </motion.div>
            );
          })
        )}
        {/* Bot typing indicator */}
        <AnimatePresence>
          {isBotTyping && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              className="flex items-center gap-2.5 px-4 py-2"
            >
              <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 relative">
                {roomInfo?.otherUser?.avatar && !isBrokenAvatarUrl(roomInfo.otherUser.avatar) ? (
                  roomInfo.otherUser.avatar.startsWith("emoji:") ? (
                    <div className="w-full h-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
                      <span className="select-none leading-none" style={{ fontSize: 'clamp(0.9rem, 180%, 1.8rem)' }}>
                        {roomInfo.otherUser.avatar.split(":")[1]}
                      </span>
                    </div>
                  ) : (
                    <img src={roomInfo.otherUser.avatar} alt="" className="w-full h-full object-cover" />
                  )
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-foreground text-xs font-bold">
                    {roomInfo?.otherUser?.name?.[0] || "?"}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 bg-purple-900/30 rounded-2xl px-4 py-2.5 border border-purple-500/10">
                <div className="flex items-center gap-[3px]">
                  <span className="w-[5px] h-[5px] bg-foreground-muted rounded-full animate-bounce" style={{ animationDelay: "0ms", animationDuration: "1.4s" }} />
                  <span className="w-[5px] h-[5px] bg-foreground-muted rounded-full animate-bounce" style={{ animationDelay: "150ms", animationDuration: "1.4s" }} />
                  <span className="w-[5px] h-[5px] bg-foreground-muted rounded-full animate-bounce" style={{ animationDelay: "300ms", animationDuration: "1.4s" }} />
                </div>
                <span className="text-[11px] text-foreground-subtle">typing...</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div ref={messagesEndRef} />
      </div>

      {/* ═══════════════════════════════════════════════════════
          AI SUGGESTIONS
          ═══════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {showAiSuggestions && messages.length < 3 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="px-4 py-2 bg-background-secondary border-t border-card-border"
          >
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="text-xs text-foreground-muted">AI Suggestions</span>
              <button
                onClick={() => setShowAiSuggestions(false)}
                className="ml-auto text-foreground-subtle hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
              {AI_SUGGESTIONS.map((suggestion, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSend(suggestion)}
                  className="flex-shrink-0 px-3 py-1.5 bg-background-tertiary hover:bg-background-tertiary rounded-full text-xs text-foreground transition-colors whitespace-nowrap"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══════════════════════════════════════════════════════
          QUICK REPLIES
          ═══════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {showQuickReplies && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="px-4 py-2 bg-background-secondary border-t border-card-border"
          >
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
              {QUICK_REPLIES.map((reply, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSend(reply)}
                  className="flex-shrink-0 px-3 py-1.5 bg-background-tertiary hover:bg-background-tertiary rounded-full text-xs text-foreground transition-colors whitespace-nowrap"
                >
                  {reply}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══════════════════════════════════════════════════════
          EMOJI PICKER
          ═══════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {showEmojiPicker && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="px-4 py-3 bg-background-secondary border-t border-card-border"
          >
            <div className="grid grid-cols-8 gap-2">
              {EMOJIS.map((emoji, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    setNewMessage((prev) => prev + emoji);
                    inputRef.current?.focus();
                  }}
                  className="text-2xl hover:bg-background-tertiary rounded-lg p-1 transition-colors"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══════════════════════════════════════════════════════
          INPUT AREA
          ═══════════════════════════════════════════════════════ */}
      <div className="p-3 bg-background-secondary border-t border-card-border">
        <div className="flex items-center gap-2">
          {/* Emoji Button */}
          <button
            onClick={() => {
              setShowEmojiPicker(!showEmojiPicker);
              setShowQuickReplies(false);
            }}
            className={`p-2 rounded-full transition-colors ${
              showEmojiPicker ? "bg-primary/20 text-primary" : "hover:bg-background-tertiary text-foreground-muted"
            }`}
          >
            <Smile className="w-5 h-5" />
          </button>

          {/* Image Send Button */}
          <button
            onClick={() => imageInputRef.current?.click()}
            disabled={sendingImage}
            className="p-2 rounded-full hover:bg-background-tertiary text-foreground-muted transition-colors disabled:opacity-30"
          >
            {sendingImage ? <Loader2 className="w-5 h-5 animate-spin" /> : <ImageIcon className="w-5 h-5" />}
          </button>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (!file.type.startsWith("image/")) {
                toast.error("Please select an image file");
                return;
              }
              if (file.size > 5 * 1024 * 1024) {
                toast.error("Image must be under 5MB");
                return;
              }
              setSendingImage(true);
              try {
                const formData = new FormData();
                formData.append("file", file);
                const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
                if (!uploadRes.ok) throw new Error("Upload failed");
                const uploadData = await uploadRes.json();
                const imageUrl = uploadData.url || uploadData.imageUrl;
                if (imageUrl) {
                  const convId = conversationIdRef.current;
                  if (!convId) throw new Error("Conversation not ready");
                  const msgRes = await fetch("/api/im/send", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      conversationId: convId,
                      content: imageUrl,
                      msgType: "IMAGE",
                    }),
                  });
                  if (!msgRes.ok) throw new Error("Failed to send image message");
                  await refreshMessages();
                }
              } catch {
                toast.error("Failed to send image");
              } finally {
                setSendingImage(false);
                e.target.value = "";
              }
            }}
          />

          {/* Quick Replies Button */}
          <button
            onClick={() => {
              setShowQuickReplies(!showQuickReplies);
              setShowEmojiPicker(false);
            }}
            className={`p-2 rounded-full transition-colors ${
              showQuickReplies ? "bg-primary/20 text-primary" : "hover:bg-background-tertiary text-foreground-muted"
            }`}
          >
            <Zap className="w-5 h-5" />
          </button>

          {/* Text Input */}
          <div className="flex-1 relative">
            <input
              ref={inputRef}
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Type a message..."
              className="w-full bg-background-tertiary text-foreground placeholder:text-foreground-subtle rounded-full px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          {/* Voice / Send Button */}
          {newMessage.trim() ? (
            <button
              onClick={() => handleSend()}
              disabled={sending}
              className="p-2 rounded-full bg-primary hover:bg-primary-hover text-foreground transition-colors disabled:opacity-50"
            >
              {sending ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </button>
          ) : (
            <button className="p-2 rounded-full hover:bg-background-tertiary text-foreground-muted transition-colors">
              <Mic className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Free User Limit Warning */}
        {userLimits && !userLimits.isPremium && userLimits.messagesRemaining <= 5 && (
          <div className="mt-2 text-center">
            <p className="text-xs text-foreground-muted">
              {userLimits.messagesRemaining} free messages remaining.{" "}
              <button
                onClick={() => setShowUpgradeModal(true)}
                className="text-primary hover:underline"
              >
                Upgrade
              </button>
            </p>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════
          UPGRADE MODAL
          ═══════════════════════════════════════════════════════ */}
      {/* Card Verification Modal */}
      {showCardVerificationModal && (
        <CardVerificationWall
          variant="modal"
          title="Verify Your Card to Continue"
          description="Verify your card to keep chatting — identity check only, no charges."
          onSuccess={() => {
            setShowCardVerificationModal(false);
            toast.success("Card verified! You can now send messages.");
          }}
        />
      )}

      <AnimatePresence>
        {showUpgradeModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-background-tertiary rounded-2xl p-6 max-w-sm w-full border border-card-border"
            >
              <div className="text-center">
                <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-4">
                  <Zap className="w-8 h-8 text-primary" />
                </div>
                <h3 className="text-xl font-bold text-foreground mb-2">
                  Upgrade to Premium
                </h3>
                <p className="text-foreground-muted text-sm mb-6">
                  You&apos;ve used all your free messages. Upgrade to unlock unlimited messaging and more features.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowUpgradeModal(false)}
                    className="flex-1 py-2.5 rounded-xl bg-background-tertiary hover:bg-background-tertiary text-foreground transition-colors"
                  >
                    Maybe Later
                  </button>
                  <button
                    onClick={() => {
                      setShowUpgradeModal(false);
                      window.location.href = "/dashboard/subscription";
                    }}
                    className="flex-1 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-foreground transition-colors"
                  >
                    Upgrade
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Click outside to close menus */}
      {(showMoreMenu || showEmojiPicker || showQuickReplies) && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => {
            setShowMoreMenu(false);
            setShowEmojiPicker(false);
            setShowQuickReplies(false);
          }}
        />
      )}

      {/* Report Modal */}
      <ReportModal
        isOpen={showReportModal}
        onClose={() => setShowReportModal(false)}
        reportedUserId={roomInfo?.otherUser?.id || ""}
        reportedUserName={roomInfo?.otherUser?.name || "User"}
        chatRoomId={roomId}
      />

      {/* ═══════════════════════════════════════════════════════
          VIDEO CALL MODAL（阶段 4 接线，默认关闭）
          仅当 NEXT_PUBLIC_ENABLE_VIDEO_CALL=1 时挂载 —— 关闭时不加载任何 WebRTC 代码路径。
          ═══════════════════════════════════════════════════════ */}
      {VIDEO_CALL_ENABLED && (
        <VideoCallModal
          open={showVideoCall}
          onClose={() => setShowVideoCall(false)}
        />
      )}
    </div>
  );
}
