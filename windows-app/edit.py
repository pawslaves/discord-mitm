import atexit
import json
import os
import threading
import time
import webbrowser
from pathlib import Path

from flask import Flask, Response, jsonify, request, stream_with_context

import cfg
import proxy
import state as st
import sysnet
import users
from log import log

_WEB = Path(__file__).parent / "web"
app = Flask(__name__, static_folder=str(_WEB), static_url_path="")
_active_profile = None
_watch = None


def cleanup():
    st.state.recording = False
    sysnet.proxy_off()
    proxy.stop()


def _body():
    if request.is_json:
        return request.get_json(silent=True) or {}
    raw = request.get_data(as_text=True)
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except Exception:
        return {}


def save_body(body: dict):
    data = cfg.load(body.get("profile_id") or None)
    for key in ("messages", "channel_id", "other_user_id", "is_group", "authors"):
        if key in body:
            data[key] = body[key]
    if "name" in body:
        data["name"] = body["name"]
    return cfg.save(data)


def exit_later():
    time.sleep(0.35)
    os._exit(0)


def _watch_proxy():
    while True:
        time.sleep(2)
        if not proxy.running():
            sysnet.proxy_off()
            log.info("proxy watchdog disabled system proxy")
            return


def watch_proxy():
    global _watch
    if _watch and _watch.is_alive():
        return
    _watch = threading.Thread(target=_watch_proxy, daemon=True)
    _watch.start()


def _authors_from(msgs: list) -> dict:
    authors = {}
    for m in msgs:
        for a in [m.get("author", {}), *m.get("mentions", [])]:
            if a.get("id"):
                authors[a["id"]] = a
    return authors


@app.route("/")
def index():
    return app.send_static_file("index.html")


@app.route("/api/config")
def get_cfg():
    return jsonify(cfg.load())


@app.route("/api/profiles")
def profiles():
    data = cfg.store()
    return jsonify(
        {
            "default": data["default"],
            "profiles": [
                {
                    "id": pid,
                    "name": prof.get("name", pid),
                    "channel_id": prof.get("channel_id", ""),
                    "is_group": prof.get("is_group", False),
                    "messages": len(prof.get("messages", [])),
                    "authors": len(prof.get("authors", {})),
                }
                for pid, prof in data["profiles"].items()
            ],
        }
    )


@app.route("/api/profiles/<profile_id>")
def profile_get(profile_id):
    return jsonify(cfg.load(profile_id))


@app.route("/api/profiles", methods=["POST"])
def profile_save():
    body = request.json or {}
    profile_id = body.get("profile_id") or None
    make_default = bool(body.get("make_default", False))
    saved = cfg.save_profile(profile_id, body, make_default)
    log.info(f"profile saved: {saved.get('profile_id')}")
    return jsonify(saved)


@app.route("/api/profiles/<profile_id>/default", methods=["POST"])
def profile_default(profile_id):
    cfg.set_default(profile_id)
    log.info(f"default profile: {profile_id}")
    return jsonify({"ok": True})


@app.route("/api/profiles/<profile_id>", methods=["DELETE"])
def profile_delete(profile_id):
    cfg.delete_profile(profile_id)
    log.info(f"profile deleted: {profile_id}")
    return jsonify({"ok": True})


@app.route("/api/user/<user_id>")
def fetch_user(user_id):
    out = users.lookup(user_id, st.state.token)
    if not out.get("ok"):
        return jsonify(out), out.get("status", 502)
    return jsonify(out["user"])


@app.route("/api/record/start", methods=["POST"])
def rec_start():
    global _active_profile
    body = request.json or {}
    _active_profile = body.get("profile_id") or None
    data = cfg.load(_active_profile)
    saved = data
    data["channel_id"] = body.get("channel_id", data.get("channel_id", ""))
    data["other_user_id"] = body.get("other_user_id", data.get("other_user_id", ""))
    data["is_group"] = bool(body.get("is_group", data.get("is_group", False)))
    if "name" in body:
        data["name"] = body["name"]
    saved = cfg.save(data)
    _active_profile = saved.get("profile_id")

    st.state.reset()
    st.state.recording = True

    if not proxy.start():
        return jsonify({"error": "proxy failed"}), 502
    sysnet.ensure_ca()
    sysnet.install_cert()
    sysnet.proxy_on()
    watch_proxy()
    log.info("recording started")
    return jsonify(
        {"ok": True, "profile_id": saved.get("profile_id"), "name": saved.get("name")}
    )


@app.route("/api/record/stop", methods=["POST"])
def rec_stop():
    global _active_profile
    st.state.recording = False
    msgs = st.state.flush()

    seen, unique = set(), []
    for m in msgs:
        mid = m.get("id")
        if mid not in seen:
            seen.add(mid)
            unique.append(m)

    data = cfg.load(_active_profile)
    saved = data
    if unique:
        authors = data.get("authors", {})
        authors.update(_authors_from(unique))
        data["messages"] = unique
        data["authors"] = authors
        n = users.hydrate(data, st.state.token)
        saved = cfg.save(data)
        log.info(f"saved {len(unique)} msgs, resolved {n} user(s)")
    _active_profile = None

    return jsonify(
        {
            "ok": True,
            "messages": unique,
            "authors": data.get("authors", {}),
            "profile_id": saved.get("profile_id"),
            "name": saved.get("name"),
        }
    )


@app.route("/api/stream")
def stream():
    def gen():
        while True:
            msgs = st.state.wait(0.5)
            if msgs is not None:
                yield f"data: {json.dumps(msgs)}\n\n"
            else:
                yield ": ping\n\n"

    return Response(
        stream_with_context(gen()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.route("/api/save", methods=["POST"])
def save():
    body = _body()
    saved = save_body(body)
    log.info(f"config saved: {len(saved.get('messages', []))} msgs")
    return jsonify(saved)


@app.route("/api/exit", methods=["POST"])
def exit_edit():
    body = _body()
    saved = save_body(body)
    cleanup()
    threading.Thread(target=exit_later, daemon=True).start()
    log.info(f"edit closing, saved {len(saved.get('messages', []))} msgs")
    return jsonify({"ok": True})


@app.route("/api/proxy/stop", methods=["POST"])
def proxy_stop():
    cleanup()
    return jsonify({"ok": True})


def run(port: int = 8765):
    atexit.register(cleanup)

    def _open():
        time.sleep(0.8)
        webbrowser.open(f"http://localhost:{port}")

    threading.Thread(target=_open, daemon=True).start()
    log.info(f"edit server on :{port}")
    try:
        app.run(host="127.0.0.1", port=port, debug=False, threaded=True)
    finally:
        cleanup()
