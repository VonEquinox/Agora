const importFile = document.getElementById("importFile");
const importText = document.getElementById("importText");
const loadBtn = document.getElementById("loadBtn");
const clearBtn = document.getElementById("clearBtn");
const exportBtn = document.getElementById("exportBtn");
const statusEl = document.getElementById("importStatus");
const chatList = document.getElementById("archiveChat");
const configSummary = document.getElementById("configSummary");
const markdownToggle = document.getElementById("markdownToggle");
const fullscreenBtn = document.getElementById("fullscreenBtn");
const chatContainer = document.querySelector(".chat");

let currentData = null;
let isMarkdownEnabled = false;

function setStatus(text, tone) {
  statusEl.textContent = text;
  statusEl.classList.remove("running", "error");
  if (tone) {
    statusEl.classList.add(tone);
  }
}

function clearChat() {
  chatList.innerHTML = '<div class="hint">导入 JSON 后会显示在这里。</div>';
}

function appendMessage(side, content) {
  const wrapper = document.createElement("div");
  wrapper.className = `message ${side}`;

  const avatar = document.createElement("div");
  avatar.className = `avatar ${side}`;
  avatar.textContent = side === "pro" ? "正" : "反";

  const bubble = document.createElement("div");
  bubble.className = `bubble ${side}`;

  if (isMarkdownEnabled && typeof marked !== "undefined") {
    bubble.classList.add("markdown-content");
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
}

function normalizeSide(item, index) {
  if (item.side === "pro" || item.side === "con") {
    return item.side;
  }
  if (typeof item.role === "string") {
    if (item.role.includes("正")) {
      return "pro";
    }
    if (item.role.includes("反")) {
      return "con";
    }
  }
  if (typeof item.speaker === "string") {
    if (item.speaker.includes("正")) {
      return "pro";
    }
    if (item.speaker.includes("反")) {
      return "con";
    }
  }
  return index % 2 === 0 ? "pro" : "con";
}

function normalizeTranscript(rawTranscript) {
  if (!Array.isArray(rawTranscript)) {
    return [];
  }
  return rawTranscript
    .map((item, index) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const side = normalizeSide(item, index);
      const content = item.content || item.text || item.message || "";
      if (!content) {
        return null;
      }
      return { side, content };
    })
    .filter(Boolean);
}

function buildSummary(data, transcript) {
  const config = (data && data.config) || {};
  const topic = config.topic || data.topic || "（未提供）";
  const rounds = config.rounds || Math.ceil(transcript.length / 2) || 0;
  const exportTime = data.export_time || config.start_time || "（未提供）";
  const proModel = config.pro_model || "（未提供）";
  const conModel = config.con_model || "（未提供）";

  configSummary.innerHTML = `
    <div>
      <span>辩题</span>
      <strong>${topic}</strong>
    </div>
    <div>
      <span>轮数</span>
      <strong>${rounds}</strong>
    </div>
    <div>
      <span>消息条数</span>
      <strong>${transcript.length}</strong>
    </div>
    <div>
      <span>导出时间</span>
      <strong>${exportTime}</strong>
    </div>
    <div>
      <span>正方模型</span>
      <strong>${proModel}</strong>
    </div>
    <div>
      <span>反方模型</span>
      <strong>${conModel}</strong>
    </div>
  `;
}

function renderDebate(data) {
  clearChat();
  if (!data) {
    setStatus("无有效数据", "error");
    exportBtn.disabled = true;
    configSummary.textContent = "尚未载入任何辩论记录。";
    return;
  }

  const transcript = normalizeTranscript(data.transcript || data.messages || data.history || []);
  if (transcript.length === 0) {
    setStatus("未找到可展示的对话内容", "error");
    exportBtn.disabled = true;
    configSummary.textContent = "JSON 中没有有效的辩论记录。";
    return;
  }

  transcript.forEach((item) => appendMessage(item.side, item.content));
  buildSummary(data, transcript);
  exportBtn.disabled = false;
  setStatus("已载入辩论记录");
  currentData = {
    config: data.config || {},
    transcript: transcript,
  };
}

function parseJsonText(text) {
  if (!text.trim()) {
    setStatus("请输入 JSON 内容", "error");
    return null;
  }
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return { transcript: parsed };
    }
    return parsed;
  } catch (error) {
    setStatus("JSON 解析失败，请检查格式", "error");
    return null;
  }
}

loadBtn.addEventListener("click", () => {
  const text = importText.value;
  const data = parseJsonText(text);
  if (data) {
    renderDebate(data);
  }
});

clearBtn.addEventListener("click", () => {
  importText.value = "";
  importFile.value = "";
  currentData = null;
  exportBtn.disabled = true;
  clearChat();
  configSummary.textContent = "尚未载入任何辩论记录。";
  setStatus("已清空");
});

importFile.addEventListener("change", (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) {
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    importText.value = reader.result;
    const data = parseJsonText(reader.result);
    if (data) {
      renderDebate(data);
    }
  };
  reader.readAsText(file);
});

exportBtn.addEventListener("click", () => {
  if (!currentData || !currentData.transcript || currentData.transcript.length === 0) {
    setStatus("没有可导出的内容", "error");
    return;
  }
  const exportData = {
    config: currentData.config,
    transcript: currentData.transcript,
    export_time: new Date().toISOString(),
    total_rounds: currentData.transcript.length,
  };
  const jsonStr = JSON.stringify(exportData, null, 2);
  const blob = new Blob([jsonStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "debate_replay.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  setStatus("已导出当前记录");
});

markdownToggle.addEventListener("change", (event) => {
  isMarkdownEnabled = event.target.checked;
  if (currentData) {
    renderDebate({ ...currentData, config: currentData.config });
  }
});

fullscreenBtn.addEventListener("click", () => {
  chatContainer.classList.toggle("fullscreen");

  const svg = fullscreenBtn.querySelector("svg");
  if (chatContainer.classList.contains("fullscreen")) {
    svg.innerHTML = '<path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>';
  } else {
    svg.innerHTML = '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>';
  }
});
