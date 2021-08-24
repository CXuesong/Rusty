import _ from "lodash/index";

export const enum LogLevel {
    trace = 1,
    info = 2,
    warning = 3,
    error = 4,
}

export const loggerLevels: (readonly [match: string | RegExp, level: LogLevel])[] = [
];

let loggerLevelCacheToken = 0;

export function purgeLoggerLevelCache() {
    loggerLevelCacheToken++;
}

function getLevelExpr(level: LogLevel): string {
    switch (level) {
        case LogLevel.trace: return "TRACE";
        case LogLevel.info: return "INFO";
        case LogLevel.warning: return "WARNING";
        case LogLevel.error: return "ERROR";
        default: return `Level${level}`
    }
}

function formatMessageArg(arg: unknown): string {
    if (arg instanceof Error) {
        return arg.stack || String(arg);
    }
    return String(arg);
}

export class Logger {
    private minLevel: LogLevel | "init" | undefined = "init";
    private _minLevelCacheToken = loggerLevelCacheToken;
    public constructor(public readonly name: string) {
    }
    public log(level: LogLevel, message: () => unknown): void;
    public log(level: LogLevel, ...message: unknown[]): void;
    public log(level: LogLevel, ...message: unknown[]) {
        if (this._minLevelCacheToken !== loggerLevelCacheToken || this.minLevel === "init") {
            // Lazy evaluation log level.
            const matchedEntry = _(loggerLevels).findLast(([m, l]) => {
                if (typeof m === "string") {
                    return this.name === m || this.name.startsWith(m + ".");
                }
                return !!this.name.match(m);
            });
            this.minLevel = matchedEntry?.[1];
            this._minLevelCacheToken = loggerLevelCacheToken;
        }
        if (this.minLevel == null || level >= this.minLevel) {
            const formatted = message.length === 1 && typeof message[0] === "function" ? message[0]() : message.map(m => formatMessageArg(m)).join(" ");
            console.log(`[${this.name}][${getLevelExpr(level)}] ${formatted}`);
        }
    }
    public trace(message: () => unknown): void;
    public trace(...message: unknown[]): void;
    public trace(...message: unknown[]) {
        this.log(LogLevel.trace, ...message);
    }
    public info(message: () => unknown): void;
    public info(...message: unknown[]): void;
    public info(...message: unknown[]) {
        this.log(LogLevel.info, ...message);
    }
    public warning(message: () => unknown): void;
    public warning(...message: unknown[]): void;
    public warning(...message: unknown[]) {
        this.log(LogLevel.warning, ...message);
    }
    public error(message: () => unknown): void;
    public error(...message: unknown[]): void;
    public error(...message: unknown[]) {
        this.log(LogLevel.error, ...message);
    }
}
