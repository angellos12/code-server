import { field, Level, logger } from "@coder/logger"
import { promises as fs } from "fs"
import yaml from "js-yaml"
import * as os from "os"
import * as path from "path"
import {
  canConnect,
  generateCertificate,
  generatePassword,
  humanPath,
  paths,
  isNodeJSErrnoException,
  isFile,
} from "./util"

const DEFAULT_SOCKET_PATH = path.join(os.tmpdir(), "vscode-ipc")

export enum Feature {
  // No current experimental features!
  Placeholder = "placeholder",
}

export enum AuthType {
  Password = "password",
  None = "none",
}

export class Optional<T> {
  public constructor(public readonly value?: T) {}
}

export enum LogLevel {
  Trace = "trace",
  Debug = "debug",
  Info = "info",
  Warn = "warn",
  Error = "error",
}

export class OptionalString extends Optional<string> {}

export interface Args extends CodeServerLib.ServerParsedArgs {
  config?: string
  auth?: AuthType
  password?: string
  "hashed-password"?: string
  cert?: OptionalString
  "cert-host"?: string
  "cert-key"?: string
  "disable-telemetry"?: boolean
  "disable-update-check"?: boolean
  enable?: string[]
  help?: boolean
  host?: string
  json?: boolean
  log?: LogLevel
  open?: boolean
  "bind-addr"?: string
  socket?: string
  version?: boolean
  force?: boolean
  "show-versions"?: boolean
  "proxy-domain"?: string[]
  "reuse-window"?: boolean
  "new-window"?: boolean
  verbose?: boolean

  link?: OptionalString
}

interface Option<T> {
  type: T
  /**
   * Short flag for the option.
   */
  short?: string
  /**
   * Whether the option is a path and should be resolved.
   */
  path?: boolean
  /**
   * Description of the option. Leave blank to hide the option.
   */
  description?: string

  /**
   * If marked as beta, the option is marked as beta in help.
   */
  beta?: boolean
}

type OptionType<T> = T extends boolean
  ? "boolean"
  : T extends OptionalString
  ? typeof OptionalString
  : T extends LogLevel
  ? typeof LogLevel
  : T extends AuthType
  ? typeof AuthType
  : T extends number
  ? "number"
  : T extends string
  ? "string"
  : T extends string[]
  ? "string[]"
  : "unknown"

type Options<T> = {
  [P in keyof T]: Option<OptionType<T[P]>>
}

const options: Options<Required<Args>> = {
  auth: { type: AuthType, description: "The type of authentication to use." },
  password: {
    type: "string",
    description: "The password for password authentication (can only be passed in via $PASSWORD or the config file).",
  },
  "hashed-password": {
    type: "string",
    description:
      "The password hashed with argon2 for password authentication (can only be passed in via $HASHED_PASSWORD or the config file). \n" +
      "Takes precedence over 'password'.",
  },
  cert: {
    type: OptionalString,
    path: true,
    description: "Path to certificate. A self signed certificate is generated if none is provided.",
  },
  "cert-host": {
    type: "string",
    description: "Hostname to use when generating a self signed certificate.",
  },
  "cert-key": { type: "string", path: true, description: "Path to certificate key when using non-generated cert." },
  "disable-telemetry": { type: "boolean", description: "Disable telemetry." },
  "disable-update-check": {
    type: "boolean",
    description:
      "Disable update check. Without this flag, code-server checks every 6 hours against the latest github release and \n" +
      "then notifies you once every week that a new release is available.",
  },
  // --enable can be used to enable experimental features. These features
  // provide no guarantees.
  enable: { type: "string[]" },
  help: { type: "boolean", short: "h", description: "Show this output." },
  json: { type: "boolean" },
  open: { type: "boolean", description: "Open in browser on startup. Does not work remotely." },

  "bind-addr": {
    type: "string",
    description: "Address to bind to in host:port. You can also use $PORT to override the port.",
  },

  config: {
    type: "string",
    description: "Path to yaml config file. Every flag maps directly to a key in the config file.",
  },

  // These two have been deprecated by bindAddr.
  host: { type: "string", description: "" },
  port: { type: "string", description: "" },

  socket: { type: "string", path: true, description: "Path to a socket (bind-addr will be ignored)." },
  version: { type: "boolean", short: "v", description: "Display version information." },
  _: { type: "string[]" },

  "user-data-dir": { type: "string", path: true, description: "Path to the user data directory." },
  "extensions-dir": { type: "string", path: true, description: "Path to the extensions directory." },
  "builtin-extensions-dir": { type: "string", path: true },
  "list-extensions": { type: "boolean", description: "List installed VS Code extensions." },
  force: { type: "boolean", description: "Avoid prompts when installing VS Code extensions." },
  "locate-extension": { type: "string[]" },
  "install-extension": {
    type: "string[]",
    description:
      "Install or update a VS Code extension by id or vsix. The identifier of an extension is `${publisher}.${name}`.\n" +
      "To install a specific version provide `@${version}`. For example: 'vscode.csharp@1.2.3'.",
  },
  "uninstall-extension": { type: "string[]", description: "Uninstall a VS Code extension by id." },
  "show-versions": { type: "boolean", description: "Show VS Code extension versions." },
  "proxy-domain": { type: "string[]", description: "Domain used for proxying ports." },
  "new-window": {
    type: "boolean",
    short: "n",
    description: "Force to open a new window.",
  },
  "reuse-window": {
    type: "boolean",
    short: "r",
    description: "Force to open a file or folder in an already opened window.",
  },

  log: { type: LogLevel },
  verbose: { type: "boolean", short: "vvv", description: "Enable verbose logging." },

  link: {
    type: OptionalString,
    description: `
      Securely bind code-server via our cloud service with the passed name. You'll get a URL like
      https://hostname-username.cdr.co at which you can easily access your code-server instance.
      Authorization is done via GitHub.
    `,
    beta: true,
  },

  connectionToken: { type: "string" },
  "connection-secret": {
    type: "string",
    description:
      "Path to file that contains the connection token. This will require that all incoming connections know the secret.",
  },
  "socket-path": { type: "string" },
  driver: { type: "string" },
  "start-server": { type: "boolean" },
  "print-startup-performance": { type: "boolean" },
  "print-ip-address": { type: "boolean" },
  "disable-websocket-compression": { type: "boolean" },

  fileWatcherPolling: { type: "string" },

  "enable-remote-auto-shutdown": { type: "boolean" },
  "remote-auto-shutdown-without-delay": { type: "boolean" },

  "without-browser-env-var": { type: "boolean" },
  "extensions-download-dir": { type: "string" },
  "install-builtin-extension": { type: "string[]" },

  category: {
    type: "string",
    description: "Filters installed extensions by provided category, when using --list-extensions.",
  },
  "do-not-sync": { type: "boolean" },
  "force-disable-user-env": { type: "boolean" },

  folder: { type: "string" },
  workspace: { type: "string" },
  "web-user-data-dir": { type: "string" },
  "use-host-proxy": { type: "string" },
  "enable-sync": { type: "boolean" },
  "github-auth": { type: "string" },
  logsPath: { type: "string" },
}

export const optionDescriptions = (): string[] => {
  const entries = Object.entries(options).filter(([, v]) => !!v.description)
  const widths = entries.reduce(
    (prev, [k, v]) => ({
      long: k.length > prev.long ? k.length : prev.long,
      short: v.short && v.short.length > prev.short ? v.short.length : prev.short,
    }),
    { short: 0, long: 0 },
  )
  return entries.map(([k, v]) => {
    const help = `${" ".repeat(widths.short - (v.short ? v.short.length : 0))}${v.short ? `-${v.short}` : " "} --${k} `
    return (
      help +
      v.description
        ?.trim()
        .split(/\n/)
        .map((line, i) => {
          line = line.trim()
          if (i === 0) {
            return " ".repeat(widths.long - k.length) + (v.beta ? "(beta) " : "") + line
          }
          return " ".repeat(widths.long + widths.short + 6) + line
        })
        .join("\n") +
      (typeof v.type === "object" ? ` [${Object.values(v.type).join(", ")}]` : "")
    )
  })
}

export function splitOnFirstEquals(str: string): string[] {
  // we use regex instead of "=" to ensure we split at the first
  // "=" and return the following substring with it
  // important for the hashed-password which looks like this
  // $argon2i$v=19$m=4096,t=3,p=1$0qR/o+0t00hsbJFQCKSfdQ$oFcM4rL6o+B7oxpuA4qlXubypbBPsf+8L531U7P9HYY
  // 2 means return two items
  // Source: https://stackoverflow.com/a/4607799/3015595
  // We use the ? to say the the substr after the = is optional
  const split = str.split(/=(.+)?/, 2)

  return split
}

export const createDefaultArgs = (): Args => {
  return {
    _: [],
    workspace: "",
    folder: "",
  }
}

export const parse = async (
  argv: string[],
  opts?: {
    configFile?: string
  },
): Promise<Args> => {
  const error = (msg: string): Error => {
    if (opts?.configFile) {
      msg = `error reading ${opts.configFile}: ${msg}`
    }

    return new Error(msg)
  }

  const args: Args = createDefaultArgs()
  let ended = false

  for (let i = 0; i < argv.length; ++i) {
    const arg = argv[i]

    // -- signals the end of option parsing.
    if (!ended && arg === "--") {
      ended = true
      continue
    }

    // Options start with a dash and require a value if non-boolean.
    if (!ended && arg.startsWith("-")) {
      let key: keyof Args | undefined
      let value: string | undefined
      if (arg.startsWith("--")) {
        const split = splitOnFirstEquals(arg.replace(/^--/, ""))
        key = split[0] as keyof Args
        value = split[1]
      } else {
        const short = arg.replace(/^-/, "")
        const pair = Object.entries(options).find(([, v]) => v.short === short)
        if (pair) {
          key = pair[0] as keyof Args
        }
      }

      if (!key || !options[key]) {
        throw error(`Unknown option ${arg}`)
      }

      if (key === "password" && !opts?.configFile) {
        throw new Error("--password can only be set in the config file or passed in via $PASSWORD")
      }

      if (key === "hashed-password" && !opts?.configFile) {
        throw new Error("--hashed-password can only be set in the config file or passed in via $HASHED_PASSWORD")
      }

      const option = options[key]
      if (option.type === "boolean") {
        ;(args[key] as boolean) = true
        continue
      }

      // Might already have a value if it was the --long=value format.
      if (typeof value === "undefined") {
        // A value is only valid if it doesn't look like an option.
        value = argv[i + 1] && !argv[i + 1].startsWith("-") ? argv[++i] : undefined
      }

      if (!value && option.type === OptionalString) {
        ;(args[key] as OptionalString) = new OptionalString(value)
        continue
      } else if (!value) {
        throw error(`--${key} requires a value`)
      }

      if (option.type === OptionalString && value === "false") {
        continue
      }

      if (option.path) {
        value = path.resolve(value)
      }

      switch (option.type) {
        case "string":
          ;(args[key] as string) = value
          break
        case "string[]":
          if (!args[key]) {
            ;(args[key] as string[]) = []
          }
          ;(args[key] as string[]).push(value)
          break
        case "number":
          ;(args[key] as number) = parseInt(value, 10)
          if (isNaN(args[key] as number)) {
            throw error(`--${key} must be a number`)
          }
          break
        case OptionalString:
          ;(args[key] as OptionalString) = new OptionalString(value)
          break
        default: {
          if (!Object.values(option.type).includes(value)) {
            throw error(`--${key} valid values: [${Object.values(option.type).join(", ")}]`)
          }
          ;(args[key] as string) = value
          break
        }
      }

      continue
    }

    // Everything else goes into _.
    args._.push(arg)
  }

  if (args._.length && !args.folder && !args.workspace) {
    const firstEntry = path.resolve(process.cwd(), args._[0])

    if ((await isFile(firstEntry)) && path.extname(firstEntry) === ".code-workspace") {
      args.workspace = firstEntry
      args._.shift()
    } else {
      args.folder = args._.join(" ")
    }
  }

  // If a cert was provided a key must also be provided.
  if (args.cert && args.cert.value && !args["cert-key"]) {
    throw new Error("--cert-key is missing")
  }

  logger.debug(() => ["parsed command line", field("args", { ...args, password: undefined })])

  return args
}

export interface DefaultedArgs extends ConfigArgs {
  auth: AuthType
  cert?: {
    value: string
  }
  host: string
  port: string
  "proxy-domain": string[]
  verbose: boolean
  usingEnvPassword: boolean
  usingEnvHashedPassword: boolean
  "extensions-dir": string
  "user-data-dir": string
}

/**
 * Take CLI and config arguments (optional) and return a single set of arguments
 * with the defaults set. Arguments from the CLI are prioritized over config
 * arguments.
 */
export async function setDefaults(cliArgs: Args, configArgs?: ConfigArgs): Promise<DefaultedArgs> {
  const args = Object.assign({}, configArgs || {}, cliArgs)

  if (!args["user-data-dir"]) {
    args["user-data-dir"] = paths.data
  }

  if (!args["extensions-dir"]) {
    args["extensions-dir"] = path.join(args["user-data-dir"], "extensions")
  }

  // --verbose takes priority over --log and --log takes priority over the
  // environment variable.
  if (args.verbose) {
    args.log = LogLevel.Trace
  } else if (
    !args.log &&
    process.env.LOG_LEVEL &&
    Object.values(LogLevel).includes(process.env.LOG_LEVEL as LogLevel)
  ) {
    args.log = process.env.LOG_LEVEL as LogLevel
  }

  // Sync --log, --verbose, the environment variable, and logger level.
  if (args.log) {
    process.env.LOG_LEVEL = args.log
  }
  switch (args.log) {
    case LogLevel.Trace:
      logger.level = Level.Trace
      args.verbose = true
      break
    case LogLevel.Debug:
      logger.level = Level.Debug
      args.verbose = false
      break
    case LogLevel.Info:
      logger.level = Level.Info
      args.verbose = false
      break
    case LogLevel.Warn:
      logger.level = Level.Warning
      args.verbose = false
      break
    case LogLevel.Error:
      logger.level = Level.Error
      args.verbose = false
      break
  }

  // Default to using a password.
  if (!args.auth) {
    args.auth = AuthType.Password
  }

  const addr = bindAddrFromAllSources(configArgs || createDefaultArgs(), cliArgs)
  args.host = addr.host
  args.port = addr.port.toString()

  // If we're being exposed to the cloud, we listen on a random address and
  // disable auth.
  if (args.link) {
    args.host = "localhost"
    args.port = "0"
    args.socket = undefined
    args.cert = undefined
    args.auth = AuthType.None
  }

  if (args.cert && !args.cert.value) {
    const { cert, certKey } = await generateCertificate(args["cert-host"] || "localhost")
    args.cert = {
      value: cert,
    }
    args["cert-key"] = certKey
  }

  let usingEnvPassword = !!process.env.PASSWORD
  if (process.env.PASSWORD) {
    args.password = process.env.PASSWORD
  }

  const usingEnvHashedPassword = !!process.env.HASHED_PASSWORD
  if (process.env.HASHED_PASSWORD) {
    args["hashed-password"] = process.env.HASHED_PASSWORD
    usingEnvPassword = false
  }

  // Ensure they're not readable by child processes.
  delete process.env.PASSWORD
  delete process.env.HASHED_PASSWORD

  // Filter duplicate proxy domains and remove any leading `*.`.
  const proxyDomains = new Set((args["proxy-domain"] || []).map((d) => d.replace(/^\*\./, "")))
  args["proxy-domain"] = Array.from(proxyDomains)

  return {
    ...args,
    usingEnvPassword,
    usingEnvHashedPassword,
  } as DefaultedArgs // TODO: Technically no guarantee this is fulfilled.
}

/**
 * Helper function to return the default config file.
 *
 * @param {string} password - Password passed in (usually from generatePassword())
 * @returns The default config file:
 *
 * - bind-addr: 127.0.0.1:8080
 * - auth: password
 * - password: <password>
 * - cert: false
 */
export function defaultConfigFile(password: string): string {
  return `bind-addr: 127.0.0.1:8080
auth: password
password: ${password}
cert: false
`
}

interface ConfigArgs extends Args {
  config: string
}

/**
 * Reads the code-server yaml config file and returns it as Args.
 *
 * @param configPath Read the config from configPath instead of $CODE_SERVER_CONFIG or the default.
 */
export async function readConfigFile(configPath?: string): Promise<ConfigArgs> {
  if (!configPath) {
    configPath = process.env.CODE_SERVER_CONFIG
    if (!configPath) {
      configPath = path.join(paths.config, "config.yaml")
    }
  }

  await fs.mkdir(path.dirname(configPath), { recursive: true })

  try {
    const generatedPassword = await generatePassword()
    await fs.writeFile(configPath, defaultConfigFile(generatedPassword), {
      flag: "wx", // wx means to fail if the path exists.
    })
    logger.info(`Wrote default config file to ${humanPath(configPath)}`)
  } catch (error: any) {
    // EEXIST is fine; we don't want to overwrite existing configurations.
    if (error.code !== "EEXIST") {
      throw error
    }
  }

  const configFile = await fs.readFile(configPath, "utf8")
  return parseConfigFile(configFile, configPath)
}

/**
 * parseConfigFile parses configFile into ConfigArgs.
 * configPath is used as the filename in error messages
 */
export async function parseConfigFile(configFile: string, configPath: string): Promise<ConfigArgs> {
  if (!configFile) {
    return { ...createDefaultArgs(), config: configPath }
  }

  const config = yaml.load(configFile, {
    filename: configPath,
  })
  if (!config || typeof config === "string") {
    throw new Error(`invalid config: ${config}`)
  }

  // We convert the config file into a set of flags.
  // This is a temporary measure until we add a proper CLI library.
  const configFileArgv = Object.entries(config).map(([optName, opt]) => {
    if (opt === true) {
      return `--${optName}`
    }
    return `--${optName}=${opt}`
  })
  const args = await parse(configFileArgv, {
    configFile: configPath,
  })
  return {
    ...args,
    config: configPath,
  }
}

function parseBindAddr(bindAddr: string): Addr {
  const u = new URL(`http://${bindAddr}`)
  return {
    host: u.hostname,
    // With the http scheme 80 will be dropped so assume it's 80 if missing.
    // This means --bind-addr <addr> without a port will default to 80 as well
    // and not the code-server default.
    port: u.port ? parseInt(u.port, 10) : 80,
  }
}

interface Addr {
  host: string
  port: number
}

/**
 * This function creates the bind address
 * using the CLI args.
 */
export function bindAddrFromArgs(addr: Addr, args: Args): Addr {
  addr = { ...addr }
  if (args["bind-addr"]) {
    addr = parseBindAddr(args["bind-addr"])
  }
  if (args.host) {
    addr.host = args.host
  }

  if (process.env.PORT) {
    addr.port = parseInt(process.env.PORT, 10)
  }
  if (args.port !== undefined) {
    addr.port = parseInt(args.port, 10)
  }
  return addr
}

function bindAddrFromAllSources(...argsConfig: Args[]): Addr {
  let addr: Addr = {
    host: "localhost",
    port: 8080,
  }

  for (const args of argsConfig) {
    addr = bindAddrFromArgs(addr, args)
  }

  return addr
}

/**
 * Reads the socketPath based on path passed in.
 *
 * The one usually passed in is the DEFAULT_SOCKET_PATH.
 *
 * If it can't read the path, it throws an error and returns undefined.
 */
export async function readSocketPath(path: string): Promise<string | undefined> {
  try {
    return await fs.readFile(path, "utf8")
  } catch (error) {
    // If it doesn't exist, we don't care.
    // But if it fails for some reason, we should throw.
    // We want to surface that to the user.
    if (!isNodeJSErrnoException(error) || error.code !== "ENOENT") {
      throw error
    }
  }
  return undefined
}

/**
 * Determine if it looks like the user is trying to open a file or folder in an
 * existing instance. The arguments here should be the arguments the user
 * explicitly passed on the command line, not defaults or the configuration.
 */
export const shouldOpenInExistingInstance = async (args: Args): Promise<string | undefined> => {
  // Always use the existing instance if we're running from VS Code's terminal.
  if (process.env.VSCODE_IPC_HOOK_CLI) {
    return process.env.VSCODE_IPC_HOOK_CLI
  }

  // If these flags are set then assume the user is trying to open in an
  // existing instance since these flags have no effect otherwise.
  const openInFlagCount = ["reuse-window", "new-window"].reduce((prev, cur) => {
    return args[cur as keyof Args] ? prev + 1 : prev
  }, 0)
  if (openInFlagCount > 0) {
    return readSocketPath(DEFAULT_SOCKET_PATH)
  }

  // It's possible the user is trying to spawn another instance of code-server.
  // Check if any unrelated flags are set (check against one because `_` always
  // exists), that a file or directory was passed, and that the socket is
  // active.
  if (Object.keys(args).length === 1 && args._.length > 0) {
    const socketPath = await readSocketPath(DEFAULT_SOCKET_PATH)
    if (socketPath && (await canConnect(socketPath))) {
      return socketPath
    }
  }

  return undefined
}
