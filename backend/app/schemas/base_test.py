"""Tests for SanitizedBaseModel."""
from __future__ import annotations

from enum import Enum
from typing import Optional

import pytest

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
