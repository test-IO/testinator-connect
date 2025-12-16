"""Rich console for formatted output."""

from rich.console import Console

console = Console()


def log_info(message: str) -> None:
    """Log an info message."""
    console.print(f"[blue]ℹ[/blue] {message}")


def log_success(message: str) -> None:
    """Log a success message."""
    console.print(f"[green]✓[/green] {message}")


def log_warning(message: str) -> None:
    """Log a warning message."""
    console.print(f"[yellow]⚠[/yellow] {message}")


def log_error(message: str) -> None:
    """Log an error message."""
    console.print(f"[red]✗[/red] {message}")


def log_tool_call(server: str, tool: str) -> None:
    """Log a tool call."""
    console.print(f"[cyan]→[/cyan] [bold]{server}[/bold].[white]{tool}[/white]")


def log_tool_ok(server: str, tool: str, result: str) -> None:
    """Log a successful tool result."""
    console.print(f"[green]✓[/green] [bold]{server}[/bold].{tool} [dim]→[/dim] {result}")


def log_tool_error(server: str, tool: str, error: str) -> None:
    """Log a tool error."""
    console.print(f"[red]✗[/red] [bold]{server}[/bold].{tool} [dim]→[/dim] [red]{error}[/red]")


def log_session(action: str, server: str, extra: str = "") -> None:
    """Log a session event."""
    extra_str = f" [dim]({extra})[/dim]" if extra else ""
    console.print(f"[magenta]●[/magenta] [dim]{action}[/dim] [bold]{server}[/bold]{extra_str}")


def log_session_error(message: str) -> None:
    """Log a session error."""
    console.print(f"[red]●[/red] [red]{message}[/red]")
