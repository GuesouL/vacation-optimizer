"""Who may see or change what. Every route asks these helpers before touching a row.

Two roles in a group:
- OWNER: the account that created it. Makes and revokes share links, removes anyone.
- MEMBER: any account that manages a person in it. Sees the plan, adds or removes
  their own people.
"""

from typing import Literal

from fastapi import HTTPException
from sqlalchemy.orm import Session

from . import orm

Role = Literal["OWNER", "MEMBER"]


def not_found(model, id: int) -> HTTPException:
    # Someone else's row gets the same 404 as a missing one, so ids can't be
    # probed to learn what exists.
    return HTTPException(404, f"{model.__name__} {id} not found")


def manages(account: orm.Account, person: orm.Person) -> bool:
    return account.id in (person.managed_by_account_id, person.linked_account_id)


def my_person(session: Session, account: orm.Account, person_id: int) -> orm.Person:
    person = session.get(orm.Person, person_id)
    if person is None or not manages(account, person):
        raise not_found(orm.Person, person_id)
    return person


def usable_calendar(session: Session, account: orm.Account, calendar_id: int) -> orm.Calendar:
    """Shared calendars (no owner) are open to everyone; private ones only to their owner."""
    calendar = session.get(orm.Calendar, calendar_id)
    if calendar is None or calendar.owner_account_id not in (None, account.id):
        raise not_found(orm.Calendar, calendar_id)
    return calendar


def can_see_group(account: orm.Account, group: orm.Group) -> bool:
    return group.owner_account_id == account.id or any(
        manages(account, member.person) for member in group.members
    )


def my_group(session: Session, account: orm.Account, group_id: int) -> orm.Group:
    group = session.get(orm.Group, group_id)
    if group is None or not can_see_group(account, group):
        raise not_found(orm.Group, group_id)
    return group


def role_in(account: orm.Account, group: orm.Group) -> Role:
    return "OWNER" if group.owner_account_id == account.id else "MEMBER"


def owned_group(session: Session, account: orm.Account, group_id: int) -> orm.Group:
    group = my_group(session, account, group_id)
    if role_in(account, group) != "OWNER":
        raise HTTPException(403, "Only the group's owner can do that")
    return group
