import atexit
import sys
import time

import proxy
import sysnet
from log import log


def cleanup():
    sysnet.proxy_off()
    proxy.stop()


def watchdog():
    while True:
        time.sleep(2)
        if not proxy.running():
            sysnet.proxy_off()
            log.info("proxy watchdog disabled system proxy")
            return


def main():
    if "--edit" in sys.argv:
        import edit

        edit.run()
        return

    atexit.register(cleanup)
    sysnet.ensure_ca()
    sysnet.install_cert()
    if not proxy.start():
        cleanup()
        return
    sysnet.proxy_on()
    log.info("proxy mode started")
    print("[*] proxy on :8080 - ctrl+c to stop")

    try:
        watchdog()
    except KeyboardInterrupt:
        pass
    finally:
        cleanup()
        log.info("proxy stopped")


if __name__ == "__main__":
    main()
