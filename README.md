# AI辩经堂

一个 FastAPI + OpenAI 的双边辩论演示。设置辩题与正反系统提示词，两位 AI 轮流发言，并以聊天流形式展示。

## 运行方式

1. 安装依赖
   ```
   pip install -r requirements.txt
   ```

2. 设置环境变量
   ```
   # 也可直接编辑 .env，服务会自动读取
   export OPENAI_API_KEY_PRO="正方 Key（可选）"
   export OPENAI_API_KEY_CON="反方 Key（可选）"
   export OPENAI_MODEL_PRO="gpt-4o-mini"
   export OPENAI_MODEL_CON="gpt-4o-mini"
   export OPENAI_BASE_URL_PRO="正方 Base URL（可选）"
   export OPENAI_BASE_URL_CON="反方 Base URL（可选）"
   ```
   正反方模型需至少在环境变量或页面输入中设置其一。

3. 启动服务
   ```
   python main.py
   ```

4. 打开浏览器访问 `http://127.0.0.1:8000`

## 说明

- `/api/debate/stream` 使用流式 NDJSON 返回，每条发言会立即推送到前端。
- 可在界面中自定义辩题、系统提示词、轮数、温度与模型。
