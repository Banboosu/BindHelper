## 2. 使用方式

对于 VLM 模型，可在调用 `/chat/completions` 接口时，构造包含 `图片 url` 或 `base64 编码图片` 的 `message` 消息内容进行调用。通过 `detail` 参数控制对图像的预处理方式。

### [](https://docs.siliconflow.cn/cn/userguide/capabilities/vision#2-1-关于图片细节控制参数说明)

### 2.1 关于图片细节控制参数说明

SiliconCloud 提供 `low`，`high`，`auto` 三个 `detail` 参数选项。 对于目前支持的模型，`detail` 不指定或指定为 `high` 时会采用 `high`（“高分辨率”）模式，而指定为 `low` 或者 `auto` 时会采用 `low`（“低分辨率”）模式。

### [](https://docs.siliconflow.cn/cn/userguide/capabilities/vision#2-2-包含图像的-message-消息格式示例)

### 2.2 包含图像的 `message` 消息格式示例



 使用 `InternVL` 系列模型注意：建议将 `{"type": "text", "text": "text-prompt here"}` 放在请求体 `content` 的图片后面，以获得最佳效果。 

#### [](https://docs.siliconflow.cn/cn/userguide/capabilities/vision#2-2-1-使用图片-url-形式)

#### 2.2.1 使用图片 url 形式

Copy

```json
{
    "role": "user",
    "content":[
        {
            "type": "image_url",
            "image_url": {
                "url": "https://sf-maas-uat-prod.oss-cn-shanghai.aliyuncs.com/outputs/658c7434-ec12-49cc-90e6-fe22ccccaf62_00001_.png",
                "detail":"high"
            }
        },
        {
            "type": "text",
            "text": "text-prompt here"
        }
    ]
}
```

## 5. 使用示例

### [](https://docs.siliconflow.cn/cn/userguide/capabilities/vision#5-1-示例-1-图片理解)

### 5.1. 示例 1 图片理解

Copy

```python
import json  
from openai import OpenAI

client = OpenAI(
    api_key="您的 APIKEY", # 从https://cloud.siliconflow.cn/account/ak获取
    base_url="https://api.siliconflow.cn/v1"
)

response = client.chat.completions.create(
        model="Qwen/Qwen2-VL-72B-Instruct",
        messages=[
        {
            "role": "user",
            "content": [
                {
                    "type": "image_url",
                    "image_url": {
                        "url": "https://sf-maas-uat-prod.oss-cn-shanghai.aliyuncs.com/dog.png"
                    }
                },
                {
                    "type": "text",
                    "text": "Describe the image."
                }
            ]
        }],
        stream=True
)

for chunk in response:
    chunk_message = chunk.choices[0].delta.content
    print(chunk_message, end='', flush=True)
```

### [](https://docs.siliconflow.cn/cn/userguide/capabilities/vision#5-2-示例-2-多图理解)

### 5.2. 示例 2 多图理解

Copy

```python
import json  
from openai import OpenAI

client = OpenAI(
    api_key="您的 APIKEY", # 从https://cloud.siliconflow.cn/account/ak获取
    base_url="https://api.siliconflow.cn/v1"
)

response = client.chat.completions.create(
        model="Qwen/Qwen2-VL-72B-Instruct",
        messages=[
        {
            "role": "user",
            "content": [
                {
                    "type": "image_url",
                    "image_url": {
                        "url": "https://sf-maas-uat-prod.oss-cn-shanghai.aliyuncs.com/dog.png"
                    }
                },
                {
                    "type": "image_url",
                    "image_url": {
                        "url": "https://sf-maas-uat-prod.oss-cn-shanghai.aliyuncs.com/shark.jpg"
                    }
                },
                {
                    "type": "text",
                    "text": "Identify the similarities between these images."
                }
            ]
        }],
        stream=True
)

for chunk in response:
    chunk_message = chunk.choices[0].delta.content
    print(chunk_message, end='', flush=True)
```