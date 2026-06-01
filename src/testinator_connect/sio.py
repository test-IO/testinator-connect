"""Socket.IO connection handler for testinator-tooling."""

import asyncio
import os
import threading
from typing import Any, Callable, Iterable

import socketio
from mcp import ClientSession, StdioServerParameters
from mcp.client.sse import sse_client
from mcp.client.stdio import stdio_client
from mcp.client.streamable_http import streamablehttp_client

from .config import load_or_create_installation_state
from .console import log_info, log_success, log_error, log_warning, log_tool_call, log_tool_ok, log_tool_error, track_session_start, track_session_end
from .session_manager import get_session_manager


def _sanitize_server_tools(all_tools: Any) -> list[dict[str, Any]]:
    """
    Normalize and sanitize server/tool definitions into a predictable structure.

    Expected input shape:
        [
            {
                "name": <str>,
                "tools": [
                    {
                        "name": <str>,
                        "description": <str>,
                        "inputSchema": {
                            "type": <str>,
                            "properties": <dict>,
                            "required": <list>
                        }
                    },
                    ...
                ],
                "resources": [
                    {
                        "uri": <str>,
                        "name": <str>,
                        "description": <str>,
                        "mimeType": <str>
                    },
                    ...
                ]
            },
            ...
        ]

    Returns a list of sanitized servers with guaranteed keys and safe defaults.
    """
    sanitized_servers: list[dict[str, Any]] = []

    # Ensure we have an iterable of servers
    if not isinstance(all_tools, Iterable) or isinstance(all_tools, (str, bytes)):
        all_tools = []

    for server in all_tools:
        # Skip invalid server objects
        if not isinstance(server, dict):
            continue

        # server_info / instructions / protocol_version come from the
        # MCP InitializeResult (see _discover_server_capabilities).
        # They're optional and pass through unmodified — workflow's UI
        # renders them in the "details" view of the chosen server.
        server_info = server.get("server_info")
        sanitized_server: dict[str, Any] = {
            "name": server.get("name", "") or "",
            "server_info": server_info if isinstance(server_info, dict) else None,
            "instructions": server.get("instructions") if isinstance(server.get("instructions"), str) else None,
            "protocol_version": server.get("protocol_version") if isinstance(server.get("protocol_version"), str) else None,
            "tools": [],
            "resources": [],
        }

        tools = server.get("tools") or []
        if not isinstance(tools, Iterable) or isinstance(tools, (str, bytes)):
            tools = []

        for tool in tools:
            # Skip invalid tool objects
            if not isinstance(tool, dict):
                continue

            raw_input_schema = tool.get("inputSchema") or {}
            if not isinstance(raw_input_schema, dict):
                raw_input_schema = {}

            properties = raw_input_schema.get("properties") or {}
            if not isinstance(properties, dict):
                properties = {}

            required = raw_input_schema.get("required") or []
            if not isinstance(required, list):
                required = [required]

            input_schema = {
                "type": raw_input_schema.get("type", "object") or "object",
                "properties": properties,
                "required": required,
            }

            sanitized_tool = {
                "name": tool.get("name", "") or "",
                "description": tool.get("description", "") or "",
                "inputSchema": input_schema,
            }
            sanitized_server["tools"].append(sanitized_tool)

        resources = server.get("resources") or []
        if not isinstance(resources, Iterable) or isinstance(resources, (str, bytes)):
            resources = []

        for resource in resources:
            # Skip invalid resource objects
            if not isinstance(resource, dict):
                continue

            sanitized_resource = {
                "uri": resource.get("uri", "") or "",
                "name": resource.get("name", "") or "",
                "description": resource.get("description", "") or "",
                "mimeType": resource.get("mimeType", "") or "",
            }
            sanitized_server["resources"].append(sanitized_resource)

        sanitized_servers.append(sanitized_server)

    return sanitized_servers


def start_socket_connection(
    config: dict,
    all_tools: list[dict],
    notify_on_connect: Callable[[str], None] | None = None,
    notify_on_disconnect: Callable[[str], None] | None = None,
) -> socketio.Client:
    """
    Start a Socket.IO connection to testinator-tooling.

    Args:
        config: Configuration dictionary with deployment_url, auth_token, etc.
        all_tools: List of server/tool definitions
        notify_on_connect: Optional callback when connected
        notify_on_disconnect: Optional callback when disconnected

    Returns:
        The connected Socket.IO client
    """
    common_timeout = 90

    # Check if SSL verification should be disabled
    env_ssl_setting = os.environ.get("TESTINATOR_DISABLE_SSL_VERIFY", "").lower()
    if env_ssl_setting in ("true", "false"):
        disable_ssl_verify = env_ssl_setting == "true"
    else:
        disable_ssl_verify = not config.get("ssl_verify", False)

    if disable_ssl_verify:
        sio = socketio.Client(
            ssl_verify=False,
            logger=False,
            engineio_logger=False,
            reconnection=True,
            reconnection_attempts=5,
            reconnection_delay=1,
            reconnection_delay_max=5,
        )
        log_warning("SSL verification disabled")
    else:
        sio = socketio.Client(
            logger=False,
            engineio_logger=False,
            reconnection=True,
            reconnection_attempts=5,
            reconnection_delay=1,
            reconnection_delay_max=5,
        )
        log_info("SSL verification enabled")

    # Persistent identity for this testinator-connect installation.
    # installation_id is a UUID generated on first run + stored in
    # state.json next to config.json; display_name comes from
    # config.json (or hostname fallback). Sent on every mcp_connect so
    # tooling + workflow can identify "this machine" across reconnects,
    # since the Socket.IO sid changes every reconnect.
    installation = load_or_create_installation_state(config)
    log_info(
        f"Installation: {installation['display_name']} "
        f"(id={installation['installation_id'][:8]}…)"
    )

    @sio.event
    def connect():
        sio.emit(
            "mcp_connect",
            {
                "toolkit_configs": _sanitize_server_tools(all_tools),
                "timeout_tools_list": common_timeout,
                "timeout_tools_call": common_timeout,
                "installation_id": installation["installation_id"],
                "display_name": installation["display_name"],
            },
        )
        log_success("Connected to testinator-tooling")
        if notify_on_connect:
            notify_on_connect("Connected to testinator-tooling")

    @sio.event
    def disconnect():
        log_warning("Disconnected from testinator-tooling")
        if notify_on_disconnect:
            notify_on_disconnect("Disconnected from testinator-tooling")
        # Clean up persistent sessions when disconnecting
        session_manager = get_session_manager()
        try:
            session_manager.cleanup_all()
        except Exception as e:
            log_error(f"Session cleanup error: {e}")

    @sio.event
    def on_mcp_tools_list(data):
        all_tools_refreshed = asyncio.run(get_all_tools(config.get("servers", {})))
        return {
            "toolkit_configs": _sanitize_server_tools(all_tools_refreshed),
            "timeout_tools_list": common_timeout,
            "timeout_tools_call": common_timeout,
        }

    @sio.event
    def on_mcp_tools_call(data):
        """Handle tool call with optional session-based routing."""
        if "server" in data:
            server_name = data["server"]
            session_id = data.get("session_id")  # Optional for backward compatibility
            tool_name = data["params"].get("name", "unknown")

            # Build extra string for display in logs (truncated for readability)
            extra = f"session={session_id[:8]}..." if session_id else ""

            log_tool_call(server_name, tool_name, extra, session_id)

            servers = config.get("servers", {})
            server_conf = servers.get(server_name, {})

            if not server_conf:
                log_error(f"Unknown server: {server_name}")
                raise ValueError(f"Unknown server: {server_name}")

            try:
                tool_result = _mcp_tools_call_sync(
                    server_conf, data["params"], server_name=server_name, session_id=session_id
                )
                # Show result preview (truncate if too long)
                if isinstance(tool_result, str):
                    preview = tool_result[:1000] + "..." if len(tool_result) > 1000 else tool_result
                elif isinstance(tool_result, list):
                    preview = f"[{len(tool_result)} items]"
                else:
                    preview = str(tool_result)[:1000]
                log_tool_ok(server_name, tool_name, preview, extra, session_id)
                return tool_result
            except Exception as e:
                log_tool_error(server_name, tool_name, str(e), extra, session_id)
                raise

    @sio.event
    def on_mcp_notification(notification):
        log_info(f"Notification: {notification}")

    @sio.event
    def on_mcp_ping(data):
        return True

    @sio.event
    def on_mcp_resources_read(data):
        """Handle resource read request from testinator-tooling.

        Iteration 1 uses a fresh stateless session per read for
        simplicity — resources are typically read-only / initialization
        data, so a per-read session spin-up cost (~1–2s for stdio) is
        acceptable. A future optimization can route through the
        stateful session_manager the same way tool calls do.
        """
        server_name = data.get("server")
        params = data.get("params", {})
        uri = params.get("uri")

        if not server_name or not uri:
            return {
                "isError": True,
                "content": [{"type": "text", "text": "server and params.uri are required"}],
            }

        servers = config.get("servers", {})
        server_conf = servers.get(server_name)
        if not server_conf:
            log_error(f"Unknown server: {server_name}")
            return {
                "isError": True,
                "content": [{"type": "text", "text": f"Unknown server: {server_name}"}],
            }

        log_info(f"Reading resource {server_name}::{uri}")

        try:
            result = _mcp_resources_read_sync(server_conf, uri)
            log_info(f"Read resource {server_name}::{uri} ok")
            return result
        except Exception as e:
            log_error(f"Read resource {server_name}::{uri} failed: {e}")
            return {
                "isError": True,
                "content": [{"type": "text", "text": str(e)}],
            }

    @sio.event
    def on_mcp_session_start(data):
        """
        Handle session start request from testinator-tooling.

        Spawns a new browser subprocess for the given session ID.
        """
        session_id = data.get("session_id")
        server_name = data.get("server_name")  # Optional

        if not session_id:
            return {"success": False, "error": "session_id is required", "servers": []}

        session_manager = get_session_manager()
        servers_config = config.get("servers", {})

        spawned_servers = []
        errors = []

        try:
            if server_name:
                # Spawn specific server
                if server_name not in servers_config:
                    return {
                        "success": False,
                        "session_id": session_id,
                        "servers": [],
                        "error": f"Unknown server: {server_name}"
                    }

                server_conf = servers_config[server_name]
                session_manager.create_session_instance_sync(
                    session_id, server_name, server_conf
                )
                spawned_servers.append(server_name)
            else:
                # Spawn all stateful servers
                for name, conf in servers_config.items():
                    if conf.get("stateful", False):
                        try:
                            session_manager.create_session_instance_sync(
                                session_id, name, conf
                            )
                            spawned_servers.append(name)
                        except Exception as e:
                            errors.append(f"{name}: {e}")

            if errors and not spawned_servers:
                # All failed
                session_manager.destroy_session_instance_sync(session_id)
                return {
                    "success": False,
                    "session_id": session_id,
                    "servers": [],
                    "error": "; ".join(errors)
                }

            log_success(f"Session {session_id[:8]}... started with {spawned_servers}")
            track_session_start(session_id, spawned_servers)
            return {
                "success": True,
                "session_id": session_id,
                "servers": spawned_servers,
                "error": "; ".join(errors) if errors else None
            }

        except Exception as e:
            log_error(f"Session start failed for {session_id[:8]}...: {e}")
            session_manager.destroy_session_instance_sync(session_id)
            return {
                "success": False,
                "session_id": session_id,
                "servers": [],
                "error": str(e)
            }

    @sio.event
    def on_mcp_session_end(data):
        """
        Handle session end request from testinator-tooling.

        Kills the browser subprocess(es) for the given session ID.
        """
        session_id = data.get("session_id")

        if not session_id:
            return {"success": False, "error": "session_id is required"}

        session_manager = get_session_manager()

        try:
            session_manager.destroy_session_instance_sync(session_id)
            log_info(f"Session {session_id[:8]}... ended")
            track_session_end(session_id)
            return {"success": True, "session_id": session_id}
        except Exception as e:
            log_error(f"Session end failed for {session_id[:8]}...: {e}")
            track_session_end(session_id)  # Clean up TUI state even on error
            return {"success": False, "session_id": session_id, "error": str(e)}

    try:
        sio.connect(
            config["deployment_url"],
            headers={"Authorization": f"Bearer {config.get('auth_token', '')}"},
            wait_timeout=30,
            retry=True,
        )
    except Exception as e:
        log_error(f"Failed to connect: {e}")
        log_info("Please check your network connection and try again.")
        raise

    sio.on("mcp_tools_list", on_mcp_tools_list)
    sio.on("mcp_tools_call", on_mcp_tools_call)
    sio.on("mcp_resources_read", on_mcp_resources_read)
    sio.on("mcp_notification", on_mcp_notification)
    sio.on("mcp_ping", on_mcp_ping)
    sio.on("mcp_session_start", on_mcp_session_start)
    sio.on("mcp_session_end", on_mcp_session_end)

    def socketio_background_task():
        sio.wait()

    socketio_thread = threading.Thread(target=socketio_background_task, daemon=True)
    socketio_thread.start()

    return sio


def _mcp_resources_read_sync(server_conf: dict, uri: str) -> dict:
    """Synchronous wrapper for MCP resource reads.

    Always uses a fresh stateless session — see ``on_mcp_resources_read``
    docstring for the rationale.
    """
    session_manager = get_session_manager()

    async def _read():
        return await _mcp_resources_read(server_conf, uri)

    return session_manager._run_in_loop(_read())


def _mcp_tools_call_sync(
    server_conf: dict,
    params: dict,
    server_name: str | None = None,
    session_id: str | None = None,
) -> str | list[str]:
    """Synchronous wrapper for MCP tool calls.

    Args:
        server_conf: Server configuration
        params: Tool call parameters
        server_name: Name of the MCP server
        session_id: If provided, uses session-isolated mode with dedicated browser
    """
    session_manager = get_session_manager()

    # Check if this server should use stateful sessions
    if session_manager.is_stateful(server_conf) and server_name:
        try:
            result = session_manager.call_tool_with_recovery_sync(
                server_name, server_conf, params, session_id
            )
            return result
        except Exception as e:
            log_error(f"Stateful session failed: {e}")
            if not session_id:
                log_info("Falling back to stateless session...")
            else:
                raise

    # Use stateless session (original behavior) via async wrapper
    async def _stateless_call():
        return await _mcp_tools_call(server_conf, params, server_name)

    return session_manager._run_in_loop(_stateless_call())


async def get_all_tools(servers: dict) -> list[dict[str, Any]]:
    """
    Discover all tools from configured MCP servers.

    Args:
        servers: Dictionary of server configurations

    Returns:
        List of server/tool definitions
    """
    if not servers:
        return []

    tasks = [
        _process_server(server_name, server_conf)
        for server_name, server_conf in servers.items()
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    # Filter out exceptions and ensure required field is present
    valid_results = []
    for i, result in enumerate(results):
        if isinstance(result, Exception):
            server_name = list(servers.keys())[i]
            log_error(f"Server {server_name}: {result}")
            continue
        # Ensure required field exists in inputSchema
        for tool in result.get("tools", []):
            input_schema = tool.get("inputSchema")
            if input_schema is not None and "required" not in input_schema:
                input_schema["required"] = []
        valid_results.append(result)

    return valid_results


async def _process_server(server_name: str, server_conf: dict) -> dict[str, Any]:
    """Connect to an MCP server and discover its tools + resources."""
    server_type = server_conf.get("type", "stdio").lower()

    if server_type == "stdio":
        server_parameters = StdioServerParameters(**server_conf)
        async with stdio_client(server_parameters) as (read, write):
            async with ClientSession(read, write) as session:
                return await _discover_server_capabilities(session, server_name)

    elif server_type == "http":
        async with streamablehttp_client(
            server_conf["url"], server_conf.get("headers", {})
        ) as (read_stream, write_stream, _):
            async with ClientSession(read_stream, write_stream) as session:
                return await _discover_server_capabilities(session, server_name)

    elif server_type == "sse":
        async with sse_client(
            server_conf["url"], server_conf.get("headers", {})
        ) as streams:
            async with ClientSession(*streams) as session:
                return await _discover_server_capabilities(session, server_name)

    else:
        raise ValueError(f"Unsupported server type: {server_type}")


async def _discover_server_capabilities(session: ClientSession, server_name: str) -> dict[str, Any]:
    """Initialize and inventory tools + resources for one MCP server.

    Captures `InitializeResult` (server_info, instructions, protocol
    version) so the workflow UI can show a richer description of each
    MCP server beyond just its config-file name. Tools and resources
    are best-effort — many MCP servers don't implement resources/* and
    will raise on list_resources; we log and proceed with an empty
    list rather than failing the whole server's discovery.

    Returned dict shape:
      {
        "name": <config-file key, e.g. "poker_auction">,
        "server_info": {"name", "version"} | None,
        "instructions": <free-form text the server provides> | None,
        "protocol_version": <e.g. "2024-11-05"> | None,
        "tools": [<Tool.model_dump>, ...],
        "resources": [<Resource.model_dump(mode='json')>, ...],
      }
    """
    init_result = await session.initialize()

    # server_info / instructions / protocolVersion are part of
    # InitializeResult per the MCP spec. Capture defensively — older
    # SDKs may not populate every field.
    server_info: dict[str, Any] | None = None
    if getattr(init_result, "serverInfo", None) is not None:
        server_info = init_result.serverInfo.model_dump(mode="json", exclude_none=True)

    instructions = getattr(init_result, "instructions", None)
    protocol_version = getattr(init_result, "protocolVersion", None)

    tools_response = await session.list_tools()
    tools = [tool.model_dump(mode="json") for tool in tools_response.tools]

    resources: list[dict[str, Any]] = []
    try:
        resources_response = await session.list_resources()
        # mode="json" converts non-JSON-native pydantic types (notably
        # ``Resource.uri`` which is an ``AnyUrl``) into their JSON
        # representation (string). Without this, socketio.emit silently
        # fails to serialize the mcp_connect payload and the client
        # never registers on the tooling side.
        resources = [r.model_dump(mode="json") for r in resources_response.resources]
    except Exception as e:
        # Servers without resource support will raise McpError(method not found)
        # or similar. Don't let that take down the whole discovery.
        log_info(f"Server {server_name}: list_resources unavailable ({type(e).__name__}); proceeding with no resources")

    return {
        "name": server_name,
        "server_info": server_info,
        "instructions": instructions,
        "protocol_version": protocol_version,
        "tools": tools,
        "resources": resources,
    }


async def _mcp_tools_call(
    server_conf: dict, params: dict, server_name: str | None = None
) -> str | list[str]:
    """Async function for stateless MCP tool calls."""
    server_type = server_conf.get("type", "stdio").lower()

    if server_type == "stdio":
        server_parameters = StdioServerParameters(**server_conf)
        async with stdio_client(server_parameters) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                tool_result = await session.call_tool(
                    params["name"], params["arguments"]
                )
                return _serialize_tool_result(tool_result)

    elif server_type == "http":
        async with streamablehttp_client(
            server_conf["url"], server_conf.get("headers", {})
        ) as (read_stream, write_stream, _):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()
                tool_result = await session.call_tool(
                    params["name"], params["arguments"]
                )
                return _serialize_tool_result(tool_result)

    elif server_type == "sse":
        async with sse_client(
            server_conf["url"], server_conf.get("headers", {})
        ) as streams:
            async with ClientSession(*streams) as session:
                await session.initialize()
                tool_result = await session.call_tool(
                    params["name"], params["arguments"]
                )
                return _serialize_tool_result(tool_result)

    else:
        raise ValueError(f"Unsupported server type: {server_type}")


async def _mcp_resources_read(server_conf: dict, uri: str) -> dict:
    """Async function for stateless MCP resource reads.

    Returns the same ``{isError, content: [block, ...]}`` shape as
    ``_serialize_tool_result`` so the tooling-side adapter / runner can
    treat tool calls and resource reads with the same downstream
    decoding logic.
    """
    server_type = server_conf.get("type", "stdio").lower()

    if server_type == "stdio":
        server_parameters = StdioServerParameters(**server_conf)
        async with stdio_client(server_parameters) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                result = await session.read_resource(uri)
                return _serialize_resource_result(result)

    elif server_type == "http":
        async with streamablehttp_client(
            server_conf["url"], server_conf.get("headers", {})
        ) as (read_stream, write_stream, _):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()
                result = await session.read_resource(uri)
                return _serialize_resource_result(result)

    elif server_type == "sse":
        async with sse_client(
            server_conf["url"], server_conf.get("headers", {})
        ) as streams:
            async with ClientSession(*streams) as session:
                await session.initialize()
                result = await session.read_resource(uri)
                return _serialize_resource_result(result)

    else:
        raise ValueError(f"Unsupported server type: {server_type}")


def _serialize_resource_result(result: Any) -> dict:
    """Serialize an MCP ReadResourceResult for the wire.

    ``ReadResourceResult.contents`` is a list of ``TextResourceContents``
    (with ``text`` + ``mimeType``) or ``BlobResourceContents`` (with
    ``blob`` + ``mimeType``). We project each into a content-block dict
    that mirrors the ``CallToolResult.content`` shape so downstream
    consumers (tooling adapter, runner) decode resources and tool
    results with the same machinery.

    Resources don't have an ``isError`` field on the MCP side — failures
    raise. ``isError=False`` here matches the on-success-only contract.

    Critical: ``TextResourceContents.uri`` is a pydantic ``AnyUrl``, not a
    string. Without coercion the socketio ACK silently fails to JSON-encode
    and the caller times out at 60s — same bug we fixed for
    ``Resource.uri`` in ``_discover_server_capabilities``.
    """
    contents: list[dict] = []
    for item in getattr(result, "contents", []) or []:
        uri = getattr(item, "uri", None)
        uri_str = str(uri) if uri is not None else None
        if hasattr(item, "text") and item.text is not None:
            contents.append({
                "type": "text",
                "text": item.text,
                "uri": uri_str,
                "mimeType": getattr(item, "mimeType", None),
            })
        elif hasattr(item, "blob") and item.blob is not None:
            contents.append({
                "type": "blob",
                "blob": item.blob,
                "uri": uri_str,
                "mimeType": getattr(item, "mimeType", None),
            })
        elif hasattr(item, "model_dump"):
            # mode="json" handles AnyUrl + any other non-JSON-native pydantic types
            contents.append(item.model_dump(mode="json", exclude_none=True))
        else:
            contents.append({"type": "unknown", "repr": str(item)})

    return {
        "isError": False,
        "content": contents,
    }


def _serialize_tool_result(tool_result: Any) -> dict:
    """Serialize an MCP CallToolResult for the wire.

    Preserves ``isError`` and per-block typing so the consumer can
    classify into the G3 taxonomy (ok vs tool_error) instead of
    flattening every result to a string. Each content block is
    dumped via Pydantic's ``model_dump`` so the dict matches the
    block schema as defined by the MCP SDK (e.g. TextContent →
    ``{"type": "text", "text": "..."}``).
    """
    content_blocks: list[dict] = []
    for item in tool_result.content or []:
        if hasattr(item, "model_dump"):
            content_blocks.append(item.model_dump(exclude_none=True))
        elif hasattr(item, "text"):
            content_blocks.append({"type": "text", "text": item.text})
        elif hasattr(item, "data"):
            content_blocks.append({"type": "binary", "data": item.data})
        else:
            content_blocks.append({"type": "unknown", "repr": str(item)})

    return {
        "isError": bool(getattr(tool_result, "isError", False)),
        "content": content_blocks,
    }
