"""Live dependency health probes (Cosmos DB, Azure OpenAI).

Unlike the `/api/health` summary — which only echoes *configured* flags — these
probes make a real, lightweight authenticated round-trip to each external
service and report whether it actually answers. They never raise: every failure
is caught and returned as a structured ``{"ok": false, ...}`` payload so the
endpoint itself stays up even when the dependency is down. No secrets are
returned; keys are masked.
"""

from __future__ import annotations

import time

from .shared.config import get_settings


def _mask(secret: str | None) -> str:
    """Show just enough of a secret to recognise it, never enough to use it."""
    if not secret:
        return "(empty)"
    return f"{secret[:8]}…{secret[-4:]}" if len(secret) > 14 else "set"


def check_cosmos() -> dict:
    """Authenticated read against the configured Cosmos account.

    Reads the database metadata (a real signed request) rather than writing, so
    the check is side-effect free. Validates endpoint + key + database existence.
    """
    s = get_settings()
    result: dict = {
        "service": "cosmos",
        "configured": s.cosmos_enabled,
        "endpoint": s.cosmos_endpoint,
        "database": s.cosmos_database,
        "container": s.cosmos_container,
        "keyMasked": _mask(s.cosmos_key),
    }
    if not s.cosmos_enabled:
        result.update(ok=False, detail="Cosmos not configured (cosmos_endpoint/cosmos_key unset); app uses the local file store.")
        return result

    t0 = time.perf_counter()
    try:
        from azure.cosmos import CosmosClient

        client = CosmosClient(s.cosmos_endpoint, credential=s.cosmos_key)
        db = client.get_database_client(s.cosmos_database)
        db.read()  # signed, authenticated round-trip
        container = db.get_container_client(s.cosmos_container)
        container.read()
        result.update(
            ok=True,
            latencyMs=round((time.perf_counter() - t0) * 1000, 1),
            detail="Authenticated read of database and container succeeded.",
        )
    except Exception as exc:  # noqa: BLE001 - report, never raise
        result.update(
            ok=False,
            latencyMs=round((time.perf_counter() - t0) * 1000, 1),
            errorType=type(exc).__name__,
            error=str(exc).splitlines()[0][:300],
        )
    return result


def check_azure_openai() -> dict:
    """Minimal chat completion against the configured Azure OpenAI deployment.

    A 1-token completion validates endpoint + key + api_version + deployment in
    one real call — the cheapest request that exercises the full auth path.
    """
    s = get_settings()
    result: dict = {
        "service": "azureOpenAI",
        "configured": s.azure_openai_enabled,
        "provider": s.llm_provider,
        "endpoint": s.azure_openai_endpoint,
        "deployment": s.azure_openai_deployment,
        "apiVersion": s.azure_openai_api_version,
        "keyMasked": _mask(s.azure_openai_api_key),
    }
    if not s.azure_openai_enabled:
        result.update(ok=False, detail="Azure OpenAI not configured (azure_openai_endpoint/azure_openai_api_key unset); classifier/architect use the heuristic fallback.")
        return result

    t0 = time.perf_counter()
    try:
        from openai import AzureOpenAI

        client = AzureOpenAI(
            azure_endpoint=s.azure_openai_endpoint,
            api_key=s.azure_openai_api_key,
            api_version=s.azure_openai_api_version,
            timeout=20.0,
            max_retries=1,
        )
        resp = client.chat.completions.create(
            model=s.azure_openai_deployment,
            max_tokens=1,
            temperature=0,
            messages=[{"role": "user", "content": "ping"}],
        )
        result.update(
            ok=True,
            latencyMs=round((time.perf_counter() - t0) * 1000, 1),
            model=resp.model,
            detail="Chat completion round-trip succeeded.",
        )
    except Exception as exc:  # noqa: BLE001 - report, never raise
        result.update(
            ok=False,
            latencyMs=round((time.perf_counter() - t0) * 1000, 1),
            errorType=type(exc).__name__,
            error=str(exc).splitlines()[0][:300],
        )
    return result
