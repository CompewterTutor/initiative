"""Tests for SanitizedBaseModel."""
from __future__ import annotations

import importlib
import pkgutil
from enum import Enum
from typing import Optional

import pytest
from pydantic import BaseModel

import app.schemas as schemas_pkg
from app.schemas.base import RichTextStr, SanitizedBaseModel


class _Color(str, Enum):
    red = "red"
    blue = "blue"


class _Model(SanitizedBaseModel):
    name: str
    bio: Optional[str] = None
    rich: RichTextStr = ""
    count: int = 0
    enabled: bool = False
    color: _Color = _Color.red


@pytest.mark.unit
def test_strips_script_tags() -> None:
    m = _Model(name="<script>alert(1)</script>hello")
    assert "<script>" not in m.name
    assert "alert(1)" not in m.name
    assert m.name == "hello"


@pytest.mark.unit
def test_preserves_safe_html() -> None:
    m = _Model(name="<b>bold</b>")
    assert m.name == "<b>bold</b>"


@pytest.mark.unit
def test_rich_text_preserves_script() -> None:
    raw = "<script>alert(1)</script>hello"
    m = _Model(name="x", rich=raw)
    assert m.rich == raw


@pytest.mark.unit
def test_enum_field_not_modified() -> None:
    # Enums should never be coerced through nh3.clean.
    m = _Model(name="x", color=_Color.blue)
    assert m.color is _Color.blue

    # Same goes for string-form enum values.
    m2 = _Model(name="x", color="red")
    assert m2.color is _Color.red


@pytest.mark.unit
def test_non_str_fields_not_modified() -> None:
    m = _Model(name="x", count=42, enabled=True)
    assert m.count == 42
    assert m.enabled is True


@pytest.mark.unit
def test_plain_text_passes_through() -> None:
    m = _Model(name="plain text without html")
    assert m.name == "plain text without html"


@pytest.mark.unit
def test_optional_str_sanitized_when_present() -> None:
    m = _Model(name="x", bio="<script>x</script>safe")
    assert m.bio == "safe"


@pytest.mark.unit
def test_optional_str_none_passes_through() -> None:
    m = _Model(name="x", bio=None)
    assert m.bio is None


@pytest.mark.unit
def test_javascript_url_stripped() -> None:
    m = _Model(name='<a href="javascript:bad()">link</a>')
    assert "javascript:" not in m.name


@pytest.mark.unit
def test_every_schema_extends_sanitized_base() -> None:
    """Lint: every Pydantic class in app.schemas must extend SanitizedBaseModel.

    Catches the case where a new schema is added that inherits directly from
    pydantic.BaseModel, silently bypassing HTML sanitization on its str fields.
    """
    offenders: list[str] = []
    for module_info in pkgutil.iter_modules(schemas_pkg.__path__):
        if module_info.name.endswith("_test"):
            continue
        module = importlib.import_module(f"app.schemas.{module_info.name}")
        for attr_name in dir(module):
            attr = getattr(module, attr_name)
            if not isinstance(attr, type):
                continue
            if attr is BaseModel or attr is SanitizedBaseModel:
                continue
            if not issubclass(attr, BaseModel):
                continue
            # Skip classes re-exported from elsewhere.
            if not attr.__module__.startswith("app.schemas"):
                continue
            if not issubclass(attr, SanitizedBaseModel):
                offenders.append(f"{attr.__module__}.{attr.__name__}")
    assert not offenders, (
        "These Pydantic classes in app.schemas do not extend SanitizedBaseModel:\n"
        + "\n".join(f"  - {o}" for o in offenders)
        + "\n\nInherit from SanitizedBaseModel (app.schemas.base) instead of"
        " BaseModel so str fields are HTML-sanitized by default."
    )
