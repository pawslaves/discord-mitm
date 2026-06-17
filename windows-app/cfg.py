import json
import re
import time
from pathlib import Path

_f = Path(__file__).parent / "data.json"


def _empty() -> dict:
    return {
        "channel_id": "",
        "other_user_id": "",
        "is_group": False,
        "messages": [],
        "authors": {},
    }


def _norm_profile(data: dict | None) -> dict:
    out = _empty()
    if isinstance(data, dict):
        for key in out:
            if key in data:
                out[key] = data[key]
        out["name"] = data.get("name", name_for(out))
    else:
        out["name"] = name_for(out)
    out.setdefault("messages", [])
    out.setdefault("authors", {})
    out.setdefault("is_group", False)
    out.setdefault("other_user_id", "")
    return out


def _slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return s or f"config-{int(time.time())}"


def name_for(data: dict) -> str:
    authors = list((data.get("authors") or {}).values())
    names = []
    for a in authors:
        name = a.get("global_name") or a.get("username")
        if name and name not in names:
            names.append(name)
    if data.get("is_group") and names:
        return "groupchat of " + ", ".join(names[:6])
    if names:
        return "chat with " + ", ".join(names[:2])
    cid = data.get("channel_id")
    return f"channel {cid}" if cid else "untitled config"


def _empty_store() -> dict:
    pid = "default"
    prof = _norm_profile({"name": "default"})
    return {"default": pid, "profiles": {pid: prof}}


def _store(data: dict | None = None) -> dict:
    if not data:
        return _empty_store()
    if "profiles" in data:
        profiles = data.get("profiles") or {}
        out = {"default": data.get("default") or "", "profiles": {}}
        for pid, prof in profiles.items():
            out["profiles"][pid] = _norm_profile(prof)
        if not out["profiles"]:
            return _empty_store()
        if out["default"] not in out["profiles"]:
            out["default"] = next(iter(out["profiles"]))
        return out
    prof = _norm_profile(data)
    pid = _slug(prof.get("name") or name_for(prof))
    return {"default": pid, "profiles": {pid: prof}}


def store() -> dict:
    if not _f.exists():
        return _empty_store()
    with open(_f, encoding="utf-8") as fp:
        return _store(json.load(fp))


def write_store(data: dict):
    with open(_f, "w", encoding="utf-8") as fp:
        json.dump(_store(data), fp, indent=2, ensure_ascii=False)


def load(profile_id: str | None = None) -> dict:
    data = store()
    pid = profile_id or data["default"]
    prof = data["profiles"].get(pid) or data["profiles"][data["default"]]
    out = dict(prof)
    out["profile_id"] = pid if pid in data["profiles"] else data["default"]
    out["default_profile"] = data["default"]
    return out


def save(data: dict):
    pid = data.get("profile_id")
    data = dict(data)
    data.pop("profile_id", None)
    data.pop("default_profile", None)
    return save_profile(pid, data)


def save_profile(profile_id: str | None, data: dict, make_default: bool = False) -> dict:
    cfg = store()
    prof = _norm_profile(data)
    if not prof.get("name") or prof["name"] == "untitled config":
        prof["name"] = name_for(prof)
    pid = profile_id or _slug(prof["name"])
    base = pid
    n = 2
    while pid in cfg["profiles"] and profile_id is None:
        pid = f"{base}-{n}"
        n += 1
    cfg["profiles"][pid] = prof
    if make_default or cfg["default"] not in cfg["profiles"]:
        cfg["default"] = pid
    write_store(cfg)
    out = dict(prof)
    out["profile_id"] = pid
    out["default_profile"] = cfg["default"]
    return out


def set_default(profile_id: str):
    cfg = store()
    if profile_id in cfg["profiles"]:
        cfg["default"] = profile_id
        write_store(cfg)


def delete_profile(profile_id: str):
    cfg = store()
    if profile_id not in cfg["profiles"]:
        return
    cfg["profiles"].pop(profile_id)
    if not cfg["profiles"]:
        cfg = _empty_store()
    elif cfg["default"] == profile_id:
        cfg["default"] = next(iter(cfg["profiles"]))
    write_store(cfg)
