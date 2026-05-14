"""Base schema with automatic HTML sanitization for str fields."""
from __future__ import annotations

from enum import Enum
from typing import Annotated, Any

import nh3
from pydantic import BaseModel, model_validator


class _RichTextMarker:
    """Marker metadata: this field opts out of HTML sanitization."""


RichTextStr = Annotated[str, _RichTextMarker()]
"""Type alias for str fields that must NOT be sanitized (raw input preserved)."""


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
    """BaseModel that runs nh3.clean() on every str field by default.

    Fields typed as RichTextStr opt out. Enum-typed fields are skipped.
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
                data[field_name] = nh3.clean(value)
        return data
