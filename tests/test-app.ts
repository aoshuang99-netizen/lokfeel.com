import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';

// 创建Next.js应用实例
const app = next({ dev: false, dir: process.cwd() });
const handle = app.getRequestHandler();

// 等待应用准备就绪
await app.prepare();

// 创建HTTP服务器
const server = createServer((req, res) => {
  const parsedUrl = parse(req.url!, true);
  handle(req, res, parsedUrl);
});

export default server;