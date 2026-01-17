const form = document.getElementById("setup-form");
const chatList = document.getElementById("chatList");
const statusEl = document.getElementById("status");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const continueBtn = document.getElementById("continueBtn");
const chatContainer = document.getElementById("chatContainer");
const fullscreenBtn = document.getElementById("fullscreenBtn");
const markdownToggle = document.getElementById("markdownToggle");
const exportBtn = document.getElementById("exportBtn");

let currentController = null;
let isMarkdownEnabled = false;
let canContinue = false;
let debateTranscript = []; // 存储辩论记录
let debateConfig = {}; // 存储辩论配置

function setStatus(text, tone) {
  statusEl.textContent = text;
  statusEl.classList.remove("running", "error");
  if (tone) {
    statusEl.classList.add(tone);
  }
}

function clearChat() {
  chatList.innerHTML = "";
  debateTranscript = []; // 清空辩论记录
}

function setButtons(running) {
  startBtn.disabled = running;
  stopBtn.disabled = !running;
  continueBtn.disabled = running || !canContinue;
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    chatList.scrollTop = chatList.scrollHeight;
  });
}

function appendMessage(side, content) {
  // 记录到辩论记录中
  debateTranscript.push({
    side: side,
    role: side === "pro" ? "正方" : "反方",
    content: content,
    timestamp: new Date().toISOString()
  });

  const wrapper = document.createElement("div");
  wrapper.className = `message ${side}`;

  const avatar = document.createElement("div");
  avatar.className = `avatar ${side}`;
  avatar.textContent = side === "pro" ? "正" : "反";

  const bubble = document.createElement("div");
  bubble.className = `bubble ${side}`;

  // 根据 Markdown 开关决定渲染方式
  if (isMarkdownEnabled && typeof marked !== 'undefined') {
    bubble.classList.add('markdown-content');
    bubble.innerHTML = marked.parse(content);
  } else {
    bubble.textContent = content;
  }

  if (side === "pro") {
    wrapper.appendChild(bubble);
    wrapper.appendChild(avatar);
  } else {
    wrapper.appendChild(avatar);
    wrapper.appendChild(bubble);
  }

  chatList.appendChild(wrapper);
  scrollToBottom();
}

async function streamDebate(payload) {
  if (currentController) {
    currentController.abort();
  }

  currentController = new AbortController();
  setStatus("辩论进行中…", "running");
  canContinue = false;
  setButtons(true);

  try {
    const response = await fetch("/api/debate/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: currentController.signal,
    });

    if (!response.ok || !response.body) {
      const text = await response.text();
      throw new Error(text || "服务返回异常");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }
        let data;
        try {
          data = JSON.parse(line);
        } catch (err) {
          continue;
        }

        if (data.type === "message") {
          appendMessage(data.side, data.content);
        } else if (data.type === "error") {
          setStatus(`出错：${data.message}`, "error");
          canContinue = true;
          setButtons(false);
        } else if (data.type === "done") {
          setStatus("辩论结束");
          canContinue = false;
          setButtons(false);
        }
      }
    }
  } catch (err) {
    if (err.name === "AbortError") {
      setStatus("已停止");
      canContinue = true;
    } else {
      setStatus(`出错：${err.message}`, "error");
      canContinue = true;
    }
  } finally {
    setButtons(false);
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  clearChat();

  const topic = document.getElementById("topic").value.trim();
  const proSystem = document.getElementById("proSystem").value.trim();
  const conSystem = document.getElementById("conSystem").value.trim();
  const rounds = Number.parseInt(document.getElementById("rounds").value, 10) || 4;
  const temperature = Number.parseFloat(document.getElementById("temperature").value) || 1;
  const proModel = document.getElementById("proModel").value.trim();
  const conModel = document.getElementById("conModel").value.trim();

  if (!topic) {
    setStatus("请先填写辩题。", "error");
    return;
  }

  // 保存辩论配置
  debateConfig = {
    topic,
    pro_system: proSystem,
    con_system: conSystem,
    rounds,
    temperature,
    pro_model: proModel || null,
    con_model: conModel || null,
    start_time: new Date().toISOString()
  };

  streamDebate({
    topic,
    pro_system: proSystem,
    con_system: conSystem,
    rounds,
    temperature,
    pro_model: proModel || null,
    con_model: conModel || null,
  });
});

stopBtn.addEventListener("click", () => {
  if (currentController) {
    currentController.abort();
  }
});

continueBtn.addEventListener("click", () => {
  if (!canContinue) {
    return;
  }
  if (!debateConfig || !debateConfig.topic) {
    setStatus("没有可继续的辩论。", "error");
    return;
  }
  const payload = {
    topic: debateConfig.topic,
    pro_system: debateConfig.pro_system,
    con_system: debateConfig.con_system,
    rounds: debateConfig.rounds,
    temperature: debateConfig.temperature,
    pro_model: debateConfig.pro_model,
    con_model: debateConfig.con_model,
    transcript: debateTranscript.map((item) => ({
      side: item.side,
      content: item.content,
    })),
  };
  streamDebate(payload);
});

// 全屏切换功能
fullscreenBtn.addEventListener("click", () => {
  chatContainer.classList.toggle("fullscreen");

  // 更新按钮图标
  const svg = fullscreenBtn.querySelector("svg");
  if (chatContainer.classList.contains("fullscreen")) {
    // 退出全屏图标
    svg.innerHTML = '<path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>';
  } else {
    // 进入全屏图标
    svg.innerHTML = '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>';
  }
});

setButtons(false);

// Markdown 渲染开关
markdownToggle.addEventListener("change", (e) => {
  isMarkdownEnabled = e.target.checked;
});

// 导出辩论记录为 JSON
exportBtn.addEventListener("click", () => {
  if (debateTranscript.length === 0) {
    setStatus("暂无辩论记录可导出", "error");
    return;
  }

  const exportData = {
    config: debateConfig,
    transcript: debateTranscript,
    export_time: new Date().toISOString(),
    total_rounds: debateTranscript.length
  };

  const jsonStr = JSON.stringify(exportData, null, 2);
  const blob = new Blob([jsonStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `debate_${debateConfig.topic || "record"}_${new Date().getTime()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  setStatus("辩论记录已导出");
});
