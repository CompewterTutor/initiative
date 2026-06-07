"""Integration tests for calendar-event tag serialization on the list summary.

The list endpoints return ``CalendarEventSummary``; these assert that tags
assigned to an event are eager-loaded and embedded in the summary (not just
the full ``CalendarEventRead`` detail response).
"""

import pytest
from httpx import AsyncClient
from sqlmodel.ext.asyncio.session import AsyncSession

from app.models.guild import GuildRole
from app.models.tag import Tag
from app.testing import (
    create_calendar_event,
    create_guild,
    create_guild_membership,
    create_initiative,
    create_user,
    get_guild_headers,
)


async def _setup_event(session: AsyncSession, *, initiative_name: str = "Init"):
    """admin user, guild, events-enabled initiative, event."""
    user = await create_user(session, email=f"u-{initiative_name}@example.com")
    guild = await create_guild(session)
    await create_guild_membership(session, user=user, guild=guild, role=GuildRole.admin)
    initiative = await create_initiative(session, guild, user, name=initiative_name)
    initiative.events_enabled = True
    session.add(initiative)
    await session.commit()
    await session.refresh(initiative)
    event = await create_calendar_event(session, initiative, user, title="E")
    return user, guild, initiative, event


@pytest.mark.integration
async def test_list_events_summary_includes_tags(
    client: AsyncClient, session: AsyncSession
):
    user, guild, initiative, event = await _setup_event(session)
    headers = get_guild_headers(guild, user)

    tag = Tag(name="Priority", guild_id=guild.id, color="#ff0000")
    session.add(tag)
    await session.commit()
    await session.refresh(tag)

    # Assign the tag to the event.
    assign = await client.put(
        f"/api/v1/calendar-events/{event.id}/tags",
        headers=headers,
        json=[tag.id],
    )
    assert assign.status_code == 200

    # The list summary should embed the tag.
    response = await client.get(
        f"/api/v1/calendar-events/?initiative_id={initiative.id}", headers=headers
    )
    assert response.status_code == 200
    items = {item["id"]: item for item in response.json()["items"]}
    assert event.id in items
    tags = items[event.id]["tags"]
    assert [t["id"] for t in tags] == [tag.id]
    assert tags[0]["name"] == "Priority"


@pytest.mark.integration
async def test_list_events_summary_tags_default_empty(
    client: AsyncClient, session: AsyncSession
):
    """An event with no tags still serializes ``tags: []`` in the summary."""
    user, guild, initiative, event = await _setup_event(session)
    headers = get_guild_headers(guild, user)

    response = await client.get(
        f"/api/v1/calendar-events/?initiative_id={initiative.id}", headers=headers
    )
    assert response.status_code == 200
    items = {item["id"]: item for item in response.json()["items"]}
    assert items[event.id]["tags"] == []
