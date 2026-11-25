"""Reuse the configured Google OAuth client to connect another account."""

import argparse
import contextlib
import fcntl
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

from . import budget, cli, config
from .errors import SyncError
from .gws import Gws, READ_SCOPE, WRITE_SCOPE

SIGN_IN_SECONDS = 300
SYNC_UNIT = "omarchy-calendar-sync.service"


class SignInError(Exception):
    """A message to show in Calendar settings."""


def emit(**reply):
    print(json.dumps(reply), flush=True)


def oauth_url(line):
    url = line.strip()
    if not url.startswith("https://accounts.google.com/o/oauth2/") or any(c.isspace() for c in url):
        return ""
    parts = urlsplit(url)
    if parts.path in ("/o/oauth2/auth", "/o/oauth2/v2/auth") and parts.query:
        return url
    return ""


def cancel(_signum, _frame):
    raise KeyboardInterrupt


@contextlib.contextmanager
def on_cancel(handler):
    previous = {sig: signal.signal(sig, handler) for sig in (signal.SIGINT, signal.SIGTERM)}
    try:
        yield
    finally:
        for sig, old_handler in previous.items():
            signal.signal(sig, old_handler)


def login(client, scopes, on_url, on_output=None):
    """Relay the sign-in URL as soon as gws starts its loopback listener."""
    with budget.deadline(SIGN_IN_SECONDS), subprocess.Popen(
        [client.binary, "auth", "login", "--scopes", ",".join(scopes)],
        env=client.environment(), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT, text=True, errors="replace", start_new_session=True,
    ) as process:
        try:
            for line in process.stdout:
                if on_output:
                    on_output(line)
                url = oauth_url(line)
                if url:
                    on_url(url)
            return process.wait()
        finally:
            if process.poll() is None:
                with contextlib.suppress(ProcessLookupError):
                    os.killpg(process.pid, signal.SIGKILL)


def open_browser(url):
    if os.environ.get("WAYLAND_DISPLAY") or os.environ.get("DISPLAY"):
        with contextlib.suppress(OSError):
            subprocess.Popen(
                ["xdg-open", url], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL, start_new_session=True,
            )


def setup_profile(cfg):
    if str(cfg["backend"]).strip().lower() != "gws":
        return None
    profile = Path(str(cfg["profile"])).expanduser().resolve()
    return profile if (profile / "client_secret.json").is_file() else None


def send_status():
    cfg = config.load()
    profile = setup_profile(cfg)
    primary = cfg["googlePrimaryEmail"]

    def status(email):
        emit(available=profile is not None, primary=email,
             accounts=[account["email"] for account in without_primary(cfg["googleAccounts"], email)])

    status(primary)
    if profile:
        verified = verified_primary_email(cfg, profile)
        if verified and verified != primary:
            status(verified)


def account_email(auth):
    email = auth.get("user") if isinstance(auth, dict) else None
    return email.strip() if isinstance(email, str) and "@" in email else ""


def verified_primary_email(cfg, profile):
    try:
        return account_email(Gws(profile, binary=cfg["gwsPath"]).auth_status())
    except SyncError:
        return ""


def without_primary(accounts, email):
    """Keep accounts other than the one using the primary profile."""
    key = email.casefold()
    return [
        account for account in accounts
        if not isinstance(account, dict) or str(account.get("email", "")).casefold() != key
    ]


def request_sync():
    try:
        return subprocess.run(
            ["systemctl", "--user", "restart", "--no-block", SYNC_UNIT],
            capture_output=True, timeout=5, check=False,
        ).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def add_account():
    cfg = config.load()
    base_profile = setup_profile(cfg)
    if base_profile is None:
        raise SignInError("Run Google Calendar setup first.")

    profiles = base_profile / "accounts"
    profiles.mkdir(mode=0o700, exist_ok=True)
    with (profiles / ".sign-in.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SignInError("A Google sign-in is already in progress.") from None
        connect(cfg, base_profile, profiles)


def connect(cfg, base_profile, profiles):
    scopes = [READ_SCOPE, WRITE_SCOPE] if cfg["write"] else [READ_SCOPE]
    profile = Path(tempfile.mkdtemp(prefix="account-", dir=profiles))
    saved = False
    try:
        secret = profile / "client_secret.json"
        shutil.copyfile(base_profile / secret.name, secret)
        secret.chmod(0o600)
        client = Gws(profile, binary=cfg["gwsPath"], isolated=True)
        if login(client, scopes, lambda url: emit(url=url)) != 0:
            raise SignInError("Google sign-in did not complete. Try again in the browser.")

        auth = client.auth_status()
        if not set(scopes).issubset(auth.get("scopes") or []):
            raise SignInError("Calendar access was not granted. Try again and tick the calendar permissions.")
        email = account_email(auth)
        if not email or not client.calendars():
            raise SignInError("Google did not return an account with calendars.")

        primary = verified_primary_email(cfg, base_profile)
        with config.locked_path() as path:
            raw = config.read(path)
            current = config.with_defaults(raw)
            if setup_profile(current) != base_profile or any(
                current[key] != cfg[key] for key in ("write", "gwsPath")
            ):
                raise SignInError("Calendar setup changed during sign-in. Try adding the account again.")
            if primary.casefold() == email.casefold():
                emit(result="existing", email=email)
                return

            accounts = current["googleAccounts"]
            if primary:
                accounts = without_primary(accounts, primary)
            previous = next((a for a in accounts if a["email"].casefold() == email.casefold()), None)
            entry = {"email": email, "profile": str(profile), "write": bool(cfg["write"])}
            if previous:
                accounts[accounts.index(previous)] = entry
            else:
                accounts.append(entry)
            raw.update(googleAccounts=accounts, googlePrimaryEmail=primary or current["googlePrimaryEmail"])
            # Keep cancellation from deleting a profile after the config points to it.
            with on_cancel(signal.SIG_IGN):
                cli.write_atomic(path, raw)
                saved = True
                syncing = request_sync()
                if previous:
                    old_profile = Path(previous["profile"]).expanduser()
                    if old_profile.parent == profiles and old_profile.name.startswith("account-"):
                        shutil.rmtree(old_profile, ignore_errors=True)
                emit(result="reconnected" if previous else "added", email=email, syncing=syncing)
    finally:
        if not saved:
            shutil.rmtree(profile, ignore_errors=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="action", required=True)
    commands.add_parser("status")
    commands.add_parser("add")
    initial = commands.add_parser("login")
    initial.add_argument("gws")
    initial.add_argument("profile")
    initial.add_argument("scopes")
    args = parser.parse_args(argv)
    try:
        with on_cancel(cancel):
            if args.action == "login":
                return login(Gws(args.profile, binary=args.gws), args.scopes.split(","),
                             open_browser, lambda line: print(line, end="", flush=True))
            if args.action == "status":
                send_status()
            else:
                add_account()
        return 0
    except KeyboardInterrupt:
        message = "Google sign-in cancelled."
    except budget.TookTooLong:
        message = "Google sign-in timed out. Try again."
    except (SignInError, SyncError, config.ConfigError, OSError, ValueError) as error:
        message = str(error)
    if args.action == "login":
        print(message, file=sys.stderr)
    else:
        emit(error=message)
    return 1
