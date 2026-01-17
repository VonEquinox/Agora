import asyncio
import json
import logging
import os
from typing import Optional
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
from openai import OpenAI
from pydantic import BaseModel, Field


load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("debate")

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")

_client_cache: dict[tuple[str, str], OpenAI] = {}


class TranscriptItem(BaseModel):
    side: str
    content: str


class DebateRequest(BaseModel):
    topic: str = Field(..., min_length=1, max_length=200)
    pro_system: str = Field(
        default=(
            "你是正方。必须理性、客观、克制，严禁诡辩、偷换概念或情绪化攻击。"
            "禁止套话/称呼评委/对方辩友/开场寒暄，直接进入观点。"
        )
    )
    con_system: str = Field(
        default=(
            "你是反方。必须理性、客观、克制，严禁诡辩、偷换概念或情绪化攻击。"
            "禁止套话/称呼评委/对方辩友/开场寒暄，直接进入观点。"
        )
    )
    rounds: int = Field(default=4, ge=1)
    pro_model: Optional[str] = None
    con_model: Optional[str] = None
    pro_api_key: Optional[str] = None
    con_api_key: Optional[str] = None
    pro_base_url: Optional[str] = None
    con_base_url: Optional[str] = None
    temperature: float = Field(default=1.0, ge=0.0, le=2.0)
    transcript: Optional[list[TranscriptItem]] = None


def get_client(api_key: str, base_url: Optional[str]) -> OpenAI:
    if not api_key:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY is not set.")
    normalized = base_url or ""
    cache_key = (api_key, normalized)
    if cache_key in _client_cache:
        return _client_cache[cache_key]
    if base_url:
        client = OpenAI(api_key=api_key, base_url=base_url)
    else:
        client = OpenAI(api_key=api_key)
    _client_cache[cache_key] = client
    return client


def mask_key(api_key: str) -> str:
    if not api_key:
        return "missing"
    if len(api_key) <= 8:
        return "***"
    return f"{api_key[:3]}***{api_key[-4:]}"


def _extract_content_from_dict(payload: dict, depth: int = 0) -> str:
    if depth > 3:
        return ""

    content = payload.get("content")
    if isinstance(content, str) and content.strip():
        return content.strip()

    choices = payload.get("choices")
    if isinstance(choices, list) and choices:
        choice0 = choices[0]
        if isinstance(choice0, dict):
            message = choice0.get("message")
            if isinstance(message, dict):
                msg_content = message.get("content")
                if isinstance(msg_content, str) and msg_content.strip():
                    return msg_content.strip()
            delta = choice0.get("delta")
            if isinstance(delta, dict):
                delta_content = delta.get("content")
                if isinstance(delta_content, str) and delta_content.strip():
                    return delta_content.strip()
            choice_text = choice0.get("text")
            if isinstance(choice_text, str) and choice_text.strip():
                return choice_text.strip()

    output = payload.get("output")
    if isinstance(output, list) and output:
        first = output[0]
        if isinstance(first, dict):
            contents = first.get("content")
            if isinstance(contents, list) and contents:
                for entry in contents:
                    if isinstance(entry, dict):
                        entry_text = entry.get("text")
                        if isinstance(entry_text, str) and entry_text.strip():
                            return entry_text.strip()

    for key in ("part", "item"):
        nested = payload.get(key)
        if isinstance(nested, dict):
            nested_text = _extract_content_from_dict(nested, depth + 1)
            if nested_text:
                return nested_text

    return ""


def _extract_content_from_sse(text: str) -> str:
    fallback_text = ""
    delta_parts: list[str] = []
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("data:"):
            continue
        data = line[5:].strip()
        if not data or data == "[DONE]":
            continue
        try:
            payload = json.loads(data)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            choices = payload.get("choices")
            if isinstance(choices, list) and choices:
                delta = choices[0].get("delta")
                if isinstance(delta, dict):
                    delta_content = delta.get("content")
                    if isinstance(delta_content, str) and delta_content:
                        delta_parts.append(delta_content)
                        continue
            if not delta_parts:
                candidate = _extract_content_from_dict(payload)
                if candidate and len(candidate) >= len(fallback_text):
                    fallback_text = candidate
    if delta_parts:
        return "".join(delta_parts)
    if fallback_text:
        return fallback_text
    return ""


def _extract_content_from_text(text: str) -> str:
    stripped = text.strip()
    if not stripped:
        return ""
    if "data:" in stripped:
        sse_text = _extract_content_from_sse(stripped)
        if sse_text:
            return sse_text
    if stripped.startswith("{") or stripped.startswith("["):
        try:
            payload = json.loads(stripped)
        except json.JSONDecodeError:
            return stripped
        if isinstance(payload, dict):
            return _extract_content_from_dict(payload) or stripped
    return stripped


def get_app_bind() -> tuple[str, int]:
    app_url = os.getenv("APP_URL", "")
    if app_url:
        parsed = urlparse(app_url)
        host = parsed.hostname or "127.0.0.1"
        port = parsed.port or 8000
        return host, port
    host = os.getenv("APP_HOST", "127.0.0.1")
    port = int(os.getenv("APP_PORT", "8000"))
    return host, port


def resolve_side_config(
    payload: DebateRequest,
    *,
    side: str,
) -> tuple[str, str, Optional[str]]:
    if side == "pro":
        api_key = payload.pro_api_key or os.getenv("OPENAI_API_KEY_PRO")
        base_url = payload.pro_base_url or os.getenv("OPENAI_BASE_URL_PRO")
        model = payload.pro_model or os.getenv("OPENAI_MODEL_PRO")
        if not api_key:
            raise HTTPException(status_code=500, detail="OPENAI_API_KEY for pro side is not set.")
        if not model:
            raise HTTPException(status_code=500, detail="OPENAI_MODEL for pro side is not set.")
        return model, api_key, base_url
    api_key = payload.con_api_key or os.getenv("OPENAI_API_KEY_CON")
    base_url = payload.con_base_url or os.getenv("OPENAI_BASE_URL_CON")
    model = payload.con_model or os.getenv("OPENAI_MODEL_CON")
    if not api_key:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY for con side is not set.")
    if not model:
        raise HTTPException(status_code=500, detail="OPENAI_MODEL for con side is not set.")
    return model, api_key, base_url


def build_system_prompt(side: str, topic: str, side_prompt: str) -> str:
    role = "正方" if side == "pro" else "反方"
    return (
        f"你是辩论{role}，围绕辩题展开论证。\n"
        f"辩题：{topic}\n"
        f"立场提示：{side_prompt}\n"
        "禁止套话/称呼评委/对方辩友/开场寒暄，直接进入观点。"
    )


def build_user_prompt(transcript: list[tuple[str, str]], side: str) -> str:
    if transcript:
        history = "\n".join(
            f"{'正方' if s == 'pro' else '反方'}：{content}" for s, content in transcript
        )
    else:
        history = "（暂无）"
    return (
        "以下是已发生的辩论记录：\n"
        f"{history}\n\n"
        f"现在轮到你（{'正方' if side == 'pro' else '反方'}）发言，请输出你的下一段："
    )


def generate_message(
    *,
    model: str,
    system_prompt: str,
    user_prompt: str,
    temperature: float,
    api_key: str,
    base_url: Optional[str],
) -> str:
    client = get_client(api_key, base_url)
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=temperature,
    )
    if hasattr(response, "choices"):
        message = response.choices[0].message
        content = (message.content or "").strip()
        if content:
            return content
        refusal = getattr(message, "refusal", None)
        if refusal:
            return f"【拒绝回答】{refusal.strip()}"
        return "（模型未返回内容，请检查模型/Key/Base URL）"

    if isinstance(response, dict):
        return _extract_content_from_dict(response)

    if isinstance(response, str):
        content = _extract_content_from_text(response)
        if content:
            return content
        logger.warning("non-standard response text: %s", response[:200])
        return "（模型返回了非标准内容，请检查 Base URL 兼容性）"

    logger.warning("unexpected response type: %s", type(response))
    return "（模型返回了未知格式，请检查 Base URL 兼容性）"


@app.get("/")
def index() -> FileResponse:
    return FileResponse("static/index.html")


@app.get("/archive")
def archive() -> FileResponse:
    return FileResponse("static/archive.html")


@app.post("/api/debate/stream")
async def debate_stream(request: Request) -> StreamingResponse:
    payload = DebateRequest(**(await request.json()))
    transcript: list[tuple[str, str]] = []
    if payload.transcript:
        for item in payload.transcript:
            side = item.side
            if side not in ("pro", "con"):
                raise HTTPException(status_code=400, detail="Invalid transcript side.")
            transcript.append((side, item.content))
    total_messages = payload.rounds * 2
    if len(transcript) > total_messages:
        raise HTTPException(status_code=400, detail="Transcript length exceeds total rounds.")

    async def event_generator():
        try:
            start_index = len(transcript)
            for i in range(start_index, total_messages):
                side = "pro" if i % 2 == 0 else "con"
                side_prompt = payload.pro_system if side == "pro" else payload.con_system
                system_prompt = build_system_prompt(side, payload.topic, side_prompt)
                user_prompt = build_user_prompt(transcript, side)
                model, api_key, base_url = resolve_side_config(
                    payload,
                    side=side,
                )
                logger.info(
                    "call model side=%s model=%s base_url=%s key=%s",
                    side,
                    model,
                    base_url or "default",
                    mask_key(api_key),
                )
                message = await asyncio.to_thread(
                    generate_message,
                    model=model,
                    system_prompt=system_prompt,
                    user_prompt=user_prompt,
                    temperature=payload.temperature,
                    api_key=api_key,
                    base_url=base_url,
                )
                transcript.append((side, message))
                yield json.dumps(
                    {"type": "message", "side": side, "content": message},
                    ensure_ascii=False,
                ) + "\n"
            yield json.dumps({"type": "done", "count": len(transcript)}, ensure_ascii=False) + "\n"
        except Exception as exc:  # pragma: no cover - streaming path
            logger.exception("debate stream error: %s", exc)
            yield json.dumps(
                {"type": "error", "message": str(exc)},
                ensure_ascii=False,
            ) + "\n"

    return StreamingResponse(event_generator(), media_type="application/x-ndjson")


if __name__ == "__main__":
    import uvicorn

    host, port = get_app_bind()
    uvicorn.run("main:app", host=host, port=port, reload=True)
