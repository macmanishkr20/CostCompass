"""Solution-architect node — a ReAct agent that *chooses the delivery platform*.

This is the second (and only other) place an LLM touches the pipeline. Given the
project's use cases and constraints, a ReAct loop (Thought -> Action -> Observation,
repeated) reasons about which delivery platform best fits and explains why. It may
call read-only tools to inspect the use-case mix, the stated constraints, the five
candidate platforms, and the deterministic keyword baseline.

Hard rule, same as the classifier: the LLM **never computes or states a cost**. It
only returns a platform *label* (one of five) plus a rationale. The deterministic
engine then prices that platform — so every dollar is still code-computed and the
Python/TypeScript twins stay in parity. When no LLM is configured (or the loop
fails), a deterministic heuristic that mirrors `classify_platform` is used, so the
pipeline's numbers are identical with or without the agent.
"""

from __future__ import annotations

import json
import logging
import re

from .config import get_settings
from .platforms import DEFAULT_PLATFORM, PLATFORM_PROFILES, classify_platform
from .schemas import ProjectInput

logger = logging.getLogger("costcompass.architect")

# Task types that are deterministic software, not AI — a heavy non-AI mix is a
# signal that a licensing/workflow platform may fit better than metered AI compute.
_NON_AI_TASKS = {"rules_workflow", "crud_lookup", "threshold_alerting"}
_AGENTIC_TASKS = {"multi_agent_orchestration"}

_VALID = set(PLATFORM_PROFILES.keys())
_MAX_ITERS = 5  # bound the loop so a wandering model can't stall the request


# ── Tools (read-only views the agent can request) ───────────────────

def _tool_list_platforms() -> str:
    lines = []
    suits = {
        "azure_paas": "cloud-native, request-driven AI; elastic metered compute",
        "aws": "teams already on AWS; same metered shape, AWS services",
        "gcp": "teams already on Google Cloud; same metered shape, Google services",
        "m365_copilot": "org-wide productivity inside Microsoft 365/SharePoint; AI bundled per seat",
        "on_prem": "self-hosted / data-resident / air-gapped; capex hardware + ops",
    }
    for key, p in PLATFORM_PROFILES.items():
        lines.append(f"- {key}: {p.label} | cost model: {p.cost_model} | best for: {suits.get(key, '')}")
    return "The five delivery platforms:\n" + "\n".join(lines)


def _tool_analyze_use_cases(inp: ProjectInput) -> str:
    ucs = inp.ai_use_cases or []
    types = [u.task_type or "unknown" for u in ucs]
    ai = [t for t in types if t not in _NON_AI_TASKS]
    non_ai = [t for t in types if t in _NON_AI_TASKS]
    agentic = [t for t in types if t in _AGENTIC_TASKS]
    return (
        f"{len(ucs)} use case(s). Task types: {', '.join(types) or 'none'}.\n"
        f"AI-led: {len(ai)} | deterministic/no-AI: {len(non_ai)} | agentic/multi-agent: {len(agentic)}.\n"
        f"Scale: {inp.scale}. Project type: {inp.project_type}."
    )


def _tool_read_constraints(inp: ProjectInput) -> str:
    tp = inp.technical_preferences
    vs = inp.volume_and_scale
    ca = inp.current_architecture
    users = vs.expected_daily_users if vs and vs.expected_daily_users is not None else "unknown"
    compliance = ", ".join(tp.compliance_requirements) if tp and tp.compliance_requirements else "none stated"
    return (
        f"Existing infra: {tp.existing_infra or 'not stated' if tp else 'not stated'}.\n"
        f"Preferred LLM provider: {tp.preferred_llm_provider if tp else 'not stated'}.\n"
        f"Deployment model: {tp.deployment_model if tp else 'not stated'}.\n"
        f"Hosting platform (detected repo): {ca.hosting_platform if ca and ca.hosting_platform else 'n/a'}.\n"
        f"Compliance: {compliance}.\n"
        f"Expected daily users (seat signal): {users}.\n"
        f"Domain: {inp.industry_domain or 'not stated'}."
    )


def _tool_baseline_guess(inp: ProjectInput) -> str:
    guess = classify_platform(inp)
    label = PLATFORM_PROFILES[guess].label
    return (
        f"The deterministic keyword classifier suggests '{guess}' ({label}). "
        "Treat this as a hint — override it if the use-case mix and constraints point elsewhere, "
        "but say why."
    )


def _run_tool(name: str, inp: ProjectInput) -> str:
    name = (name or "").strip().strip('"').strip("'")
    if name == "list_platforms":
        return _tool_list_platforms()
    if name == "analyze_use_cases":
        return _tool_analyze_use_cases(inp)
    if name == "read_constraints":
        return _tool_read_constraints(inp)
    if name == "baseline_guess":
        return _tool_baseline_guess(inp)
    return (
        f"Unknown tool '{name}'. Available: list_platforms, analyze_use_cases, "
        "read_constraints, baseline_guess."
    )


# ── ReAct prompt ────────────────────────────────────────────────────

_SYSTEM_PROMPT = (
    "You are a cloud solution architect. Choose the single best DELIVERY PLATFORM for a "
    "software project from this fixed set of keys:\n"
    "  azure_paas, aws, gcp, m365_copilot, on_prem\n\n"
    "Reason step by step and call tools to gather facts before deciding. You NEVER compute, "
    "estimate, or state any cost, price, dollar amount, or number of dollars — a separate "
    "deterministic engine does all costing. You only pick a platform key and justify it.\n\n"
    "Respond with EXACTLY one step at a time, in this format:\n"
    "Thought: <your reasoning>\n"
    "Action: <one of: list_platforms | analyze_use_cases | read_constraints | baseline_guess>\n\n"
    "After each Action you will receive:\n"
    "Observation: <tool result>\n\n"
    "When you have enough information, output your final decision instead of an Action:\n"
    "Thought: <final reasoning>\n"
    'Final Answer: {"platform": "<one key>", "rationale": "<2-3 sentences, no numbers>", '
    '"alternatives": [{"platform": "<key>", "whyNot": "<short reason>"}]}\n\n'
    "The platform and every alternatives[].platform MUST be one of the five keys. "
    "Do not wrap the Final Answer JSON in code fences."
)


def _user_prompt(inp: ProjectInput) -> str:
    return (
        f"Project: {inp.project_name}\n"
        f"Domain: {inp.industry_domain or 'unspecified'}\n"
        f"Description: {inp.description or '(none)'}\n\n"
        "Decide the best delivery platform. Start by gathering facts with the tools."
    )


# ── Provider adapters (free-text completion; reuse classifier config) ─

def _complete_text(messages: list[dict]) -> str | None:
    provider = get_settings().llm_provider
    if provider == "azure_openai":
        return _complete_azure(messages)
    if provider == "anthropic":
        return _complete_claude(messages)
    return None


def _complete_azure(messages: list[dict]) -> str | None:
    settings = get_settings()
    try:
        from openai import AzureOpenAI
    except Exception:  # pragma: no cover - SDK missing
        logger.warning("openai SDK not installed; cannot run Azure OpenAI architect.")
        return None
    try:
        client = AzureOpenAI(
            azure_endpoint=settings.azure_openai_endpoint,
            api_key=settings.azure_openai_api_key,
            api_version=settings.azure_openai_api_version,
            timeout=20.0,
            max_retries=1,
        )
        resp = client.chat.completions.create(
            model=settings.azure_openai_deployment,
            max_tokens=500,
            temperature=0,
            messages=messages,
        )
        return resp.choices[0].message.content or ""
    except Exception as exc:  # noqa: BLE001 - any failure => heuristic fallback
        logger.warning("Azure OpenAI architect step failed: %s", exc)
        return None


def _complete_claude(messages: list[dict]) -> str | None:
    settings = get_settings()
    try:
        from anthropic import Anthropic
    except Exception:  # pragma: no cover
        return None
    client_kwargs: dict = {"api_key": settings.anthropic_api_key, "timeout": 20.0, "max_retries": 1}
    if settings.anthropic_base_url:
        client_kwargs["base_url"] = settings.anthropic_base_url
    # Anthropic takes the system prompt as a top-level arg, not a message.
    system = next((m["content"] for m in messages if m["role"] == "system"), "")
    convo = [m for m in messages if m["role"] != "system"]
    try:
        client = Anthropic(**client_kwargs)
        msg = client.messages.create(
            model=settings.classifier_model,
            max_tokens=500,
            system=system,
            messages=convo,
        )
        return "".join(b.text for b in msg.content if getattr(b, "type", None) == "text")
    except Exception as exc:  # noqa: BLE001
        logger.warning("Claude architect step failed: %s", exc)
        return None


# ── Output parsing ──────────────────────────────────────────────────

def _extract_json_object(text: str) -> dict | None:
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        return json.loads(text[start : end + 1])
    except Exception:  # noqa: BLE001
        return None


def _parse_action(text: str) -> str | None:
    m = re.search(r"Action\s*:\s*([a-zA-Z_]+)", text)
    return m.group(1) if m else None


def _first_thought(text: str) -> str:
    m = re.search(r"Thought\s*:\s*(.+)", text)
    return m.group(1).strip() if m else ""


# ── Agent loop ──────────────────────────────────────────────────────

def _run_react_agent(inp: ProjectInput) -> dict | None:
    """Drive the Thought/Action/Observation loop. None on any failure."""
    messages: list[dict] = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": _user_prompt(inp)},
    ]
    steps: list[str] = []

    for _ in range(_MAX_ITERS):
        out = _complete_text(messages)
        if not out:
            return None

        if "Final Answer" in out:
            thought = _first_thought(out)
            if thought:
                steps.append(f"Thought: {thought}")
            data = _extract_json_object(out)
            if not data:
                return None
            platform = str(data.get("platform", "")).strip()
            if platform not in _VALID:
                logger.warning("Architect proposed invalid platform %r; falling back.", platform)
                return None
            alts = []
            for a in data.get("alternatives", []) or []:
                ap = str(a.get("platform", "")).strip()
                if ap in _VALID and ap != platform:
                    alts.append({"platform": ap, "why_not": str(a.get("whyNot") or a.get("why_not") or "")[:200]})
            rationale = str(data.get("rationale", "")).strip()[:600] or _DEFAULT_RATIONALE.get(platform, "")
            steps.append(f"Decision: {platform} — {rationale}")
            return _proposal(platform, rationale, alts[:3], steps, "agent")

        action = _parse_action(out)
        if not action:
            # Model produced neither an Action nor a Final Answer — give up cleanly.
            return None
        thought = _first_thought(out)
        if thought:
            steps.append(f"Thought: {thought}")
        observation = _run_tool(action, inp)
        steps.append(f"Action: {action} -> {observation.splitlines()[0][:140]}")
        # Feed the model its own turn plus the observation, continuing the loop.
        messages.append({"role": "assistant", "content": out})
        messages.append({"role": "user", "content": f"Observation: {observation}"})

    return None  # exhausted iterations without a decision


# ── Proposal builders ───────────────────────────────────────────────

_DEFAULT_RATIONALE = {
    "azure_paas": (
        "Azure PaaS uses a consumption model — metered compute, data and AI tokens — which "
        "suits a cloud-native build with elastic, request-driven AI workloads."
    ),
    "aws": (
        "AWS signals were detected; a consumption model on AWS keeps the same metered cost "
        "shape using the equivalent AWS services."
    ),
    "gcp": (
        "Google Cloud signals were detected; a consumption model on GCP keeps the metered "
        "cost shape using the equivalent Google services."
    ),
    "m365_copilot": (
        "Microsoft 365 / Copilot signals were detected; a per-seat licensing model fits an "
        "org-wide productivity rollout where AI is bundled into the seat rather than metered."
    ),
    "on_prem": (
        "On-premises / private-cloud signals were detected; a capex model (amortized hardware "
        "plus ops staffing) fits a self-hosted, data-resident deployment."
    ),
}


def _proposal(platform: str, rationale: str, alternatives: list[dict], steps: list[str], source: str) -> dict:
    profile = PLATFORM_PROFILES.get(platform) or PLATFORM_PROFILES[DEFAULT_PLATFORM]
    return {
        "recommended_platform": profile.key,
        "platform_label": profile.label,
        "cost_model": profile.cost_model,
        "rationale": rationale or _DEFAULT_RATIONALE.get(profile.key, ""),
        "alternatives": alternatives,
        "reasoning_steps": steps,
        "source": source,
    }


def _heuristic_proposal(inp: ProjectInput) -> dict:
    platform = classify_platform(inp)
    steps = [f"Heuristic: matched delivery signals to '{platform}' (no LLM available)."]
    return _proposal(platform, _DEFAULT_RATIONALE.get(platform, ""), [], steps, "heuristic")


def _explicit_proposal(platform: str, inp: ProjectInput) -> dict:
    profile = PLATFORM_PROFILES.get(platform) or PLATFORM_PROFILES[DEFAULT_PLATFORM]
    rationale = (
        f"{profile.label} was explicitly selected, so the estimate is built against its "
        f"{profile.cost_model} cost model."
    )
    return _proposal(profile.key, rationale, [], [], "explicit")


def propose_solution(inp: ProjectInput) -> dict:
    """Return a solution proposal dict (snake_case, ready for SolutionProposal).

    Order of precedence:
      1. An explicit user platform choice wins (no inference).
      2. The ReAct agent, when an LLM provider is configured.
      3. A deterministic heuristic mirroring `classify_platform`.

    Always returns a dict — never raises — so the pipeline can rely on it.
    """
    tp = inp.technical_preferences
    explicit = tp.delivery_platform if tp else None
    if explicit:
        return _explicit_proposal(explicit, inp)

    if get_settings().llm_enabled:
        try:
            agent = _run_react_agent(inp)
        except Exception as exc:  # noqa: BLE001 - never let the agent break a request
            logger.warning("Architect agent crashed, using heuristic: %s", exc)
            agent = None
        if agent is not None:
            return agent

    return _heuristic_proposal(inp)
