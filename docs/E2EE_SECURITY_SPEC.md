# E2EE 端到端加密安全规范

## 概述

本文档定义 LokFeel IM 模块的端到端加密（E2EE）技术规范，确保女性用户的私密通信内容仅对话双方可见，同时支持合规审计与风险控制。

## 设计原则

### 1. 混合信任模型（Hybrid Trust）

```
┌─────────────────────────────────────────────────────────────┐
│                    混合信任模型架构                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  加密层（E2EE）          明文层（合规）                        │
│  ┌─────────────┐        ┌─────────────┐                      │
│  │ 消息内容     │        │ 边界元数据   │                      │
│  │ 媒体文件     │        │ 合规标签     │                      │
│  │ 位置信息     │        │ 同意状态     │                      │
│  │ 联系方式     │        │ 规则版本     │                      │
│  └─────────────┘        └─────────────┘                      │
│        ↓                      ↓                             │
│  ┌─────────────────────────────────────┐                    │
│  │        服务端规则引擎                 │                    │
│  │  • 无法读取消息内容                    │                    │
│  │  • 可执行边界检查                      │                    │
│  │  • 可生成审计日志                      │                    │
│  └─────────────────────────────────────┘                    │
│                                                             │
│  安全模式开关（女性可控）                                      │
│  • 标准模式：混合信任（推荐）                                  │
│  • 安全模式：服务端可读（高风险场景/法律取证）                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2. 女性主权原则

- **密钥所有权**：女性设备作为主信任根
- **访问控制**：女性可撤销任何设备的访问权
- **安全模式**：女性可选择是否允许服务端读取消息
- **销毁权**：女性可随时密码学擦除所有数据

---

## 密钥管理体系

### 2.1 密钥层级

```
┌─────────────────────────────────────────────────────────────┐
│                     密钥层级结构                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Level 4: 主密钥（Master Key）                               │
│  ├── 生成：用户注册时客户端生成                               │
│  ├── 存储：iOS Keychain / Android Keystore / Web CryptoKey   │
│  └── 用途：加密设备密钥和会话密钥                             │
│                                                             │
│  Level 3: 设备密钥（Device Key）                             │
│  ├── 生成：每台设备首次登录时生成                             │
│  ├── 存储：本地安全存储                                       │
│  └── 用途：解密会话密钥                                       │
│                                                             │
│  Level 2: 会话密钥（Session Key）                            │
│  ├── 生成：X3DH 密钥协商                                      │
│  ├── 存储：内存（不持久化）                                    │
│  └── 用途：加密/解密消息内容                                  │
│                                                             │
│  Level 1: 消息密钥（Message Key）                            │
│  ├── 生成：双棘轮算法派生                                     │
│  ├── 存储：随用随弃                                          │
│  └── 用途：单条消息加密                                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 X3DH 密钥协商

```typescript
// X3DH 密钥交换协议实现
interface X3DHKeyBundle {
  identityKey: X25519PublicKey;      // 长期身份密钥
  signedPreKey: X25519PublicKey;     // 中期签名预密钥
  signedPreKeySignature: Ed25519Signature;
  oneTimePreKeys: X25519PublicKey[]; // 一次性预密钥池
}

interface X3DHInitiator {
  // 发起方（男性）操作
  generateEphemeralKey(): X25519KeyPair;
  calculateSharedSecret(
    recipientBundle: X3DHKeyBundle,
    ephemeralKey: X25519KeyPair
  ): SharedSecret;
  sendInitialMessage(
    encryptedMessage: EncryptedMessage,
    ephemeralPublicKey: X25519PublicKey,
    usedOneTimePreKeyId?: string
  ): void;
}

interface X3DHResponder {
  // 响应方（女性）操作
  verifySignature(bundle: X3DHKeyBundle): boolean;
  calculateSharedSecret(
    ephemeralPublicKey: X25519PublicKey,
    identityPrivateKey: X25519PrivateKey,
    signedPreKeyPrivateKey: X25519PrivateKey,
    oneTimePreKeyPrivateKey?: X25519PrivateKey
  ): SharedSecret;
}
```

### 2.3 双棘轮算法（Double Ratchet）

```typescript
// 双棘轮会话状态
interface DoubleRatchetSession {
  // 根密钥
  rootKey: Uint8Array;
  
  // 发送链
  sendingChainKey: Uint8Array;
  sendingMessageNumber: number;
  
  // 接收链
  receivingChainKey: Uint8Array;
  receivingMessageNumber: number;
  
  // 跳过密钥缓存（处理乱序消息）
  skippedMessageKeys: Map<number, Uint8Array>;
  
  // DH 密钥对
  senderRatchetKeyPair: X25519KeyPair;
  receiverRatchetPublicKey?: X25519PublicKey;
}

// 消息加密流程
function encryptMessage(
  session: DoubleRatchetSession,
  plaintext: Uint8Array
): EncryptedMessage {
  // 1. 派生消息密钥
  const messageKey = kdf_ck(session.sendingChainKey);
  
  // 2. 更新链密钥
  session.sendingChainKey = kdf_ck(session.sendingChainKey);
  
  // 3. 加密消息
  const ciphertext = aes_gcm_encrypt(plaintext, messageKey);
  
  // 4. 返回加密消息
  return {
    ciphertext,
    messageNumber: session.sendingMessageNumber++,
    senderRatchetKey: session.senderRatchetKeyPair.publicKey
  };
}

// DH 棘轮（异步触发）
function dhRatchet(
  session: DoubleRatchetSession,
  newReceiverRatchetKey: X25519PublicKey
): void {
  // 1. 计算 DH 共享密钥
  const dhOutput = x25519(
    session.senderRatchetKeyPair.privateKey,
    newReceiverRatchetKey
  );
  
  // 2. 更新根密钥和接收链
  const [newRootKey, newReceivingChainKey] = kdf_rk(
    session.rootKey,
    dhOutput
  );
  
  session.rootKey = newRootKey;
  session.receivingChainKey = newReceivingChainKey;
  session.receiverRatchetPublicKey = newReceiverRatchetKey;
  
  // 3. 生成新的发送密钥对
  session.senderRatchetKeyPair = generateX25519KeyPair();
  
  // 4. 计算新的 DH 输出并更新发送链
  const newDhOutput = x25519(
    session.senderRatchetKeyPair.privateKey,
    newReceiverRatchetKey
  );
  
  const [finalRootKey, newSendingChainKey] = kdf_rk(
    session.rootKey,
    newDhOutput
  );
  
  session.rootKey = finalRootKey;
  session.sendingChainKey = newSendingChainKey;
}
```

---

## 媒体加密方案

### 3.1 客户端加密上传

```typescript
// 媒体加密上传流程
interface MediaEncryptionFlow {
  // 步骤 1: 生成媒体密钥
  generateMediaKey(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(32));
  }
  
  // 步骤 2: 本地加密
  async encryptMedia(
    file: File,
    mediaKey: Uint8Array
  ): Promise<EncryptedMedia> {
    // 生成随机 IV
    const iv = crypto.getRandomValues(new Uint8Array(12));
    
    // 读取文件
    const fileBuffer = await file.arrayBuffer();
    
    // AES-GCM 加密
    const encryptedBuffer = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      await crypto.subtle.importKey(
        'raw',
        mediaKey,
        { name: 'AES-GCM' },
        false,
        ['encrypt']
      ),
      fileBuffer
    );
    
    // 计算文件哈希（用于完整性校验）
    const fileHash = await crypto.subtle.digest('SHA-256', fileBuffer);
    
    return {
      encryptedData: new Uint8Array(encryptedBuffer),
      iv,
      fileHash: new Uint8Array(fileHash),
      mimeType: file.type,
      originalSize: file.size
    };
  }
  
  // 步骤 3: 上传加密文件
  async uploadEncryptedMedia(
    encryptedMedia: EncryptedMedia,
    uploadUrl: string
  ): Promise<string> {
    // 使用预签名 URL 上传
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      body: encryptedMedia.encryptedData,
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-File-Hash': bufferToBase64(encryptedMedia.fileHash)
      }
    });
    
    if (!response.ok) {
      throw new Error('Upload failed');
    }
    
    // 返回媒体 ID
    return response.headers.get('X-Media-Id');
  }
  
  // 步骤 4: 加密媒体密钥并发送
  async sendMediaKey(
    mediaKey: Uint8Array,
    recipientId: string,
    session: DoubleRatchetSession
  ): Promise<EncryptedMediaKey> {
    // 使用会话密钥加密媒体密钥
    const encryptedKey = encryptMessage(session, mediaKey);
    
    return {
      mediaId: '...',
      encryptedKey: encryptedKey.ciphertext,
      iv: encryptedKey.iv,
      keyVersion: '1'
    };
  }
}
```

### 3.2 媒体分级访问

```typescript
// 媒体访问级别
enum MediaAccessLevel {
  L0_TEXT = 0,      // 仅文本
  L1_IMAGE = 1,     // 图片（模糊预览）
  L2_VOICE = 2,     // 语音消息
  L3_VIDEO = 3,     // 视频
  L4_FILE = 4       // 文件
}

// 媒体访问控制
interface MediaAccessControl {
  // 女性设置的媒体边界
  allowedLevels: MediaAccessLevel[];
  
  // 同意状态
  consentRequired: boolean;
  consentState: ConsentState;
  
  // 访问检查
  canAccess(level: MediaAccessLevel): boolean {
    // 检查级别是否在允许列表
    if (!this.allowedLevels.includes(level)) {
      return false;
    }
    
    // 检查是否需要同意
    if (this.consentRequired && this.consentState !== ConsentState.GRANTED) {
      return false;
    }
    
    return true;
  }
  
  // 获取媒体时的处理
  async fetchMedia(
    mediaId: string,
    requestedLevel: MediaAccessLevel
  ): Promise<MediaResult> {
    if (!this.canAccess(requestedLevel)) {
      return {
        type: 'blocked',
        reason: this.getBlockReason(requestedLevel)
      };
    }
    
    // 下载加密媒体
    const encryptedMedia = await downloadMedia(mediaId);
    
    // 解密媒体密钥
    const mediaKey = await decryptMediaKey(encryptedMedia.encryptedKey);
    
    // 解密媒体内容
    const decryptedMedia = await decryptMedia(encryptedMedia, mediaKey);
    
    // 应用访问级别处理
    return this.applyLevelProcessing(decryptedMedia, requestedLevel);
  }
  
  // 级别特定处理
  applyLevelProcessing(
    media: DecryptedMedia,
    level: MediaAccessLevel
  ): MediaResult {
    switch (level) {
      case MediaAccessLevel.L1_IMAGE:
        // 添加不可见水印
        return this.addInvisibleWatermark(media);
      case MediaAccessLevel.L2_VOICE:
      case MediaAccessLevel.L3_VIDEO:
        // 添加动态水印
        return this.addDynamicWatermark(media);
      default:
        return media;
    }
  }
}
```

---

## 设备授权与撤销

### 4.1 设备注册流程

```typescript
// 设备授权流程
interface DeviceAuthorization {
  // 新设备注册请求
  async requestDeviceAuthorization(
    newDeviceInfo: DeviceInfo,
    existingDevice: AuthorizedDevice
  ): Promise<AuthorizationRequest> {
    // 生成设备密钥对
    const deviceKeyPair = await generateX25519KeyPair();
    
    // 创建授权请求
    const request = {
      deviceId: generateUUID(),
      deviceName: newDeviceInfo.name,
      deviceType: newDeviceInfo.type,
      publicKey: deviceKeyPair.publicKey,
      timestamp: Date.now(),
      verificationCode: generateVerificationCode()
    };
    
    // 发送到现有设备确认
    await sendToExistingDevice(existingDevice, {
      type: 'device_authorization_request',
      request
    });
    
    return request;
  }
  
  // 主设备确认授权
  async authorizeDevice(
    request: AuthorizationRequest,
    masterKey: Uint8Array
  ): Promise<AuthorizedDevice> {
    // 验证请求
    if (!verifyDeviceRequest(request)) {
      throw new Error('Invalid device request');
    }
    
    // 派生设备密钥
    const deviceKey = await kdf(masterKey, request.publicKey);
    
    // 加密主密钥副本（用于历史同步）
    const encryptedMasterKey = await encrypt(masterKey, deviceKey);
    
    // 注册设备
    const authorizedDevice: AuthorizedDevice = {
      deviceId: request.deviceId,
      deviceName: request.deviceName,
      deviceType: request.deviceType,
      publicKey: request.publicKey,
      authorizedAt: Date.now(),
      encryptedMasterKey,
      permissions: ['read', 'write', 'sync']
    };
    
    // 同步到服务器
    await syncDeviceToServer(authorizedDevice);
    
    return authorizedDevice;
  }
  
  // 撤销设备
  async revokeDevice(
    deviceId: string,
    masterKey: Uint8Array
  ): Promise<void> {
    // 生成新的主密钥
    const newMasterKey = await generateMasterKey();
    
    // 重新加密所有会话密钥
    await reencryptAllSessions(masterKey, newMasterKey);
    
    // 撤销设备
    await serverRevokeDevice(deviceId);
    
    // 通知其他设备
    await notifyDevices({
      type: 'device_revoked',
      revokedDeviceId: deviceId,
      keyRotationRequired: true
    });
  }
}
```

### 4.2 历史消息同步

```typescript
// 安全历史同步
interface SecureHistorySync {
  // 请求历史同步
  async requestHistorySync(
    newDevice: AuthorizedDevice,
    encryptedMasterKey: Uint8Array
  ): Promise<SyncSession> {
    // 解密主密钥
    const masterKey = await decrypt(encryptedMasterKey, newDevice.deviceKey);
    
    // 获取会话列表
    const sessions = await fetchSessionList();
    
    // 为每个会话派生同步密钥
    const syncKeys = await Promise.all(
      sessions.map(async session => ({
        sessionId: session.id,
        syncKey: await kdf(masterKey, session.id)
      }))
    );
    
    return {
      deviceId: newDevice.deviceId,
      syncKeys,
      startTime: Date.now()
    };
  }
  
  // 同步消息
  async syncMessages(
    syncSession: SyncSession,
    batchSize: number = 100
  ): Promise<SyncResult> {
    const results: Message[] = [];
    
    for (const { sessionId, syncKey } of syncSession.syncKeys) {
      // 获取加密消息批次
      const encryptedBatch = await fetchEncryptedMessages(
        sessionId,
        batchSize
      );
      
      // 解密消息
      for (const encryptedMsg of encryptedBatch) {
        try {
          const messageKey = await kdf(syncKey, encryptedMsg.messageNumber);
          const plaintext = await aes_gcm_decrypt(
            encryptedMsg.ciphertext,
            messageKey,
            encryptedMsg.iv
          );
          
          results.push(JSON.parse(plaintext));
        } catch (error) {
          // 记录解密失败（可能消息已损坏）
          console.error(`Failed to decrypt message ${encryptedMsg.id}`);
        }
      }
    }
    
    return {
      messages: results,
      syncedAt: Date.now(),
      deviceId: syncSession.deviceId
    };
  }
}
```

---

## 密码学擦除（Crypto-Shred）

### 5.1 数据销毁流程

```typescript
// CCPA 合规的数据删除
interface CryptoShredService {
  // 用户请求删除账户
  async deleteUserAccount(userId: string): Promise<DeletionResult> {
    // 1. 获取用户所有设备
    const devices = await fetchUserDevices(userId);
    
    // 2. 触发所有设备的密钥销毁
    await Promise.all(
      devices.map(device => this.shredDeviceKeys(device))
    );
    
    // 3. 服务器端删除（72小时内完成）
    await scheduleServerDeletion(userId, {
      deadline: Date.now() + 72 * 60 * 60 * 1000,
      priority: 'high'
    });
    
    // 4. 通知关联用户（对话另一方）
    await notifyConversationPartners(userId, {
      type: 'partner_account_deleted',
      message: '对方已删除账户，对话历史将被清除'
    });
    
    return {
      status: 'scheduled',
      completionDeadline: Date.now() + 72 * 60 * 60 * 1000
    };
  }
  
  // 设备密钥销毁
  private async shredDeviceKeys(device: Device): Promise<void> {
    // 安全擦除本地存储
    await secureErase(device.storage.masterKeyLocation);
    await secureErase(device.storage.sessionKeysLocation);
    await secureErase(device.storage.preKeysLocation);
    
    // 清除内存中的密钥
    zeroMemory(device.memory.keyBuffer);
    
    // 标记设备为已销毁
    await markDeviceShredded(device.deviceId);
  }
  
  // 服务器端数据删除（72小时内执行）
  async executeServerDeletion(userId: string): Promise<void> {
    // 删除消息元数据
    await deleteMessageMetadata(userId);
    
    // 删除媒体引用
    await deleteMediaReferences(userId);
    
    // 删除会话记录
    await deleteSessionRecords(userId);
    
    // 删除审计日志中的个人标识（保留合规所需的匿名化记录）
    await anonymizeAuditLogs(userId);
    
    // 标记用户为已删除
    await markUserDeleted(userId);
  }
  
  // 单条消息撤回（Vault 功能）
  async retractMessage(
    messageId: string,
    userId: string,
    deleteForBoth: boolean
  ): Promise<RetractionResult> {
    if (deleteForBoth) {
      // 获取消息
      const message = await fetchMessage(messageId);
      
      // 验证发送者
      if (message.senderId !== userId) {
        throw new Error('Only sender can retract for both');
      }
      
      // 删除媒体（如果存在）
      if (message.mediaId) {
        await deleteMedia(message.mediaId);
      }
      
      // 删除消息密钥
      await deleteMessageKey(messageId);
      
      // 通知接收方
      await notifyMessageRetraction(message.conversationId, messageId);
    }
    
    // 本地删除
    await localDeleteMessage(messageId);
    
    return {
      messageId,
      retractedAt: Date.now(),
      scope: deleteForBoth ? 'both' : 'self'
    };
  }
}

// 安全擦除实现
async function secureErase(location: StorageLocation): Promise<void> {
  // 多次覆盖写入
  const passes = [
    new Uint8Array(0x00),
    new Uint8Array(0xFF),
    new Uint8Array(0x00),
    crypto.getRandomValues(new Uint8Array(location.size))
  ];
  
  for (const pass of passes) {
    await writeToLocation(location, pass);
    await fsync(location);
  }
  
  // 删除文件
  await deleteFile(location);
}
```

---

## 安全模式实现

### 6.1 模式切换

```typescript
// 安全模式（服务端可读）
enum SecurityMode {
  STANDARD = 'standard',    // 标准 E2EE（推荐）
  SAFE = 'safe'             // 安全模式（服务端可读）
}

interface SecurityModeService {
  // 切换安全模式（仅女性可操作）
  async switchSecurityMode(
    userId: string,
    newMode: SecurityMode,
    reason: SecurityModeReason
  ): Promise<ModeSwitchResult> {
    // 验证用户身份
    await verifyUserIdentity(userId);
    
    // 记录模式切换审计日志
    await logSecurityModeSwitch(userId, newMode, reason);
    
    if (newMode === SecurityMode.SAFE) {
      // 启用安全模式：上传会话密钥到服务端
      return await enableSafeMode(userId);
    } else {
      // 禁用安全模式：从服务端删除会话密钥
      return await disableSafeMode(userId);
    }
  }
  
  // 启用安全模式
  private async enableSafeMode(userId: string): Promise<ModeSwitchResult> {
    // 获取所有会话
    const sessions = await getActiveSessions(userId);
    
    // 使用服务端公钥加密会话密钥
    const serverPublicKey = await getServerPublicKey();
    
    for (const session of sessions) {
      const encryptedSessionKey = await rsa_encrypt(
        session.sessionKey,
        serverPublicKey
      );
      
      // 存储加密后的会话密钥
      await storeEncryptedSessionKey(session.id, encryptedSessionKey);
    }
    
    // 通知对话方
    await notifyPartners(userId, {
      type: 'security_mode_changed',
      mode: SecurityMode.SAFE,
      warning: '对方已启用安全模式，消息可能被服务端读取'
    });
    
    return {
      mode: SecurityMode.SAFE,
      enabledAt: Date.now(),
      affectedSessions: sessions.length
    };
  }
  
  // 禁用安全模式
  private async disableSafeMode(userId: string): Promise<ModeSwitchResult> {
    // 从服务端删除所有加密的会话密钥
    await deleteAllEncryptedSessionKeys(userId);
    
    // 触发密钥轮换
    await rotateAllSessionKeys(userId);
    
    // 通知对话方
    await notifyPartners(userId, {
      type: 'security_mode_changed',
      mode: SecurityMode.STANDARD,
      message: '对方已恢复标准加密模式'
    });
    
    return {
      mode: SecurityMode.STANDARD,
      disabledAt: Date.now()
    };
  }
}

// 安全模式使用场景
enum SecurityModeReason {
  HARASSMENT_EVIDENCE = 'harassment_evidence',  // 收集骚扰证据
  LEGAL_PROCEEDING = 'legal_proceeding',        // 法律诉讼
  SAFETY_CONCERN = 'safety_concern',            // 安全顾虑
  ACCOUNT_RECOVERY = 'account_recovery'         // 账户恢复
}
```

---

## 防截屏与数字水印

### 7.1 不可见水印

```typescript
// 数字水印服务
interface DigitalWatermarkService {
  // 添加不可见水印（频域水印）
  async addInvisibleWatermark(
    imageData: ImageData,
    userId: string,
    timestamp: number
  ): Promise<ImageData> {
    // 生成水印信息
    const watermarkData = this.generateWatermarkData(userId, timestamp);
    
    // 转换为频域（DCT）
    const dctCoefficients = await this.dctTransform(imageData);
    
    // 在中频系数中嵌入水印
    for (let i = 0; i < watermarkData.length; i++) {
      const position = this.selectDctPosition(i, dctCoefficients);
      dctCoefficients[position] += watermarkData[i] * WATERMARK_STRENGTH;
    }
    
    // 逆变换回空间域
    return await this.idctTransform(dctCoefficients, imageData.width, imageData.height);
  }
  
  // 提取水印（泄露溯源）
  async extractWatermark(
    leakedImage: ImageData
  ): Promise<WatermarkInfo | null> {
    // 频域变换
    const dctCoefficients = await this.dctTransform(leakedImage);
    
    // 提取水印位
    const extractedBits: number[] = [];
    for (let i = 0; i < WATERMARK_LENGTH; i++) {
      const position = this.selectDctPosition(i, dctCoefficients);
      extractedBits.push(dctCoefficients[position] > 0 ? 1 : 0);
    }
    
    // 解码水印信息
    return this.decodeWatermark(extractedBits);
  }
  
  // 生成水印数据
  private generateWatermarkData(userId: string, timestamp: number): Uint8Array {
    // 用户ID哈希 + 时间戳 + 随机盐
    const data = `${userId}:${timestamp}:${generateSalt()}`;
    return new TextEncoder().encode(data);
  }
}

// 截屏检测（iOS/Android）
interface ScreenshotDetection {
  // iOS 截屏检测
  setupIOSScreenshotDetection(): void {
    // 监听系统通知
    NotificationCenter.default.addObserver(
      this,
      selector: #selector(screenshotTaken),
      name: UIApplication.userDidTakeScreenshotNotification,
      object: nil
    );
  }
  
  @objc func screenshotTaken() {
    // 发送截屏通知给对话方
    self.notifyScreenshotTaken();
    
    // 记录审计日志
    self.logScreenshotEvent();
    
    // 显示警告提示
    self.showScreenshotWarning();
  }
  
  // Android 截屏检测（有限支持）
  setupAndroidScreenshotDetection(activity: Activity): void {
    // 使用 FLAG_SECURE 阻止截屏
    activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE);
    
    // 或使用 MediaProjection API 检测（需要特殊权限）
    // 注意：Android 无法可靠检测截屏
  }
}
```

---

## 合规审计日志

### 8.1 审计事件类型

```typescript
// 审计日志事件
enum AuditEventType {
  // 密钥管理
  KEY_GENERATED = 'key_generated',
  KEY_ROTATED = 'key_rotated',
  DEVICE_AUTHORIZED = 'device_authorized',
  DEVICE_REVOKED = 'device_revoked',
  
  // 安全模式
  SECURITY_MODE_ENABLED = 'security_mode_enabled',
  SECURITY_MODE_DISABLED = 'security_mode_disabled',
  
  // 消息事件
  MESSAGE_SENT = 'message_sent',
  MESSAGE_RECEIVED = 'message_received',
  MESSAGE_RETRACTED = 'message_retracted',
  
  // 同意事件
  CONSENT_REQUESTED = 'consent_requested',
  CONSENT_GRANTED = 'consent_granted',
  CONSENT_DENIED = 'consent_denied',
  
  // 边界变更
  BOUNDARY_CHANGED = 'boundary_changed',
  RULE_TRIGGERED = 'rule_triggered',
  
  // 安全事件
  SCREENSHOT_DETECTED = 'screenshot_detected',
  UNAUTHORIZED_ACCESS_ATTEMPT = 'unauthorized_access_attempt',
  
  // 数据删除
  DATA_DELETION_REQUESTED = 'data_deletion_requested',
  DATA_DELETION_COMPLETED = 'data_deletion_completed'
}

// 审计日志条目
interface AuditLogEntry {
  eventId: string;
  eventType: AuditEventType;
  timestamp: number;
  userId: string;
  conversationId?: string;
  messageId?: string;
  
  // 事件详情（加密存储）
  encryptedDetails: Uint8Array;
  
  // 完整性哈希
  integrityHash: string;
  
  // 前一个事件的哈希（形成链）
  previousHash: string;
}

// 审计日志服务
interface AuditLogService {
  // 记录审计事件
  async logEvent(entry: AuditLogEntry): Promise<void> {
    // 计算完整性哈希
    const integrityHash = await this.calculateIntegrityHash(entry);
    entry.integrityHash = integrityHash;
    
    // 存储到不可篡改存储
    await this.appendToTamperProofLog(entry);
    
    // 可选：锚定到区块链
    await this.anchorToBlockchain(entry);
  }
  
  // 验证日志完整性
  async verifyLogIntegrity(): Promise<IntegrityReport> {
    const entries = await this.fetchAllEntries();
    const violations: string[] = [];
    
    for (let i = 1; i < entries.length; i++) {
      const current = entries[i];
      const previous = entries[i - 1];
      
      // 验证链式哈希
      if (current.previousHash !== previous.integrityHash) {
        violations.push(`Chain break at entry ${current.eventId}`);
      }
      
      // 验证当前条目哈希
      const calculatedHash = await this.calculateIntegrityHash(current);
      if (calculatedHash !== current.integrityHash) {
        violations.push(`Hash mismatch at entry ${current.eventId}`);
      }
    }
    
    return {
      totalEntries: entries.length,
      violations,
      isValid: violations.length === 0
    };
  }
}
```

---

## 性能指标

| 指标 | 目标值 | 测试方法 |
|------|--------|----------|
| 会话建立时间 | ≤ 500ms | 客户端计时 |
| 消息加密延迟 | ≤ 10ms | 客户端计时 |
| 消息解密延迟 | ≤ 10ms | 客户端计时 |
| 媒体加密吞吐量 | ≥ 10MB/s | 基准测试 |
| 密钥派生时间 | ≤ 5ms | 客户端计时 |
| 历史同步速度 | ≥ 100 msg/s | 端到端测试 |
| 设备授权时间 | ≤ 2s | 用户测试 |

---

## 实现检查清单

### 客户端（iOS/Android/Web）

- [ ] X3DH 密钥交换实现
- [ ] 双棘轮算法实现
- [ ] 媒体客户端加密
- [ ] 设备授权流程
- [ ] 历史消息同步
- [ ] 截屏检测（iOS）
- [ ] 数字水印添加
- [ ] 安全模式切换
- [ ] 密码学擦除

### 服务端

- [ ] 预密钥包管理
- [ ] 设备注册服务
- [ ] 加密会话密钥存储（安全模式）
- [ ] 审计日志链式存储
- [ ] 数据删除调度器
- [ ] 完整性验证服务

### 测试

- [ ] 端到端加密测试
- [ ] 密钥轮换测试
- [ ] 设备撤销测试
- [ ] 历史同步测试
- [ ] 泄露溯源测试
- [ ] 性能基准测试
- [ ] 渗透测试
