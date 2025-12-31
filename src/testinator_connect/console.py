"""Rich console for formatted output.

Supports dual-mode output:
- Console mode: Direct Rich console printing
- TUI mode: Routes to Textual RichLog widget
"""

from rich.console import Console

console = Console()

# TUI mode flag - set by main.py when --tui is used
_tui_mode: bool = False


def set_tui_mode(enabled: bool) -> None:
    """Enable or disable TUI mode."""
    global _tui_mode
    _tui_mode = enabled


def is_tui_mode() -> bool:
    """Check if TUI mode is enabled."""
    return _tui_mode


def log_info(message: str) -> None:
    """Log an info message."""
    if _tui_mode:
        from .tui import tui_log_info
        tui_log_info(message)
    else:
        console.print(f"[blue]ℹ[/blue] {message}")


def log_success(message: str) -> None:
    """Log a success message."""
    if _tui_mode:
        from .tui import tui_log_success
        tui_log_success(message)
    else:
        console.print(f"[green]✓[/green] {message}")


def log_warning(message: str) -> None:
    """Log a warning message."""
    if _tui_mode:
        from .tui import tui_log_warning
        tui_log_warning(message)
    else:
        console.print(f"[yellow]⚠[/yellow] {message}")


def log_error(message: str) -> None:
    """Log an error message."""
    if _tui_mode:
        from .tui import tui_log_error
        tui_log_error(message)
    else:
        console.print(f"[red]✗[/red] {message}")


def log_tool_call(server: str, tool: str, extra: str = "", session_id: str | None = None) -> None:
    """Log a tool call."""
    if _tui_mode:
        from .tui import tui_log_tool_call
        tui_log_tool_call(server, tool, extra, session_id)
    else:
        extra_str = f" [dim]({extra})[/dim]" if extra else ""
        console.print(f"[cyan]→[/cyan] [bold]{server}[/bold].[white]{tool}[/white]{extra_str}")


def log_tool_ok(server: str, tool: str, result: str, extra: str = "", session_id: str | None = None) -> None:
    """Log a successful tool result."""
    if _tui_mode:
        from .tui import tui_log_tool_ok
        tui_log_tool_ok(server, tool, result, session_id)
    else:
        console.print(f"[green]✓[/green] [bold]{server}[/bold].{tool} [dim]→[/dim] {result}")


def log_tool_error(server: str, tool: str, error: str, extra: str = "", session_id: str | None = None) -> None:
    """Log a tool error."""
    if _tui_mode:
        from .tui import tui_log_tool_error
        tui_log_tool_error(server, tool, error, session_id)
    else:
        console.print(f"[red]✗[/red] [bold]{server}[/bold].{tool} [dim]→[/dim] [red]{error}[/red]")


def log_session(action: str, server: str, extra: str = "") -> None:
    """Log a session event."""
    if _tui_mode:
        from .tui import tui_log_session
        tui_log_session(action, server, extra)
    else:
        extra_str = f" [dim]({extra})[/dim]" if extra else ""
        console.print(f"[magenta]●[/magenta] [dim]{action}[/dim] [bold]{server}[/bold]{extra_str}")


def log_session_error(message: str) -> None:
    """Log a session error."""
    if _tui_mode:
        from .tui import tui_log_session_error
        tui_log_session_error(message)
    else:
        console.print(f"[red]●[/red] [red]{message}[/red]")


def track_session_start(session_id: str, servers: list[str]) -> None:
    """Track a session start in the TUI sessions table."""
    if _tui_mode:
        from .tui import tui_update_session
        server_str = ", ".join(servers) if servers else "none"
        tui_update_session(session_id, server_str, status="active", calls=0)


def track_session_end(session_id: str) -> None:
    """Track a session end in the TUI sessions table."""
    if _tui_mode:
        from .tui import tui_remove_session
        tui_remove_session(session_id)
