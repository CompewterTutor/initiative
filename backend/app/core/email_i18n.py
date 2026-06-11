"""Simple JSON-based i18n loader for email templates.

Usage:
    from app.core.email_i18n import email_t

    email_t("verification.subject")                    # "Verify your Initiative account"
    email_t("verification.greeting", name="Jordan")    # "Hi Jordan,"
    email_t("overdue.body", count=3)                   # picks _one/_other based on count
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path


_LOCALES_DIR = Path(__file__).resolve().parent.parent / "locales"
_VAR_RE = re.compile(r"\{\{(\w+)\}\}")


@lru_cache(maxsize=32)
def _load_locale(locale: str, namespace: str) -> dict:
    path = (_LOCALES_DIR / locale / f"{namespace}.json").resolve()
    if not path.is_relative_to(_LOCALES_DIR.resolve()):
        return {}
    if not path.exists():
        return {}
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _lookup(key: str, locale: str, namespace: str, count: int | None) -> str | None:
    """Resolve a key (with optional plural suffix) within a single locale."""
    data = _load_locale(locale, namespace)
    if count is not None:
        suffix = "_one" if int(count) == 1 else "_other"
        plural_value = _resolve_key(data, f"{key}{suffix}")
        if plural_value is not None:
            return plural_value
    return _resolve_key(data, key)


def _resolve_key(data: dict, key: str) -> str | None:
    """Walk dot-separated key through nested dict."""
    parts = key.split(".")
    current: dict | str = data
    for part in parts:
        if isinstance(current, dict):
            current = current.get(part)  # type: ignore[assignment]
            if current is None:
                return None
        else:
            return None
    return current if isinstance(current, str) else None


def translate(
    key: str, locale: str = "en", *, namespace: str = "email", **kwargs: str | int
) -> str:
    """Look up a translation key with ``{{var}}`` interpolation.

    ``namespace`` selects the per-locale JSON file (``email`` or
    ``notifications``). Supports simple plural selection via the ``count``
    kwarg: if ``count`` is provided and a ``_one`` / ``_other`` suffixed key
    exists, the appropriate variant is returned.

    Resolution falls back to the ``en`` locale when the key is missing for the
    requested locale (e.g. a locale file that hasn't been translated yet), so
    callers never surface a raw key to users. If the key is missing everywhere,
    the key itself is returned as a last resort.
    """
    count = kwargs.get("count")
    value = _lookup(key, locale, namespace, count)
    if value is None and locale != "en":
        value = _lookup(key, "en", namespace, count)
    if value is None:
        return key  # last-resort fallback: return the key itself

    return _VAR_RE.sub(lambda m: str(kwargs.get(m.group(1), m.group(0))), value)


def email_t(key: str, locale: str = "en", **kwargs: str | int) -> str:
    """Translate a key from the ``email`` namespace (back-compatible helper)."""
    return translate(key, locale, namespace="email", **kwargs)
