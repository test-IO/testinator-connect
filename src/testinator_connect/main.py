"""CLI entry point for testinator-connect."""

import argparse
import asyncio
import signal
import sys

from .config import load_config, get_config_file
from .sio import start_socket_connection, get_all_tools


def run_serve():
    """Run the serve command - connect to testinator-tooling."""
    print("Starting testinator-connect...")
    print(f"Config file: {get_config_file()}")

    config = load_config()

    if not config:
        print("Error: No configuration found.")
        print(f"Please create a config.json file at: {get_config_file()}")
        sys.exit(1)

    if not config.get("deployment_url"):
        print("Error: deployment_url not configured.")
        sys.exit(1)

    if not config.get("servers"):
        print("Warning: No MCP servers configured.")

    # Discover tools from configured servers
    print("Discovering tools from configured MCP servers...")
    servers = config.get("servers", {})

    try:
        all_tools = asyncio.run(get_all_tools(servers))
    except Exception as e:
        print(f"Error discovering tools: {e}")
        all_tools = []

    total_tools = sum(len(s.get("tools", [])) for s in all_tools)
    print(f"Discovered {total_tools} tools from {len(all_tools)} servers")

    for server in all_tools:
        server_name = server.get("name", "unknown")
        tools = server.get("tools", [])
        print(f"  - {server_name}: {len(tools)} tools")

    # Connect to testinator-tooling
    print(f"Connecting to {config['deployment_url']}...")

    try:
        sio = start_socket_connection(config, all_tools)
    except Exception as e:
        print(f"Failed to connect: {e}")
        sys.exit(1)

    # Set up signal handlers for graceful shutdown
    def signal_handler(signum, frame):
        print("\nShutting down...")
        sio.disconnect()
        sys.exit(0)

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    # Keep the main thread alive
    print("Ready. Press Ctrl+C to stop.")
    try:
        while True:
            signal.pause()
    except AttributeError:
        # signal.pause() not available on Windows
        import time
        while True:
            time.sleep(1)


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

    args = parser.parse_args()

    if args.command == "serve":
        run_serve()


if __name__ == "__main__":
    main()
