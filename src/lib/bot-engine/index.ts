/**
 * Bot Engine - 数字用户系统入口
 */

export { BotBehaviorEngine, getBotBehaviorEngine } from './BotBehaviorEngine';
export { BotEngine } from './schedulers/engine';
export { DEFAULT_ENGINE_CONFIG, DEV_ENGINE_CONFIG } from './config';
export * from './types';

// 启动Bot引擎的便捷函数
export async function startBotEngine(): Promise<void> {
  const { getBotBehaviorEngine } = require('./BotBehaviorEngine');
  const engine = getBotBehaviorEngine();
  await engine.start();
}

// 停止Bot引擎的便捷函数
export function stopBotEngine(): void {
  const { getBotBehaviorEngine } = require('./BotBehaviorEngine');
  const engine = getBotBehaviorEngine();
  engine.stop();
}
