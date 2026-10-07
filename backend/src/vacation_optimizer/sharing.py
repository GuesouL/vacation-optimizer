"""Share links: invite someone into a group, or show the plan read-only.

A link is a long random token (like a key blank cut once). The database keeps
only its sha256 hash, so even someone holding a copy of the database can't
rebuild a working link. Links expire after 90 days and the owner can revoke
them at any time; the server checks both on every use.
"""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import orm
from .access import my_person, owned_group, role_in
from .auth import CurrentAccount
from .db import DB
from .schemas import (
    AcceptIn,
    GroupSummary,
    InvitePreview,
    LinkIn,
    LinkOut,
    NewLinkOut,
    SharedViewOut,
)
from .search import SearchParams, first_name, load_group, public_names, search_group

router = APIRouter()

LINK_LIFETIME = timedelta(days=90)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def link_out(link: orm.ShareLink) -> LinkOut:
    return LinkOut(id=link.id, kind=link.kind, expires_at=link.expires_at, revoked=link.revoked_at is not None)


def live_link(session: Session, token: str, kind: orm.LinkKind | None = None) -> orm.ShareLink:
    """The link behind a token, if it's real, the right kind (None = any),
    unexpired and not revoked.
    Every failure gives the same answer, so a guesser learns nothing."""
    link = session.scalars(
        select(orm.ShareLink).where(orm.ShareLink.token_hash == hash_token(token))
    ).one_or_none()
    now = datetime.now(UTC)
    wrong_kind = kind is not None and link is not None and link.kind is not kind
    if link is None or wrong_kind or link.revoked_at is not None or link.expires_at <= now:
        raise HTTPException(404, "This link is invalid or has expired")
    return link


# --- Owner: create, list and revoke ---------------------------------------


@router.post("/groups/{group_id}/links", status_code=201)
def create_link(group_id: int, body: LinkIn, account: CurrentAccount, session: DB) -> NewLinkOut:
    group = owned_group(session, account, group_id)
    token = secrets.token_urlsafe(32)  # 256 random bits: unguessable
    link = orm.ShareLink(
        group_id=group.id,
        kind=body.kind,
        token_hash=hash_token(token),
        created_by_account_id=account.id,
        expires_at=datetime.now(UTC) + LINK_LIFETIME,
    )
    session.add(link)
    session.commit()
    return NewLinkOut(**link_out(link).model_dump(), token=token)


@router.get("/groups/{group_id}/links")
def list_links(group_id: int, account: CurrentAccount, session: DB) -> list[LinkOut]:
    group = owned_group(session, account, group_id)
    links = session.scalars(
        select(orm.ShareLink).where(orm.ShareLink.group_id == group.id).order_by(orm.ShareLink.id)
    )
    return [link_out(link) for link in links]


@router.delete("/groups/{group_id}/links/{link_id}", status_code=204)
def revoke_link(group_id: int, link_id: int, account: CurrentAccount, session: DB) -> None:
    group = owned_group(session, account, group_id)
    link = session.get(orm.ShareLink, link_id)
    if link is None or link.group_id != group.id:
        raise HTTPException(404, f"Link {link_id} not found")
    link.revoked_at = link.revoked_at or datetime.now(UTC)  # revoking twice is harmless
    session.commit()


# --- Anyone with the link -------------------------------------------------


@router.get("/links/{token}")
def preview_link(token: str, session: DB) -> InvitePreview:
    """What the link is for, before signing in: the group's name and who sent it."""
    link = live_link(session, token)
    # The name they gave their own profile ("Pat"), not their login's name.
    profile_name = session.scalars(
        select(orm.Person.name).where(orm.Person.linked_account_id == link.created_by_account_id)
    ).first()
    name = profile_name or session.get(orm.Account, link.created_by_account_id).name
    return InvitePreview(group_name=link.group.name, invited_by=first_name(name), kind=link.kind)


@router.post("/links/{token}/accept")
def accept_invite(token: str, body: AcceptIn, account: CurrentAccount, session: DB) -> GroupSummary:
    """Join the group with some of your own people (yourself, your kids)."""
    link = live_link(session, token, orm.LinkKind.INVITE)
    group = link.group
    already = {m.person_id for m in group.members}
    for person_id in dict.fromkeys(body.person_ids):
        my_person(session, account, person_id)  # you can only bring people you manage
        if person_id not in already:
            group.members.append(orm.GroupMember(person_id=person_id))
    session.commit()
    return GroupSummary(id=group.id, name=group.name, role=role_in(account, group))


@router.get("/links/{token}/view")
def shared_view(token: str, session: DB, params: Annotated[SearchParams, Depends()]) -> SharedViewOut:
    """Read-only plan for a view link: first names and dates, no account needed."""
    link = live_link(session, token, orm.LinkKind.VIEW)
    group = load_group(session, link.group_id)
    return SharedViewOut(
        group_name=group.name,
        people=public_names([m.person.name for m in group.members]),
        search=search_group(session, group, params, public=True),
    )
