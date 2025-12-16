"""Configuration loading for testinator-connect."""

import json
import os
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
