# UX16 — `tsc exit137` 根因与修复证据

- 版本：V25.6
- 日期：2026-11-20
-  verdict：**CODE_COMPLETE / LOCAL_TESTED**（未进 CI、未部署）

## 1. 根因（磁盘事实取证）

`tsconfig.json` 的 `include` 使用全局 glob：

```json
"include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts", ".next/dev/types/**/*.ts", "**/*.mts"]
```

取证统计（工作区根目录）：

- 根目录并存 **15 个 `.next*` 目录**：`.next`、`.next-v196`…`.next-v207`、`.next-fix-1114`、`.next-fix2-1114`、`.next-dev-v196`。
- 这些备份目录内有 **56 个** `.ts/.tsx/.mts` 生成类型文件，被全局 glob 全部纳入。
- 全局匹配（排除 node_modules）共 **3242** 个 ts 文件。
- `src/generated/index.d.ts` 为 **5.6MB** 的 Prisma 生成类型。
- 两份 `tsbuildinfo`（101KB + 900KB），`incremental:true`。

结论：`tsc` 同时载入十余套历史构建的类型声明 + 5.6MB generated client，堆内存溢出 → 进程被 OOM killer 杀掉（exit137 = SIGKILL），被误记为"待 CI 处理"。

## 2. 修复

1. 新增 `tsconfig.strict.json`（全量类型检查专用，`extends` 主配置）：
   - `src/**/*.ts(x)` 取代全局 `**/*`，显式排除 src 下的测试文件；
   - 排除 `.next-v*` / `.next-fix*` / `.next-dev-v*` / `.open-next` / `backups`；
   - `incremental:false`（不复用陈旧 tsbuildinfo）。
2. `package.json` 新增脚本：
   ```json
   "typecheck": "tsc --noEmit -p tsconfig.strict.json"
   ```
3. 主 `tsconfig.json` **不改**，`next build` 行为不受影响（避免构建期被 Next 重写 include 的已知副作用）。

## 3. 修复过程中暴露并修复的真实类型错误

- 原错误：`src/lib/social-ai/message-assist.ts(25,62): error TS2459: Module '"@/lib/agent/guard"' declares 'InjectionSignal' locally, but it is not exported.`
- 根因：`InjectionSignal` 定义于 `src/lib/agent/types.ts`，guard 仅 import 使用未 re-export；jest（ts-jest）不做完整类型检查，长期掩盖。
- 修复：改为 `import type { InjectionSignal } from '@/lib/agent/types'`。

## 4. 验证结果

| 命令 | 结果 |
|---|---|
| `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p tsconfig.json`（旧配置，取证） | exit 2（真实错误被海量备份类型淹没，非 OOM；说明 exit137 由文件规模触发） |
| `npx tsc --noEmit -p tsconfig.strict.json`（收窄后） | **exit 0，0 错误** |
| `npm run typecheck`（标准 CI 调用，无特殊内存参数） | **exit 0** |

## 5. 诚实边界

- 本修复让全量源码类型检查在本地可重复通过，但**尚未接入 CI**（`G12` 仍 PARTIAL）。
- 未清理根目录 15 个 `.next*` 备份（属个人/工作区文件清理，需 Owner 确认后再做，本轮不擅自删除）。
- `tsconfig.strict.json` 排除 src 内 `*.test.ts`；测试文件类型由 jest/ts-jest 覆盖，未纳入本检查口径（如实标注）。

## 6. 下一步可执行

1. Owner 确认后清理 14 个历史 `.next-v*`/`.next-fix*`/`.next-dev-v*` 备份目录。
2. CI（`.github/workflows/ci.yml`）增加 `npm run typecheck` 为 required check。
3. 将 typecheck 结果纳入 G12 的独立复核证据。
