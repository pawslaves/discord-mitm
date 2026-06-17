import atexit
import sys
import time

import proxy
from log import log


def cleanup():
    proxy.stop()


def watchdog():
    while True:
        time.sleep(2)
        if not proxy.running():
            log.info("proxy watchdog stopped")
            return


def main():
    if "--edit" in sys.argv:
        import edit

        edit.run()
        return

    atexit.register(cleanup)
    if not proxy.start():
        cleanup()
        return
    log.info(f"proxy mode started, android target {proxy.addr()['target']}")

    try:
        watchdog()
    except KeyboardInterrupt:
        pass
    finally:
        cleanup()
        log.info("proxy stopped")


if __name__ == "__main__":
    main()
