import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';

// 配置环境变量
dotenv.config();

// API配置
const API_KEY = 'sk-rvgkaxqeyvhulcciizkmavnexduidivmbhwgroohpjfeaegn';
const MODEL = 'Qwen/Qwen2-VL-72B-Instruct';

// 创建OpenAI客户端
const client = new OpenAI({
  apiKey: API_KEY,
  baseURL: 'https://api.siliconflow.cn/v1'
});

// 获取当前文件的目录路径
const __dirname = dirname(fileURLToPath(import.meta.url));

// 创建Express应用
const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(join(__dirname, 'public')));

// 创建HTTP服务器
const server = createServer(app);

// 创建Socket.io服务器
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// 用户请求限制
const userRequests = new Map();
const RATE_LIMIT = 25; // 每分钟最大请求次数
const RATE_WINDOW = 50000; // 时间窗口（毫秒）

// 检查用户请求频率
function checkRateLimit(userId) {
  const now = Date.now();
  if (!userRequests.has(userId)) {
    userRequests.set(userId, [now]);
    return true;
  }

  const requests = userRequests.get(userId);
  const windowStart = now - RATE_WINDOW;
  
  // 清理旧的请求记录
  while (requests.length > 0 && requests[0] < windowStart) {
    requests.shift();
  }

  if (requests.length >= RATE_LIMIT) {
    return false;
  }

  requests.push(now);
  return true;
}

// 处理Socket.io连接
io.on('connection', (socket) => {
  console.log('用户已连接:', socket.id);

  // 处理视频帧和消息
  socket.on('videoFrame', async (data) => {
    try {
      // 检查请求频率限制
      if (!checkRateLimit(socket.id)) {
        socket.emit('error', { message: '请求过于频繁，请稍后再试' });
        return;
      }
      const { frame, message } = data;
      
      // 调用AI模型API
      const response = await client.chat.completions.create({
        model: MODEL,
        messages: [
          {
            role: 'system',
            content: `你是一个为视障人士设计的外出辅助系统。你的任务是分析摄像头拍摄的实时画面，并以简洁明了的方式提供重要信息。

请遵循以下原则：
1. 只报告关键信息，避免无关细节。
2. **优先关注安全**：障碍物（台阶、坑洼、柱子等）、移动物体（车辆、行人、自行车）、危险区域、交通信号灯状态变化。
3. **提供清晰简洁的指引**：例如"前方3米处有下沉井盖"，"右侧有自行车快速接近"，"红灯变为绿灯，可以通行"。
4. **保持简洁**：语句短，避免复杂描述，尽量控制在30字。
5. **不要描述**无关的风景、建筑细节、广告等，除非用户特别询问。

输出示例：
前方红灯，请等待。
左侧是建筑工地入口。
注意！右后方有车辆正在靠近。
前方约5米是斑马线。
绿灯亮起，注意左右来车后通行。`
          },
          {
            role: 'user',
            content: [
              { 
                type: 'image_url', 
                image_url: { 
                  url: `data:image/jpeg;base64,${frame.replace(/^data:image\/jpeg;base64,/, '')}`
                }
              },
              { type: 'text', text: message || '请描述画面中的重要信息' }
            ]
          }
        ],
        stream: true
      });

      // 处理流式响应
      let fullResponse = '';
      for await (const chunk of response) {
        const chunkContent = chunk.choices[0]?.delta?.content || '';
        fullResponse += chunkContent;
        // 不再实时发送部分响应
        // if (chunkContent) {
        //   socket.emit('aiResponse', {
        //     text: chunkContent,
        //     timestamp: new Date().toISOString(),
        //     isPartial: true
        //   });
        // }
      }

      // 检查 fullResponse 是否为空或仅包含空格
      if (fullResponse && fullResponse.trim()) {
          // 等待流结束后，发送完整的带有标记的响应
          socket.emit('aiResponse', {
            text: fullResponse.trim(), // 发送清理过的完整响应
            timestamp: new Date().toISOString()
            // 移除 isPartial 和 isComplete 标记
          });
      } else {
          console.log("AI response was empty or whitespace only.");
          // 可以选择发送一个空消息或特定消息给客户端
          // socket.emit('aiResponse', {
          //   text: "[INFO] 未检测到明显变化或信息。",
          //   timestamp: new Date().toISOString()
          // });
      }

    } catch (error) {
      console.error('AI处理错误:', error);
      socket.emit('error', { message: '处理视频帧时出错' });
    }
  });

  // 处理断开连接
  socket.on('disconnect', () => {
    console.log('用户已断开连接:', socket.id);
  });
});

// 定义API路由
app.post('/api/chat', async (req, res) => {
  try {
    const { message, imageData } = req.body;
    
    // 准备请求内容
    const content = [];
    if (message) {
      content.push({ type: 'text', text: message });
    }
    if (imageData) {
      content.push({ 
        type: 'image_url', 
        image_url: { 
          url: `data:image/jpeg;base64,${imageData.replace(/^data:image\/jpeg;base64,/, '')}`
        }
      });
    }
    
    // 调用AI模型API
    const response = await client.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content: `你是一个为视障人士设计的外出辅助系统。你的任务是分析摄像头拍摄的实时画面，并以简洁明了的方式提供重要信息。

请遵循以下原则：
1. 只报告关键信息，避免无关细节。
2. **优先关注安全**：障碍物（台阶、坑洼、柱子等）、移动物体（车辆、行人、自行车）、危险区域、交通信号灯状态变化。
3. **提供清晰简洁的指引**：例如"前方3米处有下沉井盖"，"右侧有自行车快速接近"，"红灯变为绿灯，可以通行"。
4. **保持简洁**：语句短，避免复杂描述，尽量控制在30字。
5. **不要描述**无关的风景、建筑细节、广告等，除非用户特别询问。

输出示例：
前方红灯，请等待。
左侧是建筑工地入口。
注意！右后方有车辆正在靠近。
前方约5米是斑马线。
绿灯亮起，注意左右来车后通行。`
        },
        { role: 'user', content }
      ],
      stream: true
    });

    // 设置响应头以支持流式传输
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // 处理流式响应
    for await (const chunk of response) {
      const chunkContent = chunk.choices[0]?.delta?.content || '';
      if (chunkContent) {
        res.write(`data: ${JSON.stringify({ text: chunkContent, timestamp: new Date().toISOString() })}\n\n`);
      }
    }
    
    res.write(`data: [DONE]\n\n`);
    res.end();
  } catch (error) {
    console.error('API错误:', error.message);
    res.status(500).json({ error: '处理请求时出错' });
  }
});

// 启动服务器
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
});