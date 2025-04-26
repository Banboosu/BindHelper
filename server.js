import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import sharp from 'sharp'; // 添加sharp库用于图像处理

// 配置环境变量
dotenv.config();

// API配置
const API_KEY = 'sk-rvgkaxqeyvhulcciizkmavnexduidivmbhwgroohpjfeaegn';
const MODEL = 'Pro/Qwen/Qwen2.5-VL-7B-Instruct'; // 使用轻量级7B模型

// 图像配置
const IMAGE_MAX_WIDTH = 640;  // 最大宽度
const IMAGE_MAX_HEIGHT = 480; // 最大高度
const IMAGE_QUALITY = 80;     // JPEG质量

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

// 处理图像压缩
async function compressImage(base64Image) {
  try {
    // 检查输入
    if (!base64Image || typeof base64Image !== 'string') {
      throw new Error('无效的图像数据');
    }

    // 安全地移除base64前缀
    let base64Data = base64Image;
    if (base64Image.startsWith('data:image/')) {
      const matches = base64Image.match(/^data:image\/\w+;base64,/);
      if (matches && matches[0]) {
        base64Data = base64Image.replace(matches[0], '');
      }
    }
    
    // 确保base64有效
    try {
      const buffer = Buffer.from(base64Data, 'base64');
      if (buffer.length === 0) {
        throw new Error('图像数据为空');
      }
      
      // 使用sharp压缩图像
      const compressedBuffer = await sharp(buffer, { failOnError: false })
        .resize({
          width: IMAGE_MAX_WIDTH,
          height: IMAGE_MAX_HEIGHT,
          fit: 'inside',
          withoutEnlargement: true
        })
        .jpeg({ quality: IMAGE_QUALITY })
        .toBuffer();
      
      // 转回base64
      return compressedBuffer.toString('base64');
    } catch (sharpError) {
      console.error('Sharp处理错误:', sharpError);
      // 如果sharp处理失败，返回原始数据
      return base64Data;
    }
  } catch (error) {
    console.error('图像压缩错误:', error);
    // 尝试返回原始数据
    try {
      if (base64Image.startsWith('data:image/')) {
        return base64Image.replace(/^data:image\/\w+;base64,/, '');
      }
      return base64Image;
    } catch (e) {
      throw new Error('图像数据处理失败');
    }
  }
}

// 用户请求限制
const userRequests = new Map();
const RATE_LIMIT = 25; // 每分钟最大请求次数
const RATE_WINDOW = 50000; // 时间窗口（毫秒）

// 存储用户的最后一帧图像和时间戳
const userLastFrames = new Map();
// 最小帧间隔（毫秒）
const MIN_FRAME_INTERVAL = 1000; // 每秒最多处理1帧
// 图像相似度阈值（百分比）
const IMAGE_SIMILARITY_THRESHOLD = 0.90; // 90%相似度以上视为相同场景

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

// 检查帧间隔和场景变化
async function shouldProcessFrame(userId, frame) {
  const now = Date.now();
  
  // 检查最小时间间隔
  if (userLastFrames.has(userId)) {
    const { timestamp, lastFrameHash } = userLastFrames.get(userId);
    if (now - timestamp < MIN_FRAME_INTERVAL) {
      return false; // 帧率过高，跳过处理
    }
    
    // 这里可以添加场景变化检测逻辑
    // 简单的方案：通过图像哈希比较或像素差异检测
    // 复杂的方案：使用图像特征提取比较
  }
  
  // 更新用户最后帧信息
  userLastFrames.set(userId, {
    timestamp: now,
    lastFrameHash: frame // 实际应用中应保存图像哈希值而非完整帧
  });
  
  return true;
}

// 处理Socket.io连接
io.on('connection', (socket) => {
  console.log('用户已连接:', socket.id);
  
  // 处理视频帧和消息
  socket.on('videoFrame', async (data) => {
    try {
      // 检查数据完整性
      if (!data || !data.frame) {
        console.error('接收到无效数据:', data ? 'frame缺失' : '数据为空');
        socket.emit('error', { message: '接收到无效的视频帧数据' });
        return;
      }

      // 检查请求频率限制
      if (!checkRateLimit(socket.id)) {
        socket.emit('error', { message: '请求过于频繁，请稍后再试' });
        return;
      }
      
      const { frame, message } = data;
      
      // 检查是否需要处理此帧
      try {
        if (!await shouldProcessFrame(socket.id, frame)) {
          return; // 跳过处理，不通知客户端
        }
      } catch (frameCheckError) {
        console.error('帧率检查错误:', frameCheckError);
        // 继续处理，不中断用户体验
      }
      
      // 压缩图像
      let compressedFrame;
      try {
        compressedFrame = await compressImage(frame);
        console.log('图像压缩成功，大小减少至原来的约', Math.round((compressedFrame.length / frame.replace(/^data:image\/jpeg;base64,/, '').length) * 100), '%');
      } catch (compressionError) {
        console.error('图像压缩错误:', compressionError);
        // 如果压缩失败，使用原始图像
        compressedFrame = frame.replace(/^data:image\/jpeg;base64,/, '');
      }

      console.log('调用AI模型处理视频帧...');
      
      // 调用AI模型API
      try {
        const response = await client.chat.completions.create({
          model: MODEL,
          messages: [
            {
              role: 'system',
              content: `你是一个为视障人士设计的外出辅助系统。你的任务是分析摄像头拍摄的实时画面，并以简洁明了的方式提供重要信息。

请遵循以下原则：
1. 只报告关键信息，避免无关细节。
2. **优先关注安全**：障碍物（台阶、坑洼、柱子等）、移动物体（车辆、行人、自行车）、危险区域、交通信号灯状态变化、露天打开的井盖等。
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
                    url: `data:image/jpeg;base64,${compressedFrame}`
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
      } catch (apiError) {
        console.error('AI API调用错误:', apiError.message);
        if (apiError.response) {
          console.error('API响应状态:', apiError.response.status);
          console.error('API错误详情:', apiError.response.data);
        }
        socket.emit('error', { message: `处理视频帧时出错: ${apiError.message}` });
      }
    } catch (error) {
      console.error('视频帧处理总体错误:', error);
      socket.emit('error', { message: `处理视频帧时出错: ${error.message}` });
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
    // 验证请求数据
    const { message, imageData } = req.body;
    
    if (!message && !imageData) {
      return res.status(400).json({ error: '请求必须包含消息或图像数据' });
    }
    
    // 准备请求内容
    const content = [];
    if (message) {
      content.push({ type: 'text', text: message });
    }
    if (imageData) {
      // 压缩图像
      let compressedImage;
      try {
        compressedImage = await compressImage(imageData);
        console.log('API请求: 图像压缩成功');
      } catch (compressionError) {
        console.error('API请求: 图像压缩错误:', compressionError);
        // 如果压缩失败，使用原始图像
        compressedImage = imageData.replace(/^data:image\/jpeg;base64,/, '');
      }
      
      content.push({ 
        type: 'image_url', 
        image_url: { 
          url: `data:image/jpeg;base64,${compressedImage}`
        }
      });
    }
    
    console.log('API请求: 调用AI模型...');
    
    // 调用AI模型API
    try {
      const response = await client.chat.completions.create({
        model: MODEL,
        messages: [
          {
            role: 'system',
            content: `你是一个为视障人士设计的外出辅助系统。你的任务是分析摄像头拍摄的实时画面，并以简洁明了的方式提供重要信息。

请遵循以下原则：
1. 只报告关键信息，避免无关细节。
2. **优先关注安全**：障碍物（台阶、坑洼、柱子等）、移动物体（车辆、行人、自行车）、危险区域、交通信号灯状态变化、露天打开的井盖等。
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
    } catch (apiError) {
      console.error('API请求: AI API调用错误:', apiError.message);
      if (apiError.response) {
        console.error('API响应状态:', apiError.response.status);
        console.error('API错误详情:', apiError.response.data);
      }
      // 如果已经开始发送响应，那么发送错误事件
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ error: `AI处理错误: ${apiError.message}` })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ error: `AI处理错误: ${apiError.message}` });
      }
    }
  } catch (error) {
    console.error('API请求: 总体错误:', error.message);
    // 如果已经开始发送响应，那么发送错误事件
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: `处理请求时出错: ${error.message}` })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: `处理请求时出错: ${error.message}` });
    }
  }
});

// 启动服务器
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
});