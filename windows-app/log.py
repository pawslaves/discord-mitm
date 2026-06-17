import logging
import sys

log = logging.getLogger("dp")
log.setLevel(logging.INFO)
log.propagate = False

if not log.handlers:
    h = logging.StreamHandler(sys.stdout)
    h.setFormatter(
        logging.Formatter(
            "%(asctime)s [%(levelname)s] %(message)s",
            datefmt="%H:%M:%S",
        )
    )
    log.addHandler(h)
