"""Use-case classification — the ONLY place an LLM touches the pipeline.

Free-text or blank use cases are mapped to one of the catalog's task types so
the deterministic engine can price them. When an Anthropic key is configured
Claude does the mapping; otherwise a keyword heuristic runs. Either way the
LLM only ever returns a label from a fixed set — it never computes a cost.
"""

from __future__ import annotations

import json
import logging

from .catalog import TASK_TYPES
from .config import get_settings
from .schemas import AIUseCase

logger = logging.getLogger("costcompass.classifier")

# Priority-ordered keyword → task-type rules. First match wins, so the more
# specific / higher-intensity patterns are listed before the generic ones.
_KEYWORD_RULES: list[tuple[tuple[str, ...], str]] = [
    (("multi-agent", "multi agent", "orchestrat", "coordinat agent", "agent team"), "multi_agent_orchestration"),
    (("rag", "retriev", "knowledge base", "knowledge-base", "q&a", "qa over", "ask your", "ask the docs"), "rag_qa"),
    (("summar", "tl;dr", "digest", "recap"), "summarization"),
    (("translat", "localis", "localiz", "multilingual"), "translation"),
    (("ocr", "image", "vision", "photo", "picture", "screenshot", "visual"), "image_analysis"),
    (("contract", "document analysis", "analyse document", "analyze document", "pdf", "invoice parsing"), "document_analysis"),
    (("classif", "categor", "triage", "sentiment", "tag ", "label ", "routing", "intent"), "text_classification"),
    (("extract", "parse", "scrape", "pull fields", "structured data"), "data_extraction"),
    (("code", "program", "sql generat", "refactor", "unit test", "boilerplate"), "code_generation"),
    (("recommend", "suggest", "personaliz", "personalis", "next best"), "recommendation"),
    (("anomaly", "fraud", "outlier", "intrusion", "threat detect"), "anomaly_detection"),
    (("chatbot", "chat bot", "assistant", "conversation", "copilot", "agent", "chat"), "conversational_agent"),
]

_DEFAULT_TASK = "rag_qa"


def heuristic_task_type(text: str) -> str:
    """Deterministic keyword mapping; the fallback when no LLM is available."""
    t = (text or "").lower()
    for keywords, task in _KEYWORD_RULES:
        if any(k in t for k in keywords):
            return task
    return _DEFAULT_TASK


def _classify_with_claude(items: list[tuple[str, str]]) -> dict[int, str] | None:
    """Ask Claude to label each (name, description). Returns None on any failure."""
    settings = get_settings()
    try:
        from anthropic import Anthropic
    except Exception:  # pragma: no cover - SDK always present per requirements
        return None

    client_kwargs: dict = {"api_key": settings.anthropic_api_key}
    if settings.anthropic_base_url:
        client_kwargs["base_url"] = settings.anthropic_base_url

    listing = "\n".join(f"{i}. {name} — {desc}" for i, (name, desc) in enumerate(items))
    prompt = (
        "Classify each software use case below into exactly one task type from this set:\n"
        f"{', '.join(TASK_TYPES)}.\n\n"
        "Use cases:\n"
        f"{listing}\n\n"
        'Respond with ONLY a JSON object mapping the index (as a string) to the task type, '
        'e.g. {"0": "rag_qa", "1": "summarization"}. No prose.'
    )

    try:
        client = Anthropic(**client_kwargs)
        msg = client.messages.create(
            model=settings.classifier_model,
            max_tokens=400,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = "".join(block.text for block in msg.content if getattr(block, "type", None) == "text").strip()
        # Tolerate fenced output.
        if raw.startswith("```"):
            raw = raw.strip("`").split("\n", 1)[-1]
        start, end = raw.find("{"), raw.rfind("}")
        parsed = json.loads(raw[start : end + 1])
        out: dict[int, str] = {}
        for k, v in parsed.items():
            idx = int(k)
            out[idx] = v if v in TASK_TYPES else heuristic_task_type(items[idx][0] + " " + items[idx][1])
        return out
    except Exception as exc:  # noqa: BLE001 - any failure means fall back to heuristic
        logger.warning("Claude classify failed, using heuristic: %s", exc)
        return None


def classify_use_cases(use_cases: list[AIUseCase]) -> list[AIUseCase]:
    """Fill in any missing/invalid task types. Returns a new list (inputs untouched)."""
    if not use_cases:
        return use_cases

    needs: list[int] = [
        i for i, uc in enumerate(use_cases)
        if not uc.task_type or uc.task_type not in TASK_TYPES
    ]
    if not needs:
        return use_cases

    resolved: dict[int, str] = {}
    settings = get_settings()
    if settings.llm_enabled:
        items = [(use_cases[i].name, use_cases[i].description) for i in needs]
        llm = _classify_with_claude(items)
        if llm is not None:
            resolved = {needs[j]: llm.get(j, heuristic_task_type(items[j][0] + " " + items[j][1])) for j in range(len(needs))}

    out: list[AIUseCase] = []
    for i, uc in enumerate(use_cases):
        if i in needs:
            task = resolved.get(i) or heuristic_task_type(f"{uc.name} {uc.description}")
            out.append(uc.model_copy(update={"task_type": task}))
        else:
            out.append(uc)
    return out
