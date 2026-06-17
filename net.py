import socket


def lan_ip() -> str:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        ip = sock.getsockname()[0]
    except OSError:
        ip = socket.gethostbyname(socket.gethostname())
        if ip.startswith("127."):
            ip = "0.0.0.0"
    finally:
        sock.close()
    return ip


def target(port: int = 8080) -> str:
    return f"{lan_ip()}:{port}"
