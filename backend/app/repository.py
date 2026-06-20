"""Persistence behind a single interface.

The engine never knows where estimations live. By default they're written as
JSON files under DATA_DIR (zero-config local dev). Set the Cosmos vars and
install `azure-cosmos` to transparently swap in Azure Cosmos DB — same four
methods, same camelCase documents.
"""

from __future__ import annotations

import json
import logging
import threading
from abc import ABC, abstractmethod
from pathlib import Path

from .config import Settings, get_settings
from .schemas import Estimation

logger = logging.getLogger("costcompass.repository")


class EstimationRepository(ABC):
    @abstractmethod
    def save(self, estimation: Estimation) -> Estimation: ...

    @abstractmethod
    def get(self, est_id: str) -> Estimation | None: ...

    @abstractmethod
    def list(self) -> list[Estimation]: ...

    @abstractmethod
    def delete(self, est_id: str) -> bool: ...


class FileRepository(EstimationRepository):
    """JSON-file persistence with an in-memory cache. The default backend."""

    def __init__(self, data_dir: str) -> None:
        self._dir = Path(data_dir)
        self._dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._cache: dict[str, Estimation] = {}
        self._load_existing()

    def _path(self, est_id: str) -> Path:
        # est ids are app-generated slugs; guard against stray path separators.
        safe = est_id.replace("/", "_").replace("\\", "_")
        return self._dir / f"{safe}.json"

    def _load_existing(self) -> None:
        for f in self._dir.glob("*.json"):
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                est = Estimation.model_validate(data)
                self._cache[est.id] = est
            except Exception as exc:  # noqa: BLE001
                logger.warning("Skipping unreadable estimation %s: %s", f.name, exc)

    def save(self, estimation: Estimation) -> Estimation:
        with self._lock:
            self._cache[estimation.id] = estimation
            payload = estimation.model_dump(by_alias=True)
            self._path(estimation.id).write_text(json.dumps(payload, indent=2), encoding="utf-8")
        return estimation

    def get(self, est_id: str) -> Estimation | None:
        return self._cache.get(est_id)

    def list(self) -> list[Estimation]:
        return sorted(self._cache.values(), key=lambda e: e.generated_at, reverse=True)

    def delete(self, est_id: str) -> bool:
        with self._lock:
            existed = self._cache.pop(est_id, None) is not None
            p = self._path(est_id)
            if p.exists():
                p.unlink()
            return existed


class CosmosRepository(EstimationRepository):
    """Azure Cosmos DB backend. Lazily imports the SDK so it's optional."""

    def __init__(self, settings: Settings) -> None:
        from azure.cosmos import CosmosClient, PartitionKey  # type: ignore

        client = CosmosClient(settings.cosmos_endpoint, credential=settings.cosmos_key)
        db = client.create_database_if_not_exists(settings.cosmos_database)
        self._container = db.create_container_if_not_exists(
            id=settings.cosmos_container,
            partition_key=PartitionKey(path="/id"),
        )

    def save(self, estimation: Estimation) -> Estimation:
        self._container.upsert_item(estimation.model_dump(by_alias=True))
        return estimation

    def get(self, est_id: str) -> Estimation | None:
        try:
            item = self._container.read_item(item=est_id, partition_key=est_id)
            return Estimation.model_validate(item)
        except Exception:  # noqa: BLE001 - NotFound and transient errors alike
            return None

    def list(self) -> list[Estimation]:
        items = self._container.query_items(
            query="SELECT * FROM c ORDER BY c.generatedAt DESC",
            enable_cross_partition_query=True,
        )
        return [Estimation.model_validate(i) for i in items]

    def delete(self, est_id: str) -> bool:
        try:
            self._container.delete_item(item=est_id, partition_key=est_id)
            return True
        except Exception:  # noqa: BLE001
            return False


_repository: EstimationRepository | None = None


def get_repository() -> EstimationRepository:
    """Singleton factory: Cosmos when configured & importable, else file-backed."""
    global _repository
    if _repository is not None:
        return _repository

    settings = get_settings()
    if settings.cosmos_enabled:
        try:
            _repository = CosmosRepository(settings)
            logger.info("Using Azure Cosmos DB persistence")
            return _repository
        except Exception as exc:  # noqa: BLE001
            logger.warning("Cosmos configured but unavailable (%s); falling back to file store", exc)

    _repository = FileRepository(settings.data_dir)
    logger.info("Using local file persistence at %s", settings.data_dir)
    return _repository
