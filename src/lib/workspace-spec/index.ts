/**
 * Living Connection OS · P1 —— `workspace-spec` 模块出口
 *
 * 使用约定：
 *   - **任何**要渲染到画布上的结构，都必须先过 `WorkspaceSpecSchema`（或经
 *     `compileWorkspaceSpec` 产出，它内部已经校验过一次）。
 *   - 渲染侧只认 `NODE_TYPES` 白名单，绝不 `eval` / `dangerouslySetInnerHTML`。
 */

export {
  NODE_TYPES,
  RESERVED_NODE_TYPES,
  WORKSPACE_SPEC_VERSION,
  WorkspaceSpecSchema,
  WorkspaceNodeSchema,
  WorkspaceActionSchema,
  IntentNodeSchema,
  CandidateNodeSchema,
  ConsentNodeSchema,
  ActionNodeSchema,
  OutcomeNodeSchema,
  type NodeType,
  type ReservedNodeType,
  type WorkspaceSpec,
  type WorkspaceNode,
  type WorkspaceAction,
  type IntentNode,
  type CandidateNode,
  type ConsentNode,
  type ActionNode,
  type OutcomeNode,
} from './schema'

export {
  INTENT_CLASSES,
  INTENT_PLAYBOOKS,
  MIN_GOAL_LENGTH,
  classifyIntent,
  compileWorkspaceSpec,
  extractDraftFields,
  supportedIntentHints,
  type Classification,
  type CompileResult,
  type IntentClass,
} from './compile'
