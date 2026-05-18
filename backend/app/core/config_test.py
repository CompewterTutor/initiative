"""Tests for application settings parsing."""

from app.core.config import CAPACITOR_NATIVE_ORIGINS, Settings


def test_cors_allowed_origins_accepts_comma_separated_string():
    settings = Settings(
        SECRET_KEY="test-secret",
        DATABASE_URL_APP="postgresql+asyncpg://app:app@localhost/app",
        DATABASE_URL_ADMIN="postgresql+asyncpg://admin:admin@localhost/app",
        CORS_ALLOWED_ORIGINS="https://app.example.com, https://admin.example.com",
    )

    assert settings.CORS_ALLOWED_ORIGINS == [
        "https://app.example.com",
        "https://admin.example.com",
        *CAPACITOR_NATIVE_ORIGINS,
    ]


def test_cors_allowed_origins_blank_defaults_to_wildcard():
    # wildcard should NOT get native origins appended
    settings = Settings(
        SECRET_KEY="test-secret",
        DATABASE_URL_APP="postgresql+asyncpg://app:app@localhost/app",
        DATABASE_URL_ADMIN="postgresql+asyncpg://admin:admin@localhost/app",
        CORS_ALLOWED_ORIGINS="",
    )

    assert settings.CORS_ALLOWED_ORIGINS == ["*"]


def test_cors_allowed_origins_always_includes_native_origins():
    settings = Settings(
        SECRET_KEY="test-secret",
        DATABASE_URL_APP="postgresql+asyncpg://app:app@localhost/app",
        DATABASE_URL_ADMIN="postgresql+asyncpg://admin:admin@localhost/app",
        CORS_ALLOWED_ORIGINS="https://prod.example.com",
    )

    for origin in CAPACITOR_NATIVE_ORIGINS:
        assert origin in settings.CORS_ALLOWED_ORIGINS


def test_cors_allowed_origins_no_duplicate_native_origins():
    # If someone manually lists a native origin, it shouldn't be duplicated
    settings = Settings(
        SECRET_KEY="test-secret",
        DATABASE_URL_APP="postgresql+asyncpg://app:app@localhost/app",
        DATABASE_URL_ADMIN="postgresql+asyncpg://admin:admin@localhost/app",
        CORS_ALLOWED_ORIGINS=f"https://prod.example.com, {CAPACITOR_NATIVE_ORIGINS[0]}",
    )

    assert settings.CORS_ALLOWED_ORIGINS.count(CAPACITOR_NATIVE_ORIGINS[0]) == 1
