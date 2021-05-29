import _ from "lodash/index";

export const enum LogLevel {
    trace = 1,
    info = 2,
    warning = 3,
    error = 4,
}

export const loggerLevels: [match: string | RegExp, level: LogLevel][] = [
];

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
    private readonly minLevel: LogLevel | undefined;
    public constructor(public readonly name: string) {
        this.minLevel = _(loggerLevels).reverse().find(([m, l]) => {
            if (typeof m === "string") {
                return this.name === m || this.name.startsWith(m + ".");
            }
            return !!this.name.match(m);
        })?.[1];
    }
    public log(level: LogLevel, ...message: unknown[]) {
        if (this.minLevel == null || level >= this.minLevel) {
            console.log(`[${this.name}][${getLevelExpr(level)}] ${message.map(m => formatMessageArg(m)).join(" ")}`);
        }
    }
    public trace(...message: unknown[]) {
        this.log(LogLevel.trace, message);
    }
    public info(...message: unknown[]) {
        this.log(LogLevel.info, message);
    }
    public warning(...message: unknown[]) {
        this.log(LogLevel.warning, message);
    }
    public error(...message: unknown[]) {
        this.log(LogLevel.error, message);
    }
}
