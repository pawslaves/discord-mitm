import requests as rq

from log import log


def _auto_name(name: str | None, uid: str) -> bool:
    return bool(uid and name == f"user-{uid[-4:]}")


def is_stub(a: dict | None) -> bool:
    if not isinstance(a, dict):
        return False
    uid = a.get("id")
    return bool(
        uid
        and (
            _auto_name(a.get("username"), uid) or _auto_name(a.get("global_name"), uid)
        )
    )


def fetch(uid: str, token: str | None) -> dict | None:
    out = lookup(uid, token)
    return out.get("user") if out.get("ok") else None


def lookup(uid: str, token: str | None) -> dict:
    if not token:
        return {
            "ok": False,
            "status": 503,
            "error": "missing_auth",
            "message": "no captured Discord Authorization header; start recording and load Discord first",
            "has_auth": False,
        }
    attempts = [
        ("user", f"https://discord.com/api/v9/users/{uid}"),
        (
            "profile",
            f"https://discord.com/api/v9/users/{uid}/profile?with_mutual_guilds=false&with_mutual_friends=false",
        ),
    ]
    seen = []
    for kind, url in attempts:
        out = _get(uid, token, kind, url)
        if out.get("ok"):
            return out
        seen.append(out)

    last = seen[-1]
    return {
        "ok": False,
        "status": last.get("status", 502),
        "error": "discord_rejected",
        "message": _fail_msg(seen),
        "attempts": seen,
        "has_auth": True,
    }


def _get(uid: str, token: str, kind: str, url: str) -> dict:
    try:
        r = rq.get(
            url,
            headers={"Authorization": token},
            timeout=4,
            proxies={"http": None, "https": None},
        )
    except Exception as e:
        log.error(f"fetch_user {uid} {kind}: {e}")
        return {
            "ok": False,
            "kind": kind,
            "status": 502,
            "error": "request_failed",
            "message": str(e),
        }
    body = _body(r)
    if r.status_code != 200:
        log.info(f"fetch_user {uid} {kind}: discord {r.status_code}")
        return {
            "ok": False,
            "kind": kind,
            "status": r.status_code,
            "error": "discord_rejected",
            "discord": body,
        }
    user = body.get("user") if kind == "profile" and isinstance(body, dict) else body
    if not isinstance(user, dict) or not user.get("id"):
        return {
            "ok": False,
            "kind": kind,
            "status": 502,
            "error": "bad_response",
            "discord": body,
        }
    return {"ok": True, "status": 200, "user": user, "has_auth": True, "kind": kind}


def _fail_msg(attempts: list[dict]) -> str:
    parts = [f"{x.get('kind')}={x.get('status')}" for x in attempts]
    return (
        "Discord rejected user lookup with captured Authorization header ("
        + ", ".join(parts)
        + ")"
    )


def _body(r):
    try:
        return r.json()
    except Exception:
        return r.text[:300]


def apply(data: dict, user: dict):
    uid = user.get("id")
    if not uid:
        return
    authors = data.setdefault("authors", {})
    authors[uid] = {**authors.get(uid, {}), **user}
    for m in data.get("messages", []):
        if m.get("author", {}).get("id") == uid:
            m["author"] = {**m["author"], **authors[uid]}
        if isinstance(m.get("mentions"), list):
            m["mentions"] = [
                {**x, **authors[uid]}
                if isinstance(x, dict) and x.get("id") == uid
                else x
                for x in m["mentions"]
            ]


def hydrate(data: dict, token: str | None) -> int:
    ids = set()
    for uid, a in (data.get("authors") or {}).items():
        if is_stub(a):
            ids.add(uid)
    for m in data.get("messages", []):
        if is_stub(m.get("author")):
            ids.add(m["author"]["id"])
        for a in m.get("mentions") or []:
            if is_stub(a):
                ids.add(a["id"])

    n = 0
    for uid in ids:
        user = fetch(uid, token)
        if not user:
            continue
        apply(data, user)
        n += 1
    return n
