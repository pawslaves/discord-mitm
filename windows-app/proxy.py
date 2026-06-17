import asyncio
import json
import re
import threading

import cfg
import state as st
import users
from log import log

_master = None
_thread = None
_ready = threading.Event()
_failed = threading.Event()
_CHAN_RE = re.compile(r"/api/v9/channels/(\d+)/messages")


class Addon:
    def request(self, flow):
        if "discord.com" not in flow.request.pretty_url:
            return
        auth = flow.request.headers.get("authorization")
        if auth and auth != st.state.token:
            st.state.token = auth
            log.info("captured Discord Authorization header")

    def response(self, flow):
        m = _CHAN_RE.search(flow.request.pretty_url)
        if not m:
            return
        cid = m.group(1)
        auth = flow.request.headers.get("authorization") or st.state.token
        if auth:
            st.state.token = auth
        data = cfg.load()
        if cid != data.get("channel_id", ""):
            return
        try:
            body = json.loads(flow.response.content)
        except Exception:
            return
        if not isinstance(body, list):
            return

        if st.state.recording:
            st.state.push(body)
            log.info(f"captured {len(body)} msgs ch={cid}")
            return

        if auth:
            n = users.hydrate(data, auth)
            if n:
                data = cfg.save(data)
                log.info(f"resolved {n} user(s) before messages ch={cid}")

        msgs = data.get("messages", [])
        if not msgs:
            return

        flow.response.headers.pop("content-encoding", None)
        flow.response.headers.pop("transfer-encoding", None)
        payload = json.dumps(msgs).encode("utf-8")
        flow.response.headers["content-type"] = "application/json"
        flow.response.headers["content-length"] = str(len(payload))
        flow.response.content = payload
        log.info(f"injected {len(msgs)} msgs ch={cid}")


def _run(port: int):
    from mitmproxy import options
    from mitmproxy.tools import dump

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    opts = options.Options(listen_host="127.0.0.1", listen_port=port)
    global _master
    _ready.clear()
    _failed.clear()
    try:
        _master = dump.DumpMaster(
            opts,
            loop=loop,
            with_termlog=False,
            with_dumper=False,
        )
        _master.addons.add(Addon())
        _ready.set()
        loop.run_until_complete(_master.run())
    except Exception as e:
        _failed.set()
        log.error(f"proxy thread: {e}")
    finally:
        _master = None
        _failed.set()
        loop.close()


def start(port: int = 8080) -> bool:
    global _thread
    if _thread and _thread.is_alive():
        return True
    _thread = threading.Thread(target=_run, args=(port,), daemon=True)
    _thread.start()
    ok = _ready.wait(3)
    if ok:
        log.info(f"proxy started :{port}")
    else:
        log.error(f"proxy failed to start :{port}")
    return ok


def stop():
    global _master, _thread
    if _master:
        _master.shutdown()
        log.info("proxy stopped")
    if _thread and _thread.is_alive():
        _thread.join(2)


def running() -> bool:
    return bool(_master and _thread and _thread.is_alive())
