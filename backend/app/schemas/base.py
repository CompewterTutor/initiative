"""Base schema with automatic HTML sanitization for str fields."""
from __future__ import annotations

import html
from enum import Enum
from typing import Annotated, Any

import nh3
from pydantic import BaseModel, model_validator


class _RichTextMarker:
    """Marker metadata: this field opts out of HTML sanitization."""


RichTextStr = Annotated[str, _RichTextMarker()]
"""Type alias for str fields that must NOT be sanitized (raw input preserved)."""


def _strip_to_plain_text(value: str) -> str:
    """Strip all HTML markup from a plain-text field WITHOUT HTML-encoding it.

    ``nh3.clean()`` is an HTML *output encoder*: it turns ``&`` into ``&amp;``,
    ``<`` into ``&lt;`` and so on, producing a string that is safe to drop into
    raw HTML. That is wrong for plain-text fields (names, titles, labels): the
    frontend renders them as React text nodes, which escape for the DOM at
    render time, so a stored ``&amp;`` shows up literally on screen as the four
    characters ``&amp;`` instead of ``&``.

    For these fields we want dangerous markup gone (``<img onerror>``,
    ``<script>``) but the benign characters the user actually typed (``&``,
    ``<``, ``>``, ``"``) preserved verbatim.

    The subtlety: a naive ``html.unescape(nh3.clean(value))`` unescapes *after*
    stripping, so an already-entity-encoded payload (``&lt;img onerror&gt;``)
    sails past ``nh3.clean`` as inert text and is then revived into live markup
    by the unescape. So we fully decode the input *first* — to a fixpoint, so
    markup encoded to any depth (``&amp;lt;…``) is exposed — and only then strip.
    Stripping with an empty allowlist also removes tags nh3's default allowlist
    would keep (e.g. ``<img src="x">``), which is what a plain-text field wants.
    """
    # Decode to a fixpoint before stripping. html.unescape returns a strictly
    # shorter string whenever it changes anything, so this terminates on its own
    # (no arbitrary iteration cap): worst case is one pass per entity.
    decoded = value
    while (once := html.unescape(decoded)) != decoded:
        decoded = once
    # Strip every tag, then undo the encoding nh3 applies to the surviving benign
    # characters. The final unescape is tag-free: ``decoded`` holds no entities,
    # so nh3 only ``&``-encodes lone </>/& that were never part of a tag.
    return html.unescape(nh3.clean(decoded, tags=set(), attributes={}))


def _is_rich_text(field_info) -> bool:
    return any(isinstance(m, _RichTextMarker) for m in field_info.metadata)


def _is_enum_type(annotation: Any) -> bool:
    if isinstance(annotation, type) and issubclass(annotation, Enum):
        return True
    # Handle Optional[SomeEnum], Union[SomeEnum, None], etc.
    args = getattr(annotation, "__args__", None)
    if args:
        return any(
            isinstance(a, type) and issubclass(a, Enum) for a in args
        )
    return False


class SanitizedBaseModel(BaseModel):
    """BaseModel that strips HTML markup from every str field by default.

    Plain-text fields have all tags removed without HTML-encoding the surviving
    characters, so ``Foo & Bar`` stays ``Foo & Bar`` (not ``Foo &amp; Bar``)
    while ``<img onerror>``/``<script>`` payloads are stripped — see
    :func:`_strip_to_plain_text`. Fields typed as :data:`RichTextStr` opt out
    entirely and keep raw input. Enum-typed fields are skipped.
    """

    @model_validator(mode="before")
    @classmethod
    def _sanitize_strings(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        for field_name, field_info in cls.model_fields.items():
            if _is_rich_text(field_info):
                continue
            if _is_enum_type(field_info.annotation):
                continue
            value = data.get(field_name)
            if isinstance(value, str):
                data[field_name] = _strip_to_plain_text(value)
        return data
