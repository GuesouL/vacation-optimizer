"""Who is calling? Checks the signed token the Next.js app sends with every request.

Sign-in happens in the front end (Auth.js). After it, the front end mints a
short-lived token signed with API_TOKEN_SECRET, a secret only the two servers
know. Here we check that signature and the expiry, then find or create the
matching Account row. Like a shop badge: the front desk checks ID once, and
every door just scans the badge.
"""

import os
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import orm
from .db import get_session

AUDIENCE = "vacation-optimizer-api"  # a token minted for some other service is rejected
ALGORITHM = "HS256"  # one shared secret signs and verifies

# auto_error=False so a missing header becomes our 401 below, not FastAPI's 403.
bearer = HTTPBearer(auto_error=False)


def secret() -> str:
    value = os.environ.get("API_TOKEN_SECRET")
    if not value:
        # Fail closed: without a secret, nobody gets in.
        raise HTTPException(500, "API_TOKEN_SECRET is not set on the server")
    return value


def unauthorized(reason: str) -> HTTPException:
    return HTTPException(401, reason, headers={"WWW-Authenticate": "Bearer"})


def current_account(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    session: Annotated[Session, Depends(get_session)],
) -> orm.Account:
    if credentials is None:
        raise unauthorized("Sign in first")
    try:
        claims = jwt.decode(
            credentials.credentials,
            secret(),
            algorithms=[ALGORITHM],  # pinned, so a token can't pick a weaker one
            audience=AUDIENCE,
            options={"require": ["exp", "aud", "email"]},
        )
    except jwt.ExpiredSignatureError:
        raise unauthorized("Your session expired") from None
    except jwt.InvalidTokenError:
        raise unauthorized("Invalid token") from None

    email = claims["email"].strip().lower()
    by_email = select(orm.Account).where(orm.Account.email == email)
    account = session.scalars(by_email).one_or_none()
    if account is None:
        # First visit: the account row is created on the first signed-in request.
        account = orm.Account(email=email, name=(claims.get("name") or email.split("@")[0])[:100])
        session.add(account)
        try:
            session.commit()
        except IntegrityError:
            # Two first requests raced and the other one created it. Use theirs.
            session.rollback()
            account = session.scalars(by_email).one()
    return account


CurrentAccount = Annotated[orm.Account, Depends(current_account)]
