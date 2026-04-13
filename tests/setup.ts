import dotenv from 'dotenv';

// 加载环境变量
dotenv.config({ path: '.env.test' });

// 全局测试配置
global.console = {
  ...console,
  // 在测试中静音某些日志
  log: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// 测试超时设置
jest.setTimeout(30000);

// 模拟外部API - 简化版本
jest.mock('openai', () => {
  return {
    OpenAI: jest.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content: '这是一个测试生成的pitch消息。'
                }
              }
            ]
          })
        }
      }
    }))
  };
});

// 模拟pusher
jest.mock('pusher', () => {
  const mockPusher = {
    trigger: jest.fn().mockResolvedValue({}),
    authenticate: jest.fn().mockReturnValue({})
  };
  return {
    default: jest.fn().mockReturnValue(mockPusher)
  };
});