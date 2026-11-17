# V25.1 工具调用与安装审查登记（推荐，不代表已安装）

工具分三类：现有 repo 命令（必须先审脚本）、推荐开源 CLI/Skills（安装前锁版本与许可）、外部/需要授权工具（不可自行获取生产密钥）。下列 GitHub 项目经 2026-11-17 仓库元数据核对，项目存在不等于已在 WorkBuddy 安装。

| 阶段 | 工具 | 说明与调用动作 | 来源/约束 |
|---|---|---|---|
| 事实与代码 | GitHub connector / git | `git status --porcelain=v1`, `git rev-parse HEAD`, `git ls-remote origin main`, GitHub PR/Rulesets read | 连接器已经读到 main protected=false；写权限另需授权 |
| 回归 & 既有 | npm / Jest / Prisma | `npm run build`, `npx tsc --noEmit`, `npx jest --runInBand` | 必须在隔离测试库；生产迁移需批准 |
| 既有门禁 | `npm run check:selfhost`, `npm run audit:open-source`, `npm run check:openapi-contract`, `npm run check:secrets`, `npm run check:pricing` | 已见 package.json；WorkBuddy先打开脚本确认副作用与参数，再真正执行 | 不能仅因脚本存在就标 PASS |
| 真浏览器 | Playwright | 手机桌面、2用户真实交互、trace/video/HAR、网络断线与登录 | https://github.com/microsoft/playwright |
| 无障碍 | axe-core | 对公开与登录页做 WCAG 扫描 + 手工键盘/读屏 | https://github.com/dequelabs/axe-core |
| 性能 | Lighthouse CI/Chrome Trace | 固定设备节流、9页×3轮、TBT/LCP/CLS | https://github.com/GoogleChrome/lighthouse-ci |
| 模型对抗 | promptfoo | Prompt Injection、越权、隐私、跨语言意图评测；本地环境首选 | https://github.com/promptfoo/promptfoo |
| 凭据审计 | Gitleaks | Git/产物/证据中 JWT、密钥等扫描 | https://github.com/gitleaks/gitleaks |
| SBOM | Syft | 从锁文件/构建产物生成 CycloneDX/SPDX SBOM | https://github.com/anchore/syft |
| 开源供给 | OpenSSF Scorecard | 第三方仓库供应链评级与来源锁 | https://github.com/ossf/scorecard |
| 观测 | OpenTelemetry JS | 把 request/consent/action/receipt/latency ID 连接但不采隐私原文 | https://github.com/open-telemetry/opentelemetry-js |
| 本地 AI | llama.cpp | Community Edition 本地推理或独立测试模型，需审模型权重许可 | https://github.com/ggml-org/llama.cpp |
| 云端 AI | vLLM | 部署开源权重模型服务，需 GPU/预算/模型许可 | https://github.com/vllm-project/vllm |
| 跨网络研究 | Matrix Rust SDK | PoC，先评估协议、加密/同意与现有 IM 兼容，禁止直接迁移生产 | https://github.com/matrix-org/matrix-rust-sdk |
| 安全密钥 | SOPS | 加密配置与审计；密钥管理需 KMS/批准 | https://github.com/getsops/sops |
| UX Skill | Impeccable / Anthropic frontend-design / Vercel agent-skills | 先读 SKILL.md、pin commit、隔离安装；仅作辅助，不是用户验收证据 | https://github.com/pbakaus/impeccable ; https://github.com/anthropics/skills ; https://github.com/vercel-labs/agent-skills |
| Figma | Figma plugin | 生成或核实可编辑 Node ID/Token/组件对照，权限不足记 BLOCKED | 安装前/实际调用前阅读 Figma skill，并获用户授权 |
| 支付 | Dodo 官方 sandbox/API | 实际 test-mode provider webhook、对账和故障注入；真实扣款需独立批准 | 不得把自签回调算真实 Provider 测试 |

## 安装纪律

仅安装官方来源、已固定 commit/tag、许可证兼容、安全扫描通过的工具。不得运行未知远程 `curl|bash` 脚本。工作树与产物中禁放 API Key、个人会话 Cookie、真实用户原始私聊。模型训练数据 opt-in 且可追溯，不以协议开放暗示用户数据开放。

## 责任划分

WorkBuddy：编排和功能开发。Codex：独立评审时应使用与开发 Agent 隔离的环境/工作树和原始数据，不能同一 Agent 自签。Playwright QA：真实 UI 取证。Security：权限、隐私、密钥、负控。DevRel：自托管/SDK/许可证。Owner：商业、法律、生产写与真人数据使用最终授权。
