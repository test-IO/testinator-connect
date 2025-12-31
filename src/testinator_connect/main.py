"""CLI entry point for testinator-connect."""

import argparse
import asyncio
import signal
import sys

from rich.console import Console
from rich.panel import Panel

from .config import load_config, get_config_file
from .console import log_info, log_success, log_warning, log_error, set_tui_mode
from .sio import start_socket_connection, get_all_tools

console = Console()


def run_serve():
    """Run the serve command - connect to testinator-tooling."""
    console.print(Panel.fit(
        "[bold cyan]testinator-connect[/bold cyan]",
        subtitle=f"[dim]{get_config_file()}[/dim]"
    ))

    config = load_config()

    if not config:
        log_error("No configuration found")
        log_info(f"Please create config.json at: {get_config_file()}")
        sys.exit(1)

    if not config.get("deployment_url"):
        log_error("deployment_url not configured")
        sys.exit(1)

    if not config.get("servers"):
        log_warning("No MCP servers configured")

    # Discover tools from configured servers
    log_info("Discovering tools from MCP servers...")
    servers = config.get("servers", {})

    try:
        all_tools = asyncio.run(get_all_tools(servers))
    except Exception as e:
        log_error(f"Error discovering tools: {e}")
        all_tools = []

    total_tools = sum(len(s.get("tools", [])) for s in all_tools)
    log_success(f"Found {total_tools} tools from {len(all_tools)} servers")

    for server in all_tools:
        server_name = server.get("name", "unknown")
        tools = server.get("tools", [])
        console.print(f"  [dim]•[/dim] [bold]{server_name}[/bold]: {len(tools)} tools")

    # Connect to testinator-tooling
    log_info(f"Connecting to [cyan]{config['deployment_url']}[/cyan]...")

    try:
        sio = start_socket_connection(config, all_tools)
    except Exception as e:
        log_error(f"Failed to connect: {e}")
        sys.exit(1)

    # Set up signal handlers for graceful shutdown
    def signal_handler(signum, frame):
        console.print("\n[yellow]Shutting down...[/yellow]")
        sio.disconnect()
        sys.exit(0)

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    # Keep the main thread alive
    console.print("[green]Ready.[/green] Press [bold]Ctrl+C[/bold] to stop.\n")
    try:
        while True:
            signal.pause()
    except AttributeError:
        # signal.pause() not available on Windows
        import time
        while True:
            time.sleep(1)


def run_serve_tui():
    """Run the serve command with TUI dashboard."""
    from .tui import ConnectApp, set_app, tui_set_connected

    config = load_config()

    if not config:
        console.print("[red]No configuration found[/red]")
        console.print(f"Please create config.json at: {get_config_file()}")
        sys.exit(1)

    if not config.get("deployment_url"):
        console.print("[red]deployment_url not configured[/red]")
        sys.exit(1)

    # Enable TUI mode for console routing
    set_tui_mode(True)

    # Create and run the TUI app with config for connection
    app = ConnectApp(server_url=config["deployment_url"], config=config)
    set_app(app)
    app.run()


def main():
    """Main CLI entry point."""
    parser = argparse.ArgumentParser(
        prog="testinator-connect",
        description="Connect local MCP servers to testinator-tooling",
    )

    parser.add_argument(
        "command",
        choices=["serve"],
        help="Command to run",
    )

    parser.add_argument(
        "--tui",
        action="store_true",
        help="Run with TUI dashboard",
    )

    args = parser.parse_args()

    if args.command == "serve":
        if args.tui:
            run_serve_tui()
        else:
            run_serve()


if __name__ == "__main__":
    main()
