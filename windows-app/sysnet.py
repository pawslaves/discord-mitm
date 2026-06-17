import ctypes
import datetime
import subprocess
import winreg
from pathlib import Path

from log import log

CERT = Path.home() / ".mitmproxy" / "mitmproxy-ca-cert.cer"
_CA_PEM = Path.home() / ".mitmproxy" / "mitmproxy-ca.pem"
_REG = r"Software\Microsoft\Windows\CurrentVersion\Internet Settings"


def _notify():
    wi = ctypes.windll.Wininet
    wi.InternetSetOptionW(0, 39, 0, 0)
    wi.InternetSetOptionW(0, 37, 0, 0)


def ensure_ca():
    if _CA_PEM.exists() and CERT.exists():
        return
    store_dir = Path.home() / ".mitmproxy"
    store_dir.mkdir(exist_ok=True)
    try:
        from cryptography import x509
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.x509.oid import NameOID

        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "mitmproxy")])
        now = datetime.datetime.now(datetime.timezone.utc)
        cert = (
            x509.CertificateBuilder()
            .subject_name(name)
            .issuer_name(name)
            .public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now)
            .not_valid_after(now + datetime.timedelta(days=3650))
            .add_extension(
                x509.BasicConstraints(ca=True, path_length=None), critical=True
            )
            .sign(key, hashes.SHA256())
        )
        pem_key = key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption(),
        )
        pem_cert = cert.public_bytes(serialization.Encoding.PEM)
        _CA_PEM.write_bytes(pem_key + pem_cert)
        (store_dir / "mitmproxy-ca-cert.pem").write_bytes(pem_cert)
        CERT.write_bytes(cert.public_bytes(serialization.Encoding.DER))
        log.info("generated mitmproxy CA")
    except Exception as e:
        log.error(f"ensure_ca: {e}")


def install_cert() -> bool:
    if not CERT.exists():
        log.info("CA cert not found")
        return False
    r = subprocess.run(
        ["certutil", "-addstore", "-user", "Root", str(CERT)],
        capture_output=True,
        text=True,
    )
    if r.returncode == 0:
        log.info("CA cert installed into user Root store")
        return True
    log.warning(f"certutil: {r.stderr.strip()}")
    return False


def proxy_on(port: int = 8080):
    try:
        k = winreg.OpenKey(winreg.HKEY_CURRENT_USER, _REG, 0, winreg.KEY_SET_VALUE)
        winreg.SetValueEx(k, "ProxyEnable", 0, winreg.REG_DWORD, 1)
        winreg.SetValueEx(k, "ProxyServer", 0, winreg.REG_SZ, f"127.0.0.1:{port}")
        winreg.CloseKey(k)
        _notify()
        log.info(f"system proxy -> 127.0.0.1:{port}")
    except Exception as e:
        log.error(f"proxy_on: {e}")


def proxy_off():
    try:
        k = winreg.OpenKey(winreg.HKEY_CURRENT_USER, _REG, 0, winreg.KEY_SET_VALUE)
        winreg.SetValueEx(k, "ProxyEnable", 0, winreg.REG_DWORD, 0)
        winreg.CloseKey(k)
        _notify()
        log.info("system proxy disabled")
    except Exception as e:
        log.error(f"proxy_off: {e}")
