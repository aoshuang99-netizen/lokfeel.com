# IM Module API 测试示例

## 前置条件
1. 运行 `npx prisma db push` 应用新的 schema
2. 安装 `@upstash/redis` 和 `jsonwebtoken` 依赖
3. 确保用户已登录（有有效的 session cookie）

---

## 1. 发送消息

```bash
# POST /api/im/send
curl -X POST http://localhost:3000/api/im/send \
  -H "Content-Type: application/json" \
  -H "Cookie: authjs.session-token=YOUR_SESSION_TOKEN" \
  -d '{
    "conversationId": "conv_abc123",
    "content": "Hey, how are you?",
    "msgType": "TEXT",
    "clientMsgId": "client_msg_001"
  }'
```

**预期响应 (200):**
```json
{
  "success": true,
  "message": {
    "msgId": "cm3xyz...",
    "clientMsgId": "client_msg_001",
    "senderId": "user_sender",
    "receiverId": "user_receiver",
    "convId": "conv_abc123",
    "seq": 1,
    "msgType": "TEXT",
    "payload": "Hey, how are you?",
    "encryptionMode": "SERVER",
    "complianceTags": ["pace_ok"],
    "consentState": "CONSENT_GRANTED",
    "mediaLevel": "L0_TEXT",
    "ruleResult": "PASS",
    "isEdited": false,
    "isDeleted": false,
    "status": "SENT",
    "timestamp": 1745068800000
  }
}
```

**频率限制响应 (429):**
```json
{
  "success": false,
  "error": "pace.limit_exceeded",
  "ruleResult": "PACE_LIMIT",
  "paceInfo": {
    "convId": "conv_abc123",
    "cooldownUntil": 1745069100000,
    "reason": "pace.limit_exceeded",
    "messagesRemaining": 0,
    "maxMessages": 20,
    "resetAfterMinutes": 5
  }
}
```

---

## 2. 获取会话列表

```bash
# GET /api/im/conversations
curl -X GET "http://localhost:3000/api/im/conversations?limit=20" \
  -H "Cookie: authjs.session-token=YOUR_SESSION_TOKEN"
```

**预期响应 (200):**
```json
{
  "conversations": [
    {
      "convId": "conv_abc123",
      "otherUser": {
        "id": "user_receiver",
        "name": "Emma",
        "avatar": "https://...",
        "presence": "ONLINE"
      },
      "lastMessage": {
        "content": "Hey, how are you?",
        "senderId": "user_sender",
        "msgType": "TEXT",
        "timestamp": 1745068800000
      },
      "unreadCount": 2,
      "isMuted": false,
      "isPinned": false,
      "state": "ACTIVE",
      "vaultExpiresAt": null
    }
  ],
  "hasMore": false,
  "nextCursor": null
}
```

---

## 3. 获取消息历史

```bash
# GET /api/im/messages/{conversationId}
curl -X GET "http://localhost:3000/api/im/messages/conv_abc123?limit=50" \
  -H "Cookie: authjs.session-token=YOUR_SESSION_TOKEN"
```

**预期响应 (200):**
```json
{
  "messages": [
    {
      "msgId": "cm3xyz...",
      "senderId": "user_sender",
      "receiverId": "user_receiver",
      "convId": "conv_abc123",
      "seq": 1,
      "msgType": "TEXT",
      "payload": "Hey, how are you?",
      "encryptionMode": "SERVER",
      "complianceTags": ["pace_ok"],
      "consentState": "CONSENT_GRANTED",
      "mediaLevel": "L0_TEXT",
      "ruleResult": "PASS",
      "isEdited": false,
      "isDeleted": false,
      "status": "SENT",
      "timestamp": 1745068800000
    }
  ],
  "hasMore": false,
  "nextCursor": null
}
```

---

## 4. 标记已读

```bash
# POST /api/im/read
curl -X POST http://localhost:3000/api/im/read \
  -H "Content-Type: application/json" \
  -H "Cookie: authjs.session-token=YOUR_SESSION_TOKEN" \
  -d '{
    "conversationId": "conv_abc123",
    "upToMsgId": "cm3xyz..."
  }'
```

**预期响应 (200):**
```json
{
  "success": true,
  "readCount": 3
}
```

---

## 5. 同意管理

### 5.1 请求同意（发送图片）
```bash
# POST /api/im/consent (request)
curl -X POST http://localhost:3000/api/im/consent \
  -H "Content-Type: application/json" \
  -H "Cookie: authjs.session-token=YOUR_SESSION_TOKEN" \
  -d '{
    "action": "request",
    "targetId": "user_receiver",
    "conversationId": "conv_abc123",
    "consentType": "MEDIA",
    "requestedLevel": "L1_IMAGE",
    "reason": "I would like to share a photo with you"
  }'
```

### 5.2 响应同意请求
```bash
# POST /api/im/consent (respond)
curl -X POST http://localhost:3000/api/im/consent \
  -H "Content-Type: application/json" \
  -H "Cookie: authjs.session-token=YOUR_SESSION_TOKEN" \
  -d '{
    "action": "respond",
    "requestId": "consent_req_123",
    "decision": "CONSENT_GRANTED",
    "validUntil": 0
  }'
```

### 5.3 查询同意状态
```bash
# GET /api/im/consent
curl -X GET "http://localhost:3000/api/im/consent?targetId=user_receiver&consentType=MEDIA" \
  -H "Cookie: authjs.session-token=YOUR_SESSION_TOKEN"
```

---

## 6. 在线状态

### 6.1 批量获取在线状态
```bash
# GET /api/im/presence
curl -X GET "http://localhost:3000/api/im/presence?userIds=user1,user2,user3" \
  -H "Cookie: authjs.session-token=YOUR_SESSION_TOKEN"
```

### 6.2 更新自己状态
```bash
# POST /api/im/presence
curl -X POST http://localhost:3000/api/im/presence \
  -H "Content-Type: application/json" \
  -H "Cookie: authjs.session-token=YOUR_SESSION_TOKEN" \
  -d '{
    "status": "AWAY",
    "statusMessage": "In a meeting"
  }'
```

---

## 依赖安装

```bash
# 安装 Upstash Redis SDK
npm install @upstash/redis

# 安装 JSON Web Token（WebSocket 认证）
npm install jsonwebtoken @types/jsonwebtoken

# 应用新的 Prisma Schema
npx prisma db push

# 重新生成 Prisma Client
npx prisma generate
```

---

## WebSocket 连接测试

```javascript
// 客户端连接示例（浏览器）
const ws = new WebSocket('ws://localhost:3001/ws/im');

ws.onopen = () => {
  // 发送认证
  ws.send(JSON.stringify({
    eventId: 'auth_1',
    eventType: 'presence_update',
    timestamp: Date.now(),
    payload: {
      status: 'ONLINE',
      token: 'YOUR_JWT_TOKEN'
    }
  }));
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Received:', data.eventType, data);
};

// 订阅会话
ws.send(JSON.stringify({
  eventId: 'sub_1',
  eventType: 'subscribe',
  timestamp: Date.now(),
  payload: {
    convId: 'conv_abc123'
  }
}));

// 发送打字指示器
ws.send(JSON.stringify({
  eventId: 'typing_1',
  eventType: 'typing',
  timestamp: Date.now(),
  payload: {
    convId: 'conv_abc123',
    isTyping: true
  }
}));
```
