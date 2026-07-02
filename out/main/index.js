"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
const electron = require("electron");
const path = require("path");
const child_process = require("child_process");
const fs = require("fs");
const crypto = require("crypto");
const os = require("os");
const socket_ioClient = require("socket.io-client");
const index_js = require("@modelcontextprotocol/sdk/client/index.js");
const stdio_js = require("@modelcontextprotocol/sdk/client/stdio.js");
const sse_js = require("@modelcontextprotocol/sdk/client/sse.js");
const streamableHttp_js = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const path__namespace = /* @__PURE__ */ _interopNamespaceDefault(path);
const fs__namespace = /* @__PURE__ */ _interopNamespaceDefault(fs);
function getConfigPath() {
  return path__namespace.join(electron.app.getPath("userData"), "config.json");
}
function getInstallationId() {
  const idPath = path__namespace.join(electron.app.getPath("userData"), "installation-id");
  if (fs__namespace.existsSync(idPath)) {
    const id2 = fs__namespace.readFileSync(idPath, "utf8").trim();
    if (id2.length === 16) return id2;
  }
  const id = crypto.randomBytes(8).toString("hex");
  fs__namespace.mkdirSync(path__namespace.dirname(idPath), { recursive: true });
  fs__namespace.writeFileSync(idPath, id, "utf8");
  return id;
}
function loadConfig() {
  const configPath = getConfigPath();
  if (!fs__namespace.existsSync(configPath)) return null;
  try {
    const raw = JSON.parse(fs__namespace.readFileSync(configPath, "utf8"));
    const servers = {};
    for (const [name, conf] of Object.entries(raw.servers ?? {})) {
      servers[sanitizeServerName(name)] = conf;
    }
    return {
      deployment_url: raw.deployment_url ?? "",
      auth_token: raw.auth_token,
      timeout: Number(raw.timeout ?? 120),
      ssl_verify: raw.ssl_verify ?? false,
      display_name: raw.display_name,
      servers
    };
  } catch {
    return null;
  }
}
function saveConfig(config) {
  const configPath = getConfigPath();
  fs__namespace.mkdirSync(path__namespace.dirname(configPath), { recursive: true });
  fs__namespace.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
}
function sanitizeServerName(name) {
  let result = name.replace(/^[^a-zA-Z]+/, "");
  result = result.replace(/[^a-zA-Z0-9_]+$/, "");
  return result.replace(/[^a-zA-Z0-9_]/g, "_");
}
const IPC_TO_MAIN = {
  CONFIG_LOAD: "config:load",
  CONFIG_SAVE: "config:save",
  SERVICE_START: "service:start",
  SERVICE_STOP: "service:stop",
  SERVER_TEST: "server:test",
  SESSION_RESET: "session:reset",
  PLAYWRIGHT_INSTALL: "playwright:install",
  PLAYWRIGHT_CHECK: "playwright:check",
  CONFIG_OPEN_FILE: "config:open-file"
};
const IPC_TO_RENDERER = {
  LOG_ENTRY: "log:entry",
  STATUS_CHANGED: "status:changed",
  SESSION_UPDATED: "session:updated",
  SESSION_REMOVED: "session:removed",
  STATS_UPDATED: "stats:updated",
  TOOLS_UPDATED: "tools:updated",
  TOOL_CALL_UPDATED: "tool-call:updated",
  RESOURCES_UPDATED: "resources:updated",
  RESOURCE_READ_UPDATED: "resource-read:updated",
  PLAYWRIGHT_INSTALL_PROGRESS: "playwright:install-progress"
};
class Logger {
  constructor(getWindow) {
    this.getWindow = getWindow;
  }
  totalCalls = 0;
  callCounter = 0;
  resourceCallCounter = 0;
  logSeq = 0;
  pendingCalls = /* @__PURE__ */ new Map();
  pendingResourceReads = /* @__PURE__ */ new Map();
  send(channel, payload) {
    this.getWindow()?.webContents.send(channel, payload);
  }
  log(level, message, sessionId) {
    const entry = {
      seq: ++this.logSeq,
      timestamp: (/* @__PURE__ */ new Date()).toLocaleTimeString("en-US", { hour12: false }),
      level,
      message,
      sessionId
    };
    this.send(IPC_TO_RENDERER.LOG_ENTRY, entry);
  }
  info(msg) {
    this.log("info", msg);
  }
  success(msg) {
    this.log("success", msg);
  }
  warning(msg) {
    this.log("warning", msg);
  }
  error(msg) {
    this.log("error", msg);
  }
  toolCall(server, tool, args, sessionId) {
    const id = `${Date.now()}-${++this.callCounter}`;
    const record = {
      id,
      timestamp: (/* @__PURE__ */ new Date()).toLocaleTimeString("en-US", { hour12: false }),
      server,
      tool,
      sessionId,
      args,
      status: "pending"
    };
    this.pendingCalls.set(id, { startMs: Date.now(), record });
    this.send(IPC_TO_RENDERER.TOOL_CALL_UPDATED, record);
    this.log("tool_call", `${server}.${tool}`, sessionId);
    this.totalCalls++;
    this.send(IPC_TO_RENDERER.STATS_UPDATED, { totalCalls: this.totalCalls });
    return id;
  }
  toolOk(server, tool, result, sessionId, callId) {
    let preview;
    if (typeof result === "string") {
      preview = result.length > 120 ? result.slice(0, 120) + "..." : result;
    } else if (Array.isArray(result)) {
      preview = `[${result.length} items]`;
    } else if (result && typeof result === "object" && Array.isArray(result.content)) {
      const blocks = result.content;
      const parts = blocks.map((b) => {
        if (b.type === "text") return b.text?.slice(0, 80) ?? "";
        if (b.type === "image") return `[image${b.mimeType ? " " + b.mimeType : ""}]`;
        return `[${b.type}]`;
      });
      preview = parts.join(" ").slice(0, 120);
    } else {
      preview = JSON.stringify(result)?.slice(0, 120) ?? String(result);
    }
    this.log("tool_ok", `${server}.${tool} → ${preview}`, sessionId);
    if (callId) {
      const pending = this.pendingCalls.get(callId);
      if (pending) {
        const updated = {
          ...pending.record,
          result,
          status: "ok",
          durationMs: Date.now() - pending.startMs
        };
        this.pendingCalls.delete(callId);
        this.send(IPC_TO_RENDERER.TOOL_CALL_UPDATED, updated);
      }
    }
  }
  toolError(server, tool, error, sessionId, callId) {
    this.log("tool_error", `${server}.${tool} → ${error}`, sessionId);
    if (callId) {
      const pending = this.pendingCalls.get(callId);
      if (pending) {
        const updated = {
          ...pending.record,
          error,
          status: "error",
          durationMs: Date.now() - pending.startMs
        };
        this.pendingCalls.delete(callId);
        this.send(IPC_TO_RENDERER.TOOL_CALL_UPDATED, updated);
      }
    }
  }
  sessionStart(sessionId, servers) {
    this.log("session", `Session ${sessionId.slice(0, 8)}... started with [${servers.join(", ")}]`);
    const record = { sessionId, servers, status: "active", callCount: 0 };
    this.send(IPC_TO_RENDERER.SESSION_UPDATED, record);
  }
  sessionEnd(sessionId) {
    this.log("session", `Session ${sessionId.slice(0, 8)}... ended`);
    this.send(IPC_TO_RENDERER.SESSION_REMOVED, { sessionId });
  }
  setConnecting(deploymentUrl) {
    this.send(IPC_TO_RENDERER.STATUS_CHANGED, {
      connected: false,
      connecting: true,
      deploymentUrl,
      connectionError: null
    });
  }
  setConnected(connected, deploymentUrl, installationId, displayName, isReconnect) {
    this.send(IPC_TO_RENDERER.STATUS_CHANGED, {
      connected,
      connecting: false,
      deploymentUrl,
      installationId,
      displayName,
      isReconnect,
      connectionError: null
    });
  }
  setConnectionError(message) {
    this.send(IPC_TO_RENDERER.STATUS_CHANGED, {
      connected: false,
      connecting: false,
      connectionError: message
    });
  }
  setTools(tools) {
    this.send(IPC_TO_RENDERER.TOOLS_UPDATED, tools);
  }
  setResources(resources) {
    this.send(IPC_TO_RENDERER.RESOURCES_UPDATED, resources);
  }
  resourceRead(server, uri, sessionId) {
    const id = `r-${Date.now()}-${++this.resourceCallCounter}`;
    const record = {
      id,
      timestamp: (/* @__PURE__ */ new Date()).toLocaleTimeString("en-US", { hour12: false }),
      server,
      uri,
      sessionId,
      status: "pending"
    };
    this.pendingResourceReads.set(id, { startMs: Date.now(), record });
    this.send(IPC_TO_RENDERER.RESOURCE_READ_UPDATED, record);
    this.log("resource_read", `${server} → ${uri}`, sessionId);
    return id;
  }
  resourceReadOk(server, uri, result, sessionId, readId) {
    this.log("resource_ok", `${server} → ${uri}`, sessionId);
    if (readId) {
      const pending = this.pendingResourceReads.get(readId);
      if (pending) {
        const updated = {
          ...pending.record,
          result,
          status: "ok",
          durationMs: Date.now() - pending.startMs
        };
        this.pendingResourceReads.delete(readId);
        this.send(IPC_TO_RENDERER.RESOURCE_READ_UPDATED, updated);
      }
    }
  }
  resourceReadError(server, uri, error, sessionId, readId) {
    this.log("resource_error", `${server} → ${uri} error: ${error}`, sessionId);
    if (readId) {
      const pending = this.pendingResourceReads.get(readId);
      if (pending) {
        const updated = {
          ...pending.record,
          error,
          status: "error",
          durationMs: Date.now() - pending.startMs
        };
        this.pendingResourceReads.delete(readId);
        this.send(IPC_TO_RENDERER.RESOURCE_READ_UPDATED, updated);
      }
    }
  }
  reset() {
    this.totalCalls = 0;
    this.pendingCalls.clear();
    this.pendingResourceReads.clear();
    this.send(IPC_TO_RENDERER.STATS_UPDATED, { totalCalls: 0 });
    this.send(IPC_TO_RENDERER.TOOLS_UPDATED, []);
    this.send(IPC_TO_RENDERER.RESOURCES_UPDATED, []);
  }
}
function findNode() {
  const shells = ["/bin/zsh", "/bin/bash"];
  for (const shell of shells) {
    try {
      const result = child_process.execSync(`${shell} -lc "which node"`, { encoding: "utf8" }).trim();
      if (result) return result;
    } catch {
    }
  }
  const commonPaths = ["/opt/homebrew/bin/node", "/usr/local/bin/node"];
  for (const p of commonPaths) {
    if (fs__namespace.existsSync(p)) return p;
  }
  return "node";
}
function getNodeModulesRoot() {
  if (electron.app.isPackaged) {
    return path__namespace.join(process.resourcesPath, "app.asar.unpacked", "node_modules");
  }
  return path__namespace.join(__dirname, "..", "..", "node_modules");
}
function getPlaywrightCliPath() {
  const nodeModulesRoot = getNodeModulesRoot();
  const hoisted = path__namespace.join(nodeModulesRoot, "playwright", "cli.js");
  if (fs__namespace.existsSync(hoisted)) return hoisted;
  const nested = path__namespace.join(nodeModulesRoot, "@playwright", "mcp", "node_modules", "playwright", "cli.js");
  if (fs__namespace.existsSync(nested)) return nested;
  return hoisted;
}
function getPlaywrightBrowsersPath() {
  return path__namespace.join(electron.app.getPath("userData"), "playwright-browsers");
}
function isPlaywrightMcpCommand(command, args) {
  return command === "npx" && (args[0] ?? "").startsWith("@playwright/mcp");
}
function resolvePlaywrightMcpCommand(args) {
  const cliPath = path__namespace.join(getNodeModulesRoot(), "@playwright", "mcp", "cli.js");
  return {
    command: findNode(),
    args: [cliPath, ...args.slice(1)],
    env: {
      PLAYWRIGHT_BROWSERS_PATH: getPlaywrightBrowsersPath()
    }
  };
}
function isBrowserInstalled(browser) {
  const browsersPath = getPlaywrightBrowsersPath();
  try {
    return fs__namespace.readdirSync(browsersPath).some((d) => d.startsWith(browser));
  } catch {
    return false;
  }
}
const ELEVATED_BROWSERS = /* @__PURE__ */ new Set(["chrome", "msedge"]);
function installBrowser(browser, onOutput, sudoPassword) {
  return new Promise((resolve, reject) => {
    const cliPath = getPlaywrightCliPath();
    const node = findNode();
    const needsElevation = ELEVATED_BROWSERS.has(browser);
    let command;
    let args;
    let stdinData;
    if (needsElevation && sudoPassword && process.platform !== "win32") {
      command = "sudo";
      args = ["-S", node, cliPath, "install", "--force", browser];
      stdinData = sudoPassword + "\n";
    } else {
      command = node;
      args = [cliPath, "install", "--force", browser];
    }
    const proc = child_process.spawn(command, args, {
      env: {
        ...process.env,
        PLAYWRIGHT_BROWSERS_PATH: getPlaywrightBrowsersPath()
      }
    });
    if (stdinData) {
      proc.stdin.write(stdinData);
      proc.stdin.end();
    }
    proc.stdout.on("data", (d) => onOutput(d.toString()));
    proc.stderr.on("data", (d) => onOutput(d.toString()));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`playwright install ${browser} exited with code ${code}`));
    });
    proc.on("error", reject);
  });
}
function getUvPath() {
  const base = electron.app.isPackaged ? process.resourcesPath : path__namespace.join(__dirname, "../../resources");
  if (process.platform === "darwin") {
    const binary = process.arch === "arm64" ? "uv-macos-arm64" : "uv-macos-x64";
    return path__namespace.join(base, binary);
  }
  return path__namespace.join(base, "uv-windows-x64.exe");
}
const PYTHON_COMMANDS = /* @__PURE__ */ new Set(["python", "python3", "uv"]);
function resolveCommand(command, args) {
  if (isPlaywrightMcpCommand(command, args)) {
    return resolvePlaywrightMcpCommand(args);
  }
  if (!PYTHON_COMMANDS.has(command)) {
    return { command, args };
  }
  const uvPath = getUvPath();
  if (!fs__namespace.existsSync(uvPath)) {
    return { command, args };
  }
  if (command === "uv") {
    return { command: uvPath, args };
  }
  return { command: uvPath, args: ["run", command, ...args] };
}
function makeClient() {
  return new index_js.Client(
    { name: "agentic-qa-connect", version: "1.0.0" },
    { capabilities: {} }
  );
}
function buildTransport(conf) {
  const type = conf.type ?? "stdio";
  if (type === "stdio") {
    const resolved = resolveCommand(conf.command ?? "", conf.args ?? []);
    return new stdio_js.StdioClientTransport({
      command: resolved.command,
      args: resolved.args,
      env: resolved.env ? { ...process.env, ...resolved.env } : void 0
    });
  }
  if (type === "sse") {
    return new sse_js.SSEClientTransport(new URL(conf.url), {
      requestInit: { headers: conf.headers }
    });
  }
  return new streamableHttp_js.StreamableHTTPClientTransport(new URL(conf.url), {
    requestInit: { headers: conf.headers }
  });
}
async function discoverServer(serverName, conf) {
  const client = makeClient();
  const transport = buildTransport(conf);
  try {
    await client.connect(transport);
    const toolsRes = await client.listTools();
    const tools = toolsRes.tools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: {
        type: t.inputSchema.type ?? "object",
        properties: t.inputSchema.properties ?? {},
        required: t.inputSchema.required ?? []
      }
    }));
    let resources = [];
    if (client.getServerCapabilities()?.resources) {
      const resourcesRes = await client.listResources();
      resources = (resourcesRes.resources ?? []).map((r) => ({
        uri: String(r.uri),
        name: r.name ?? String(r.uri),
        description: r.description,
        mimeType: r.mimeType
      }));
    }
    return { name: serverName, tools, resources };
  } finally {
    await client.close().catch(() => {
    });
  }
}
async function discoverServerTools(serverName, conf) {
  const result = await discoverServer(serverName, conf);
  return { name: result.name, tools: result.tools };
}
async function readResourceStateless(conf, uri) {
  const client = makeClient();
  const transport = buildTransport(conf);
  try {
    await client.connect(transport);
    const res = await client.readResource({ uri });
    return res.contents;
  } finally {
    await client.close().catch(() => {
    });
  }
}
async function callToolStateless(conf, toolName, arguments_) {
  const client = makeClient();
  const transport = buildTransport(conf);
  try {
    await client.connect(transport);
    const res = await client.callTool({ name: toolName, arguments: arguments_ });
    return serializeToolResult(res);
  } finally {
    await client.close().catch(() => {
    });
  }
}
async function openPersistentSession(conf) {
  const client = makeClient();
  const transport = buildTransport(conf);
  await client.connect(transport);
  return {
    client,
    close: () => client.close().catch(() => {
    })
  };
}
function serializeToolResult(result) {
  const rawBlocks = Array.isArray(result?.content) ? result.content : [];
  const content = rawBlocks.map((item) => {
    if (item && typeof item === "object") {
      const out = {};
      for (const [k, v] of Object.entries(item)) {
        if (v !== void 0 && v !== null) out[k] = v;
      }
      if (typeof out.type !== "string") out.type = "unknown";
      return out;
    }
    return { type: "text", text: String(item) };
  });
  return {
    isError: Boolean(result?.isError),
    content
  };
}
class SessionManager {
  sessions = /* @__PURE__ */ new Map();
  isStateful(conf) {
    return conf.stateful === true;
  }
  async createSession(sessionId, serverName, conf) {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, /* @__PURE__ */ new Map());
    }
    const serverMap = this.sessions.get(sessionId);
    if (serverMap.has(serverName)) return;
    const session = await openPersistentSession(conf);
    serverMap.set(serverName, session);
  }
  async destroySession(sessionId) {
    const serverMap = this.sessions.get(sessionId);
    if (!serverMap) return;
    const closeAll = [...serverMap.values()].map((s) => s.close());
    await Promise.allSettled(closeAll);
    this.sessions.delete(sessionId);
  }
  async callToolInSession(sessionId, serverName, toolName, arguments_, conf, maxRetries = 2) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const session = this.sessions.get(sessionId)?.get(serverName);
        if (!session) throw new Error(`Session ${sessionId}/${serverName} not found`);
        const res = await session.client.callTool({ name: toolName, arguments: arguments_ });
        return serializeToolResult(res);
      } catch (err) {
        if (attempt < maxRetries - 1) {
          await this.destroyServerInSession(sessionId, serverName);
          try {
            await this.createSession(sessionId, serverName, conf);
          } catch {
          }
        } else {
          throw err;
        }
      }
    }
    throw new Error("unreachable");
  }
  async readResourceInSession(sessionId, serverName, uri, conf, maxRetries = 2) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const session = this.sessions.get(sessionId)?.get(serverName);
        if (!session) throw new Error(`Session ${sessionId}/${serverName} not found`);
        const res = await session.client.readResource({ uri });
        return res.contents;
      } catch (err) {
        if (attempt < maxRetries - 1) {
          await this.destroyServerInSession(sessionId, serverName);
          try {
            await this.createSession(sessionId, serverName, conf);
          } catch {
          }
        } else {
          throw err;
        }
      }
    }
    throw new Error("unreachable");
  }
  async readResourceStatelessFallback(conf, uri) {
    return readResourceStateless(conf, uri);
  }
  async callToolStatelessFallback(conf, toolName, arguments_) {
    return callToolStateless(conf, toolName, arguments_);
  }
  listSessions() {
    const result = {};
    for (const [sid, serverMap] of this.sessions) {
      result[sid] = [...serverMap.keys()];
    }
    return result;
  }
  hasSession(sessionId) {
    return this.sessions.has(sessionId);
  }
  async cleanupAll() {
    const ids = [...this.sessions.keys()];
    await Promise.allSettled(ids.map((id) => this.destroySession(id)));
  }
  async destroyServerInSession(sessionId, serverName) {
    const serverMap = this.sessions.get(sessionId);
    if (!serverMap) return;
    const session = serverMap.get(serverName);
    if (session) {
      await session.close();
      serverMap.delete(serverName);
    }
  }
}
const sessionManager = new SessionManager();
function buildToolkitConfigs(allTools, allResources) {
  const resourceMap = new Map(allResources.map((s) => [s.name, s.resources ?? []]));
  return allTools.map((server) => {
    const rawResources = resourceMap.get(server.name) ?? [];
    return {
      name: server.name ?? "",
      tools: (server.tools ?? []).map((tool) => {
        const rawSchema = tool.inputSchema ?? {};
        const properties = typeof rawSchema.properties === "object" && rawSchema.properties !== null ? rawSchema.properties : {};
        const required = Array.isArray(rawSchema.required) ? rawSchema.required : [];
        return {
          name: tool.name ?? "",
          description: tool.description ?? "",
          inputSchema: {
            type: typeof rawSchema.type === "string" ? rawSchema.type : "object",
            properties,
            required
          }
        };
      }),
      resources: rawResources.map((r) => ({
        uri: r.uri ?? "",
        name: r.name ?? r.uri ?? "",
        description: r.description ?? "",
        mimeType: r.mimeType ?? ""
      }))
    };
  });
}
class SocketIOService {
  constructor(config, allTools, allResources, logger, onFatalDisconnect) {
    this.config = config;
    this.allTools = allTools;
    this.allResources = allResources;
    this.logger = logger;
    this.onFatalDisconnect = onFatalDisconnect;
    this.clientId = getInstallationId();
  }
  socket = null;
  clientId;
  connect() {
    const { deployment_url, auth_token, ssl_verify } = this.config;
    const rejectUnauthorized = ssl_verify ?? false;
    this.socket = socket_ioClient.io(deployment_url, {
      extraHeaders: {
        Authorization: `Bearer ${auth_token ?? ""}`,
        "X-Installation-ID": this.clientId
      },
      rejectUnauthorized,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1e3,
      reconnectionDelayMax: 5e3
    });
    const socket = this.socket;
    const clientId = this.clientId;
    socket.on("connect", async () => {
      const activeSessions = Object.keys(sessionManager.listSessions());
      const payload = {
        toolkit_configs: buildToolkitConfigs(this.allTools, this.allResources),
        timeout_tools_list: 90,
        timeout_tools_call: 90,
        installation_id: clientId,
        display_name: this.config.display_name || os.hostname(),
        active_sessions: activeSessions
      };
      let isReconnect = false;
      try {
        const ack = await socket.timeout(3e4).emitWithAck("mcp_connect", payload);
        isReconnect = ack?.is_reconnect === true;
      } catch {
        socket.emit("mcp_connect", payload);
      }
      const msg = isReconnect ? `Reconnected to Agentic QA tooling (${activeSessions.length} sessions restored)` : "Connected to Agentic QA tooling";
      this.logger.success(msg);
      this.logger.setConnected(true, deployment_url, clientId, payload.display_name, isReconnect);
    });
    socket.on("disconnect", (reason) => {
      this.logger.warning("Disconnected from Agentic QA tooling");
      if (reason === "io client disconnect") {
        this.logger.setConnected(false);
      } else {
        this.logger.setConnecting(deployment_url);
      }
    });
    socket.on("connect_error", (err) => {
      this.logger.error(`Cannot reach ${deployment_url}: ${err.message}`);
    });
    socket.on("reconnect_failed", () => {
      const msg = `Failed to connect to ${deployment_url} after ${this.socket?.io?.reconnectionAttempts?.() ?? 5} attempts`;
      this.logger.error(msg);
      this.logger.setConnectionError(msg);
      socket.removeAllListeners();
      this.socket = null;
      this.onFatalDisconnect?.();
    });
    socket.on("mcp_tools_list", async (_data, callback) => {
      try {
        const { allTools: refreshedTools, allResources: refreshedResources } = await discoverAll(this.config.servers, this.logger);
        this.allTools = refreshedTools;
        this.allResources = refreshedResources;
        callback({
          toolkit_configs: buildToolkitConfigs(refreshedTools, refreshedResources),
          timeout_tools_list: 90,
          timeout_tools_call: 90
        });
      } catch (e) {
        this.logger.error(`Tool list refresh failed: ${e}`);
        callback({ toolkit_configs: [], timeout_tools_list: 90, timeout_tools_call: 90 });
      }
    });
    socket.on(
      "mcp_resources_read",
      async (data, callback) => {
        const { server: serverName, params, session_id } = data;
        const uri = params?.uri;
        const conf = this.config.servers[serverName];
        if (!conf) {
          this.logger.error(`Unknown server: ${serverName}`);
          callback({ error: `Unknown server: ${serverName}` });
          return;
        }
        const readId = this.logger.resourceRead(serverName, uri, session_id);
        try {
          let result;
          if (conf.stateful && session_id) {
            result = await sessionManager.readResourceInSession(session_id, serverName, uri, conf);
          } else {
            result = await sessionManager.readResourceStatelessFallback(conf, uri);
          }
          this.logger.resourceReadOk(serverName, uri, result, session_id, readId);
          callback(result);
        } catch (e) {
          this.logger.resourceReadError(serverName, uri, String(e), session_id, readId);
          callback({ error: String(e) });
        }
      }
    );
    socket.on(
      "mcp_tools_call",
      async (data, callback) => {
        const { server: serverName, params, session_id } = data;
        const conf = this.config.servers[serverName];
        if (!conf) {
          this.logger.error(`Unknown server: ${serverName}`);
          callback({ error: `Unknown server: ${serverName}` });
          return;
        }
        const callId = this.logger.toolCall(serverName, params.name, params.arguments, session_id);
        try {
          let result;
          if (conf.stateful && session_id) {
            result = await sessionManager.callToolInSession(
              session_id,
              serverName,
              params.name,
              params.arguments ?? {},
              conf
            );
          } else if (conf.stateful && !session_id) {
            try {
              result = await sessionManager.callToolInSession(
                "_legacy_",
                serverName,
                params.name,
                params.arguments ?? {},
                conf
              );
            } catch {
              result = await sessionManager.callToolStatelessFallback(
                conf,
                params.name,
                params.arguments ?? {}
              );
            }
          } else {
            result = await sessionManager.callToolStatelessFallback(
              conf,
              params.name,
              params.arguments ?? {}
            );
          }
          this.logger.toolOk(serverName, params.name, result, session_id, callId);
          callback(result);
        } catch (e) {
          this.logger.toolError(serverName, params.name, String(e), session_id, callId);
          callback({ error: String(e) });
        }
      }
    );
    socket.on("mcp_ping", (_data, callback) => {
      callback(true);
    });
    socket.on("mcp_notification", (notif) => {
      this.logger.info(`Notification: ${JSON.stringify(notif)}`);
    });
    socket.on(
      "mcp_session_start",
      async (data, callback) => {
        const { session_id, server_name } = data;
        if (!session_id) {
          callback({ success: false, error: "session_id is required", servers: [] });
          return;
        }
        const spawned = [];
        const errors = [];
        const serversConfig = this.config.servers;
        const targets = server_name ? serversConfig[server_name] ? [[server_name, serversConfig[server_name]]] : [] : Object.entries(serversConfig).filter(([, c]) => c.stateful);
        for (const [name, conf] of targets) {
          try {
            await sessionManager.createSession(session_id, name, conf);
            spawned.push(name);
          } catch (e) {
            errors.push(`${name}: ${e}`);
          }
        }
        if (spawned.length === 0 && errors.length > 0) {
          await sessionManager.destroySession(session_id).catch(() => {
          });
          callback({
            success: false,
            session_id,
            servers: [],
            error: errors.join("; ")
          });
          return;
        }
        this.logger.sessionStart(session_id, spawned);
        callback({
          success: true,
          session_id,
          servers: spawned,
          error: errors.length ? errors.join("; ") : null
        });
      }
    );
    socket.on(
      "mcp_session_end",
      async (data, callback) => {
        const { session_id } = data;
        if (!session_id) {
          callback({ success: false, error: "session_id is required" });
          return;
        }
        try {
          await sessionManager.destroySession(session_id);
          this.logger.sessionEnd(session_id);
          callback({ success: true, session_id });
        } catch (e) {
          this.logger.error(`Session end failed: ${e}`);
          this.logger.sessionEnd(session_id);
          callback({ success: false, session_id, error: String(e) });
        }
      }
    );
  }
  disconnect() {
    this.socket?.disconnect();
    this.socket = null;
  }
}
async function discoverAll(servers, logger) {
  const entries = Object.entries(servers);
  const results = await Promise.allSettled(
    entries.map(([name, conf]) => {
      logger?.info(`Connecting to MCP server "${name}"...`);
      return discoverServer(name, conf);
    })
  );
  const fulfilled = [];
  results.forEach((r, i) => {
    const name = entries[i][0];
    if (r.status === "fulfilled") {
      const { tools, resources } = r.value;
      logger?.success(`"${name}": ${tools.length} tool(s), ${resources.length} resource(s)`);
      fulfilled.push(r.value);
    } else {
      const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
      logger?.error(`Failed to discover from "${name}": ${reason}`);
    }
  });
  return {
    allTools: fulfilled.map(({ name, tools }) => ({ name, tools })),
    allResources: fulfilled.map(({ name, resources }) => ({ name, resources }))
  };
}
class ConnectService {
  constructor(logger) {
    this.logger = logger;
  }
  sioService = null;
  running = false;
  abortController = null;
  async start(config) {
    if (this.running) return;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    if (!config.ssl_verify) {
      this.logger.warning("SSL verification disabled");
    }
    this.logger.info("Discovering tools and resources from MCP servers...");
    const { allTools, allResources } = await discoverAll(config.servers, this.logger);
    if (signal.aborted) {
      this.logger.warning("Start interrupted before connecting");
      return;
    }
    const totalTools = allTools.reduce((n, s) => n + s.tools.length, 0);
    const totalResources = allResources.reduce((n, s) => n + s.resources.length, 0);
    this.logger.success(
      `Found ${totalTools} tools and ${totalResources} resources from ${allTools.length} servers`
    );
    const toolInfos = allTools.flatMap(
      (s) => s.tools.map((t) => ({
        server: s.name,
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema
      }))
    );
    this.logger.setTools(toolInfos);
    const resourceInfos = allResources.flatMap(
      (s) => s.resources.map((r) => ({
        server: s.name,
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType
      }))
    );
    this.logger.setResources(resourceInfos);
    this.logger.info(`Connecting to ${config.deployment_url}...`);
    this.logger.setConnecting(config.deployment_url);
    this.sioService = new SocketIOService(config, allTools, allResources, this.logger, () => {
      this.running = false;
      this.sioService = null;
    });
    this.sioService.connect();
    this.running = true;
  }
  async stop() {
    this.abortController?.abort();
    this.abortController = null;
    this.sioService?.disconnect();
    this.sioService = null;
    await sessionManager.cleanupAll();
    this.running = false;
    this.logger.setConnected(false);
    this.logger.warning("Service stopped");
  }
  isRunning() {
    return this.running;
  }
}
function getWindowIcon() {
  if (process.platform === "win32") return path.join(electron.app.getAppPath(), "images/windows/icon.ico");
  if (process.platform === "linux") return path.join(electron.app.getAppPath(), "images/linux/icons/256x256.png");
  return void 0;
}
if (process.platform !== "win32") {
  try {
    process.env.PATH = child_process.execSync('/bin/zsh -lc "echo $PATH"').toString().trim();
  } catch {
  }
}
let mainWindow = null;
function createWindow() {
  mainWindow = new electron.BrowserWindow({
    title: "Agentic QA - connect",
    width: 1200,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    icon: getWindowIcon(),
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 14 },
    show: false
  });
  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
  });
  mainWindow.webContents.setWindowOpenHandler((details) => {
    electron.shell.openExternal(details.url);
    return { action: "deny" };
  });
  if (process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}
function registerIpcHandlers() {
  const logger = new Logger(() => mainWindow);
  const service = new ConnectService(logger);
  electron.ipcMain.handle(IPC_TO_MAIN.CONFIG_LOAD, () => {
    return loadConfig();
  });
  electron.ipcMain.handle(IPC_TO_MAIN.CONFIG_SAVE, (_event, config) => {
    try {
      saveConfig(config);
    } catch (e) {
      throw new Error(`Could not write config: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  electron.ipcMain.handle(IPC_TO_MAIN.SERVICE_START, async () => {
    const config = loadConfig();
    if (!config) throw new Error("No configuration found. Please save your config first.");
    if (!config.deployment_url) throw new Error("deployment_url is required in config.");
    logger.setConnected(false, config.deployment_url);
    await service.start(config);
  });
  electron.ipcMain.handle(IPC_TO_MAIN.SERVICE_STOP, async () => {
    await service.stop();
    logger.setConnected(false);
  });
  electron.ipcMain.handle(IPC_TO_MAIN.SESSION_RESET, () => {
    logger.reset();
  });
  electron.ipcMain.handle(
    IPC_TO_MAIN.SERVER_TEST,
    async (_event, name, conf) => {
      try {
        const info = await discoverServerTools(name, conf);
        return { ok: true, toolCount: info.tools.length };
      } catch (e) {
        return { ok: false, toolCount: 0, error: e instanceof Error ? e.message : String(e) };
      }
    }
  );
  electron.ipcMain.handle(IPC_TO_MAIN.CONFIG_OPEN_FILE, async () => {
    const configPath = getConfigPath();
    const { mkdirSync, writeFileSync, existsSync } = await import("fs");
    const { dirname } = await import("path");
    if (!existsSync(configPath)) {
      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(configPath, JSON.stringify({ deployment_url: "", servers: {} }, null, 2));
    }
    const err = await electron.shell.openPath(configPath);
    if (err) {
      electron.dialog.showErrorBox("Could not open config file", err);
    }
  });
  electron.ipcMain.handle(IPC_TO_MAIN.PLAYWRIGHT_CHECK, (_event, browser) => {
    return isBrowserInstalled(browser);
  });
  electron.ipcMain.handle(IPC_TO_MAIN.PLAYWRIGHT_INSTALL, async (_event, browser, sudoPassword) => {
    await installBrowser(browser, (line) => {
      mainWindow?.webContents.send(IPC_TO_RENDERER.PLAYWRIGHT_INSTALL_PROGRESS, line);
    }, sudoPassword);
  });
}
electron.app.whenReady().then(() => {
  if (process.platform === "darwin" && !electron.app.isPackaged) {
    electron.app.dock?.setIcon(path.join(electron.app.getAppPath(), "images/macos/1024x1024.png"));
  }
  createWindow();
  registerIpcHandlers();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") electron.app.quit();
});
electron.app.on("before-quit", () => {
  sessionManager.cleanupAll().catch(() => {
  });
});
