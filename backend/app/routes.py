"""HTTP surface: estimate, stream, fetch, list, and export.

The Angular client posts a ProjectInput and gets back an Estimation whose JSON
matches its TypeScript models byte-for-byte (camelCase). The /stream variant
emits the same Server-Sent Event shape the mock used, so the UI's progress
animation works against the real backend unchanged.
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response, StreamingResponse

from .pipeline import SSE_STEPS, run_pipeline
from .repository import get_repository
from .schemas import Estimation, ProjectInput
from .exports import estimation_to_excel, estimation_to_pdf

router = APIRouter(prefix="/api")


def _new_id() -> str:
    # Compact, sortable-ish id mirroring the Angular `est_<base36 time>` style.
    return f"est_{int(time.time() * 1000):x}"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@router.get("/health")
def health() -> dict:
    from .config import get_settings

    s = get_settings()
    return {
        "status": "ok",
        "version": "0.4.0",
        "llmClassifier": s.llm_enabled,
        "persistence": "cosmos" if s.cosmos_enabled else "file",
    }


@router.post("/estimations", response_model=Estimation, response_model_by_alias=True)
def create_estimation(payload: ProjectInput) -> Estimation:
    est = run_pipeline(payload, _new_id(), _now_iso())
    get_repository().save(est)
    return est


@router.post("/estimations/stream")
def stream_estimation(payload: ProjectInput) -> StreamingResponse:
    est_id = _new_id()
    generated_at = _now_iso()

    def event_gen():
        # Compute up front (deterministic, fast); stream the progress narrative.
        est = run_pipeline(payload, est_id, generated_at)
        get_repository().save(est)

        for step in SSE_STEPS:
            yield f"data: {json.dumps(step)}\n\n"
            time.sleep(0.35)

        final = {
            "node": "report",
            "status": "complete",
            "content": "Done",
            "progress": 100,
            "data": {"id": est.id, "estimation": est.model_dump(by_alias=True)},
        }
        yield f"data: {json.dumps(final)}\n\n"

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/estimations", response_model=list[Estimation], response_model_by_alias=True)
def list_estimations() -> list[Estimation]:
    return get_repository().list()


@router.get("/estimations/{est_id}", response_model=Estimation, response_model_by_alias=True)
def get_estimation(est_id: str) -> Estimation:
    est = get_repository().get(est_id)
    if est is None:
        raise HTTPException(status_code=404, detail="Estimation not found")
    return est


def _require(est_id: str) -> Estimation:
    est = get_repository().get(est_id)
    if est is None:
        raise HTTPException(status_code=404, detail="Estimation not found")
    return est


def _slug(name: str) -> str:
    return "".join(c if c.isalnum() else "-" for c in name).strip("-").lower() or "estimate"


@router.get("/estimations/{est_id}/export/pdf")
def export_pdf(est_id: str) -> Response:
    est = _require(est_id)
    data = estimation_to_pdf(est)
    return Response(
        content=data,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{_slug(est.project_name)}-costcompass.pdf"'},
    )


@router.get("/estimations/{est_id}/export/excel")
def export_excel(est_id: str) -> Response:
    est = _require(est_id)
    data = estimation_to_excel(est)
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{_slug(est.project_name)}-costcompass.xlsx"'},
    )
