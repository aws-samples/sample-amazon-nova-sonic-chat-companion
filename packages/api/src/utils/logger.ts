import { Logger, LogLevel } from "@aws-lambda-powertools/logger";

type LogLevelType = (typeof LogLevel)[keyof typeof LogLevel];
// Create and configure the logger
export const logger = new Logger({
  serviceName: "nova-s2s-api",
  logLevel:
    (process.env.LOG_LEVEL?.toUpperCase() as LogLevelType) || LogLevel.INFO,
  persistentLogAttributes: {
    // Add any persistent attributes you want to include in all logs
    environment: process.env.NODE_ENV || "development",
  },
});

// Export convenience methods that match console.log/error patterns
export const log = (message: string, ...args: any[]): void => {
  if (args.length > 0) {
    logger.info(message, { additionalInfo: args });
  } else {
    logger.info(message);
  }
};

export const error = (message: string, ...args: any[]): void => {
  if (args.length > 0) {
    logger.error(message, { additionalInfo: args });
  } else {
    logger.error(message);
  }
};

export const debug = (message: string, ...args: any[]): void => {
  if (args.length > 0) {
    logger.debug(message, { additionalInfo: args });
  } else {
    logger.debug(message);
  }
};

// Default export for convenience
export default logger;
