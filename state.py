import threading


class _S:
    def __init__(self):
        self.recording = False
        self.captured = []
        self.token = None
        self._lock = threading.Lock()
        self._ev = threading.Event()

    def push(self, msgs: list):
        with self._lock:
            self.captured.extend(msgs)
        self._ev.set()

    def wait(self, timeout: float = 0.5):
        fired = self._ev.wait(timeout)
        if fired:
            self._ev.clear()
            with self._lock:
                return list(self.captured)
        return None

    def flush(self) -> list:
        with self._lock:
            out = list(self.captured)
            self.captured = []
        self._ev.clear()
        return out

    def reset(self):
        with self._lock:
            self.captured = []
        self._ev.clear()


state = _S()
