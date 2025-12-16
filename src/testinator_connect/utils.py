"""Utility functions for testinator-connect."""

import re


def sanitize(name: str) -> str:
    """
    Sanitize a server name to be a valid identifier.

    - Remove leading non-letters
    - Remove trailing non-letters/digits/underscores
    - Replace invalid middle characters with underscore

    Args:
        name: Raw server name

    Returns:
        Sanitized name safe to use as identifier
    """
    # Remove leading non-letters
    result = re.sub(r"^[^a-zA-Z]+", "", name)
    # Remove trailing non-letters/digits/underscores
    result = re.sub(r"[^a-zA-Z0-9_]+$", "", result)
    # Replace invalid middle characters with _
    return re.sub(r"[^a-zA-Z0-9_]", "_", result)
