"""Provider-agnostic, tool-calling ReAct executor.

A specialist agent is a Thought -> Action -> Observation loop: the model thinks,
optionally calls a tool, reads the result, and repeats until it answers. This
runs that loop on *native* function/tool calling (OpenAI tools API or Anthropic
tools API), which is far more reliable than parsing "Action:" out of free text.

Tools are the deterministic `tools.Tool` objects — so every number the agent
surfaces came from the engine. The executor mutates the shared `ToolContext`
(tool results memoise into it) and appends a readable transcript to `ctx.steps`.
On any failure — no provider configured, SDK missing, network/auth error,
malformed output — it returns `None` so the caller falls back to running the
deterministic tool directly. The agentic layer is never a hard dependency.
"""

from __future__ import annotations

import json
import logging
from typing import Optional

from ...shared.config import get_settings
from ..tools import Tool, ToolContext, run_tool

logger = logging.getLogger("costcompass.react")

_MAX_TOKENS = 700


def _short(obj: object, n: int = 180) -> str:
    s = obj if isinstance(obj, str) else json.dumps(obj, default=str)
    return s if len(s) <= n else s[: n - 1] + "…"


def run_react(
    *,
    system: str,
    user: str,
    tools: list[Tool],
    ctx: ToolContext,
    agent_name: str,
    max_iters: int = 4,
) -> Optional[str]:
    """Drive one specialist's ReAct loop. Returns final text, or None on failure.

    Tool side effects land in `ctx` (artifacts/ledger), so even when the model's
    prose is discarded the deterministic results it triggered are captured.
    """
    provider = get_settings().llm_provider
    ctx.agent = agent_name
    try:
        if provider == "azure_openai":
            return _run_openai(system, user, tools, ctx, agent_name, max_iters)
        if provider == "anthropic":
            return _run_anthropic(system, user, tools, ctx, agent_name, max_iters)
        return None
    except Exception as exc:  # noqa: BLE001 - any failure => deterministic fallback
        logger.warning("ReAct agent %s failed: %s", agent_name, exc)
        ctx.steps.append({"agent": agent_name, "kind": "fallback", "content": f"Agent error: {exc}"})
        return None


def _exec_tool(name: str, args: dict, ctx: ToolContext, agent_name: str) -> object:
    ctx.steps.append({"agent": agent_name, "kind": "action", "content": f"{name}({_short(args, 80)})"})
    result = run_tool(name, args, ctx)
    ctx.steps.append({"agent": agent_name, "kind": "observation", "content": _short(result)})
    return result


# ── Azure OpenAI (function calling) ─────────────────────────────────

def _run_openai(system, user, tools, ctx, agent_name, max_iters) -> Optional[str]:
    from openai import AzureOpenAI

    s = get_settings()
    client = AzureOpenAI(
        azure_endpoint=s.azure_openai_endpoint,
        api_key=s.azure_openai_api_key,
        api_version=s.azure_openai_api_version,
        timeout=20.0,
        max_retries=1,
    )
    specs = [
        {"type": "function", "function": {"name": t.name, "description": t.description, "parameters": t.parameters}}
        for t in tools
    ]
    messages: list[dict] = [{"role": "system", "content": system}, {"role": "user", "content": user}]

    for _ in range(max_iters):
        resp = client.chat.completions.create(
            model=s.azure_openai_deployment,
            messages=messages,
            tools=specs or None,
            temperature=0,
            max_tokens=_MAX_TOKENS,
        )
        msg = resp.choices[0].message
        if msg.content:
            ctx.steps.append({"agent": agent_name, "kind": "thought", "content": _short(msg.content, 400)})
        if not msg.tool_calls:
            return msg.content or ""
        messages.append(
            {
                "role": "assistant",
                "content": msg.content or None,
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                    }
                    for tc in msg.tool_calls
                ],
            }
        )
        for tc in msg.tool_calls:
            try:
                args = json.loads(tc.function.arguments or "{}")
            except Exception:  # noqa: BLE001
                args = {}
            result = _exec_tool(tc.function.name, args, ctx, agent_name)
            messages.append(
                {"role": "tool", "tool_call_id": tc.id, "content": json.dumps(result, default=str)[:4000]}
            )
    return ""  # exhausted iterations without a final message — tools still ran


# ── Anthropic (tool use) ────────────────────────────────────────────

def _run_anthropic(system, user, tools, ctx, agent_name, max_iters) -> Optional[str]:
    from anthropic import Anthropic

    s = get_settings()
    kwargs: dict = {"api_key": s.anthropic_api_key, "timeout": 20.0, "max_retries": 1}
    if s.anthropic_base_url:
        kwargs["base_url"] = s.anthropic_base_url
    client = Anthropic(**kwargs)
    specs = [{"name": t.name, "description": t.description, "input_schema": t.parameters} for t in tools]
    messages: list[dict] = [{"role": "user", "content": user}]

    for _ in range(max_iters):
        resp = client.messages.create(
            model=s.classifier_model,
            max_tokens=_MAX_TOKENS,
            system=system,
            tools=specs or None,
            messages=messages,
        )
        text = "".join(b.text for b in resp.content if getattr(b, "type", None) == "text")
        if text:
            ctx.steps.append({"agent": agent_name, "kind": "thought", "content": _short(text, 400)})
        tool_uses = [b for b in resp.content if getattr(b, "type", None) == "tool_use"]
        if not tool_uses:
            return text
        messages.append({"role": "assistant", "content": [b.model_dump() for b in resp.content]})
        results = []
        for tu in tool_uses:
            result = _exec_tool(tu.name, dict(tu.input or {}), ctx, agent_name)
            results.append(
                {"type": "tool_result", "tool_use_id": tu.id, "content": json.dumps(result, default=str)[:4000]}
            )
        messages.append({"role": "user", "content": results})
    return ""
