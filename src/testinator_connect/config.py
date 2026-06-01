"""Configuration loading for testinator-connect."""

import json
import os
import socket
import uuid
from pathlib import Path

from .utils import sanitize


def get_config_dir() -> Path:
    """Return the configuration directory (project root)."""
    # Look for config.json relative to this file's location
    # src/testinator_connect/config.py -> ../../config.json
    package_dir = Path(__file__).parent
    project_root = package_dir.parent.parent
    return project_root


def get_config_file() -> Path:
    """Return the path to the configuration file."""
    return get_config_dir() / "config.json"


def get_state_file() -> Path:
    """Return the path to the per-installation state file.

    Lives next to config.json so it's easy to inspect / delete. Holds
    the persistent ``installation_id`` (a UUID generated on first run)
    used by testinator-tooling + workflow to identify this installation
    across reconnects, since the Socket.IO sid changes every reconnect.
    """
    return get_config_dir() / "state.json"


def load_or_create_installation_state(config: dict | None = None) -> dict:
    """Return persistent state, creating state.json on first run.

    Persisted fields:
      - ``installation_id``: UUID4, generated once, never changes.

    Computed each run (not persisted, so config.json edits take effect
    immediately):
      - ``display_name``: from ``config["display_name"]`` if set,
        otherwise socket.gethostname(), otherwise ``"testinator-connect"``.

    Returns ``{"installation_id": str, "display_name": str}``.
    """
    state_file = get_state_file()
    state: dict = {}
    if state_file.exists():
        try:
            with open(str(state_file), "r") as f:
                state = json.load(f)
        except (OSError, json.JSONDecodeError):
            state = {}

    if not state.get("installation_id"):
        state["installation_id"] = str(uuid.uuid4())
        try:
            with open(str(state_file), "w") as f:
                json.dump(state, f, indent=2)
        except OSError:
            # Best-effort persistence — if we can't write, we'll still
            # send a non-empty installation_id this run but a new one
            # next time.
            pass

    cfg = config or {}
    display_name = (
        (cfg.get("display_name") or "").strip()
        or _safe_hostname()
        or "testinator-connect"
    )

    return {
        "installation_id": state["installation_id"],
        "display_name": display_name,
    }


def _safe_hostname() -> str | None:
    """Hostname without raising on weird platforms."""
    try:
        return socket.gethostname()
    except OSError:
        return None


def load_config() -> dict:
    """
    Load configuration from config.json.

    Returns:
        Configuration dictionary with sanitized server names and defaults.
    """
    config_file = get_config_file()

    if not config_file.exists():
        print(f"Warning: Config file not found at {config_file}")
        return {}

    with open(str(config_file), "r") as f:
        config = json.load(f)

    # Sanitize server names
    servers = config.get("servers", {})
    sanitized_servers = {sanitize(name): value for name, value in servers.items()}
    config["servers"] = sanitized_servers

    # Handle timeout with default
    try:
        config["timeout"] = int(config.get("timeout", 120))
    except (ValueError, TypeError):
        config["timeout"] = 120

    # SSL configuration (default: disabled for corporate environments)
    if "ssl_verify" not in config:
        config["ssl_verify"] = False

    return config


def save_config(config: dict) -> None:
    """Save configuration to config.json."""
    config_file = get_config_file()

    with open(str(config_file), "w") as f:
        json.dump(config, f, indent=2)
