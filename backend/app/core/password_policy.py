"""Password policy enforcement for new and changed passwords.

Aligned with NIST SP 800-63B (rev. 3, 2017):

  - Minimum length 12, maximum 256.
  - No character-class requirements (mandated complexity rules push
    users toward predictable patterns and reduce real entropy).
  - Reject passwords present in known breach corpora.

The login path is intentionally NOT routed through this module —
existing users with shorter or breached passwords keep working until
the next time they change one ("grandfathered"). All new password
material flows (register, password reset, self-update, admin-update)
must call ``validate_new_password`` immediately before hashing.
"""
from __future__ import annotations

from fastapi import HTTPException, status

from app.core.messages import PasswordMessages
from app.services import hibp


# Mirrored by ``frontend/src/lib/passwordPolicy.ts`` — keep both in sync
# when you change the floor. The schema-level Pydantic ``min_length``
# constraint serves as a cheap first gate so the endpoint never even
# enters the policy for an obviously-short value, but ``MIN_LENGTH``
# below remains the source of truth surfaced via the error code.
PASSWORD_MIN_LENGTH = 12
PASSWORD_MAX_LENGTH = 256


class PasswordPolicyError(Exception):
    """Raised when a candidate password fails the policy.

    ``code`` is one of the ``PasswordMessages`` constants and is the
    same string the endpoint uses as the ``HTTPException`` detail, so
    the frontend can map it via ``errors.json``.
    """

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


async def validate_new_password(password: str) -> None:
    """Validate a candidate password or raise ``PasswordPolicyError``.

    Order matters: cheap local checks first, network check last, so
    obviously-short inputs never reach HIBP.
    """
    if len(password) < PASSWORD_MIN_LENGTH:
        raise PasswordPolicyError(PasswordMessages.TOO_SHORT)
    if len(password) > PASSWORD_MAX_LENGTH:
        raise PasswordPolicyError(PasswordMessages.TOO_LONG)
    if await hibp.is_password_breached(password):
        raise PasswordPolicyError(PasswordMessages.BREACHED)


async def enforce_password_policy(password: str) -> None:
    """Endpoint-facing wrapper that converts ``PasswordPolicyError`` into
    an ``HTTPException`` with the policy code as ``detail``.

    Use this from API handlers; reserve ``validate_new_password`` for
    callers that want to handle the exception themselves (services,
    scripts, tests).
    """
    try:
        await validate_new_password(password)
    except PasswordPolicyError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=exc.code,
        ) from exc
