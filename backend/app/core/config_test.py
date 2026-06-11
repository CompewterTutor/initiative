"""Tests for application settings parsing."""

from app.core.config import CAPACITOR_NATIVE_ORIGINS, Settings


def _settings(**overrides) -> Settings:
    overrides.setdefault("APP_URL", "https://app.example.com")
    return Settings(
        SECRET_KEY="test-secret",
        DATABASE_URL_APP="postgresql+asyncpg://app:app@localhost/app",
        DATABASE_URL_ADMIN="postgresql+asyncpg://admin:admin@localhost/app",
        **overrides,
    )


def test_cors_allowed_origins_accepts_comma_separated_string():
    settings = _settings(
        CORS_ALLOWED_ORIGINS="https://a.example.com, https://b.example.com",
    )

    # The raw field holds only the operator-supplied extras.
    assert settings.CORS_ALLOWED_ORIGINS == [
        "https://a.example.com",
        "https://b.example.com",
    ]
    # The effective allowlist always prepends APP_URL and appends native origins.
    assert settings.cors_origins == [
        "https://app.example.com",
        "https://a.example.com",
        "https://b.example.com",
        *CAPACITOR_NATIVE_ORIGINS,
    ]


def test_cors_origins_blank_does_not_fall_back_to_wildcard():
    # CRIT-001 regression: an unset/blank allowlist must NOT become "*".
    settings = _settings(CORS_ALLOWED_ORIGINS="")

    assert settings.CORS_ALLOWED_ORIGINS == []
    assert "*" not in settings.cors_origins
    assert settings.cors_origins == [
        "https://app.example.com",
        *CAPACITOR_NATIVE_ORIGINS,
    ]


def test_cors_origins_wildcard_is_dropped():
    # Even an explicit "*" is ignored — never reflected with credentials.
    settings = _settings(CORS_ALLOWED_ORIGINS="*, https://ok.example.com")

    assert "*" not in settings.cors_origins
    assert "https://ok.example.com" in settings.cors_origins
    assert "https://app.example.com" in settings.cors_origins


def test_cors_origins_always_includes_app_url_and_native_origins():
    settings = _settings(CORS_ALLOWED_ORIGINS="https://prod.example.com")

    assert "https://app.example.com" in settings.cors_origins
    for origin in CAPACITOR_NATIVE_ORIGINS:
        assert origin in settings.cors_origins


def test_cors_origins_no_duplicates():
    # Listing APP_URL / native origins explicitly must not duplicate them.
    settings = _settings(
        CORS_ALLOWED_ORIGINS=", ".join(
            ["https://app.example.com", "https://prod.example.com", *CAPACITOR_NATIVE_ORIGINS]
        ),
    )

    for origin in ["https://app.example.com", *CAPACITOR_NATIVE_ORIGINS]:
        assert settings.cors_origins.count(origin) == 1


def test_cors_origins_strips_trailing_slash():
    settings = _settings(
        APP_URL="https://app.example.com/",
        CORS_ALLOWED_ORIGINS="https://b.example.com/",
    )

    assert "https://app.example.com" in settings.cors_origins
    assert "https://b.example.com" in settings.cors_origins
    assert "https://app.example.com/" not in settings.cors_origins
