"""Use-case classification — the ONLY place an LLM touches the pipeline.

Free-text or blank use cases are mapped to one of the catalog's task types so
the deterministic engine can price them. The provider auto-selects: Azure
OpenAI when configured, else Anthropic, else a keyword heuristic. Whichever
runs, the LLM only ever returns a label from a fixed set — it never computes
a cost.
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
    # Deterministic capabilities — match before the conversational catch-all so a plain
    # lookup or rules flow isn't swept up as an AI assistant.
    (("crud", "look up", "lookup", "status check", "record retrieval", "data entry", "form submission", "database query"), "crud_lookup"),
    (("approval workflow", "business rule", "rules engine", "if-then", "decision table", "deterministic workflow", "state machine"), "rules_workflow"),
    (("threshold", "alert when", "monitoring alert", "sla breach", "limit exceeded", "metric alert"), "threshold_alerting"),
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


_SYSTEM_PROMPT = (
    "You label software use cases by task type. You only ever return a JSON "
    "object — never prose, never a cost or number."
)


def _build_prompt(items: list[tuple[str, str]]) -> str:
    """The shared classification instruction sent to whichever provider runs."""
    listing = "\n".join(f"{i}. {name} — {desc}" for i, (name, desc) in enumerate(items))
    return (
        "Classify each software use case below into exactly one task type from this set:\n"
        f"{', '.join(TASK_TYPES)}.\n\n"
        "Use cases:\n"
        f"{listing}\n\n"
        'Respond with ONLY a JSON object mapping the index (as a string) to the task type, '
        'e.g. {"0": "rag_qa", "1": "summarization"}. No prose.'
    )


def _parse_label_map(raw: str, items: list[tuple[str, str]]) -> dict[int, str]:
    """Extract {index: task_type} from a model's raw text, validating every label.

    Any label not in TASK_TYPES (or any parse glitch for a row) is replaced by
    the deterministic keyword heuristic, so a sloppy model can never inject an
    unpriceable task type.
    """
    raw = raw.strip()
    if raw.startswith("```"):  # tolerate fenced output
        raw = raw.strip("`").split("\n", 1)[-1]
    start, end = raw.find("{"), raw.rfind("}")
    parsed = json.loads(raw[start : end + 1])
    out: dict[int, str] = {}
    for k, v in parsed.items():
        idx = int(k)
        out[idx] = v if v in TASK_TYPES else heuristic_task_type(items[idx][0] + " " + items[idx][1])
    return out


def _classify_with_azure_openai(items: list[tuple[str, str]]) -> dict[int, str] | None:
    """Ask an Azure OpenAI deployment to label each item. None on any failure."""
    settings = get_settings()
    try:
        from openai import AzureOpenAI
    except Exception:  # pragma: no cover - openai SDK missing
        logger.warning("openai SDK not installed; cannot use Azure OpenAI classifier.")
        return None

    try:
        client = AzureOpenAI(
            azure_endpoint=settings.azure_openai_endpoint,
            api_key=settings.azure_openai_api_key,
            api_version=settings.azure_openai_api_version,
            # The classifier sits in the synchronous estimate request path; fail
            # fast to the heuristic rather than hang on a misconfigured endpoint.
            timeout=20.0,
            max_retries=1,
        )
        resp = client.chat.completions.create(
            model=settings.azure_openai_deployment,  # Azure: deployment name
            max_tokens=400,
            temperature=0,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": _build_prompt(items)},
            ],
        )
        raw = resp.choices[0].message.content or ""
        return _parse_label_map(raw, items)
    except Exception as exc:  # noqa: BLE001 - any failure means fall back to heuristic
        logger.warning("Azure OpenAI classify failed, using heuristic: %s", exc)
        return None


def _classify_with_claude(items: list[tuple[str, str]]) -> dict[int, str] | None:
    """Ask Claude to label each (name, description). Returns None on any failure."""
    settings = get_settings()
    try:
        from anthropic import Anthropic
    except Exception:  # pragma: no cover - SDK always present per requirements
        return None

    client_kwargs: dict = {"api_key": settings.anthropic_api_key, "timeout": 20.0, "max_retries": 1}
    if settings.anthropic_base_url:
        client_kwargs["base_url"] = settings.anthropic_base_url

    try:
        client = Anthropic(**client_kwargs)
        msg = client.messages.create(
            model=settings.classifier_model,
            max_tokens=400,
            messages=[{"role": "user", "content": _build_prompt(items)}],
        )
        raw = "".join(block.text for block in msg.content if getattr(block, "type", None) == "text")
        return _parse_label_map(raw, items)
    except Exception as exc:  # noqa: BLE001 - any failure means fall back to heuristic
        logger.warning("Claude classify failed, using heuristic: %s", exc)
        return None


def _classify_with_llm(items: list[tuple[str, str]]) -> dict[int, str] | None:
    """Dispatch to the configured provider (Azure OpenAI preferred)."""
    provider = get_settings().llm_provider
    if provider == "azure_openai":
        return _classify_with_azure_openai(items)
    if provider == "anthropic":
        return _classify_with_claude(items)
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
        llm = _classify_with_llm(items)
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
