export const logLevels = ["debug", "info", "warn", "error", "off"] as const;
export type LogLevel = (typeof logLevels)[number];
export function readLogLevel(value: unknown): LogLevel {
  return logLevels.includes(value as LogLevel) ? (value as LogLevel) : "info";
}
export function shouldLog(level: Exclude<LogLevel, "off">, minimum: LogLevel) {
  return logLevels.indexOf(level) >= logLevels.indexOf(minimum);
}
