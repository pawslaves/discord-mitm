import logging
import sys
from pathlib import Path

log = logging.getLogger("dp")
log.setLevel(logging.INFO)
log.propagate = False

if not log.handlers:
    fmt = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )
    fh = logging.FileHandler(Path(__file__).parent / "testingg.log", encoding="utf-8")
    fh.setFormatter(fmt)
    log.addHandler(fh)

    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(fmt)
    log.addHandler(sh)
