import { Tool } from "./toolBase";
import { ToolRunner } from "./toolRunner";

export class DateDiffTool implements Tool {
  name = "dateDiffTool";
  description =
    "dateDiffTool can be used for calculating the difference between two dates or times";

  public async run(input: object): Promise<object> {
    console.log("dateDiffTool", { input });
    try {
      const { startDate, endDate } = input as {
        startDate: string;
        endDate?: string;
      };

      if (!startDate) {
        return {
          error: "startDate parameter is required",
        };
      }

      // If endDate is not provided, use current date
      const start = new Date(startDate);
      const end = endDate ? new Date(endDate) : new Date();

      // Validate dates
      if (isNaN(start.getTime())) {
        return {
          error: `Invalid startDate: ${startDate}. Please provide a valid date format (e.g., '2023-04-15', 'April 15, 2023')`,
        };
      }

      if (isNaN(end.getTime())) {
        return {
          error: `Invalid endDate: ${endDate}. Please provide a valid date format (e.g., '2023-04-15', 'April 15, 2023')`,
        };
      }

      // Calculate difference in milliseconds
      const diffMs = Math.abs(end.getTime() - start.getTime());

      // Calculate various time differences
      const diffSeconds = Math.floor(diffMs / 1000);
      const diffMinutes = Math.floor(diffSeconds / 60);
      const diffHours = Math.floor(diffMinutes / 60);
      const diffDays = Math.floor(diffHours / 24);
      const diffWeeks = Math.floor(diffDays / 7);

      // Calculate years, months more accurately
      let years = 0;
      let months = 0;

      // Clone dates to avoid modifying the originals
      const earlierDate = start < end ? new Date(start) : new Date(end);
      const laterDate = start < end ? new Date(end) : new Date(start);

      // Calculate years
      years = laterDate.getFullYear() - earlierDate.getFullYear();

      // Adjust years if needed based on month and day
      if (
        laterDate.getMonth() < earlierDate.getMonth() ||
        (laterDate.getMonth() === earlierDate.getMonth() &&
          laterDate.getDate() < earlierDate.getDate())
      ) {
        years--;
      }

      // Calculate months
      months = (laterDate.getMonth() + 12 - earlierDate.getMonth()) % 12;
      if (laterDate.getDate() < earlierDate.getDate()) {
        months = (months + 11) % 12; // Adjust if we haven't reached the same day of month
      }

      // Determine if dates are in the future or past
      const isPast = end < start;
      const direction = isPast ? "ago" : "from now";

      // Format the result
      return {
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        difference: {
          milliseconds: diffMs,
          seconds: diffSeconds,
          minutes: diffMinutes,
          hours: diffHours,
          days: diffDays,
          weeks: diffWeeks,
          months: months + years * 12,
          years: years,
        },
        humanReadable: this.getHumanReadableDiff(diffMs, isPast),
        direction: isPast ? "past" : "future",
        relativeDescription: endDate
          ? `${start < end ? "From" : "Until"} ${start.toDateString()} to ${end.toDateString()}`
          : `${diffDays} days ${direction}`,
      };
    } catch (error) {
      console.error("Error in date diff tool:", error);
      return {
        error: `Date diff error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private getHumanReadableDiff(diffMs: number, isPast: boolean): string {
    const seconds = Math.floor(diffMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const months = Math.floor(days / 30.44); // Average days in month
    const years = Math.floor(days / 365.25); // Account for leap years

    const direction = isPast ? "ago" : "from now";

    if (years > 0) {
      return years === 1
        ? `1 year ${direction}`
        : `${years} years ${direction}`;
    } else if (months > 0) {
      return months === 1
        ? `1 month ${direction}`
        : `${months} months ${direction}`;
    } else if (days > 0) {
      return days === 1 ? `1 day ${direction}` : `${days} days ${direction}`;
    } else if (hours > 0) {
      return hours === 1
        ? `1 hour ${direction}`
        : `${hours} hours ${direction}`;
    } else if (minutes > 0) {
      return minutes === 1
        ? `1 minute ${direction}`
        : `${minutes} minutes ${direction}`;
    } else {
      return seconds === 1
        ? `1 second ${direction}`
        : `${seconds} seconds ${direction}`;
    }
  }

  public spec() {
    return {
      toolSpec: {
        name: this.name,
        description: this.description,
        inputSchema: {
          json: JSON.stringify({
            $schema: "http://json-schema.org/draft-07/schema#",
            type: "object",
            properties: {
              startDate: {
                type: "string",
                description:
                  "The start date (e.g., '2023-04-15', 'April 15, 2023'). If comparing with current date, this can be the reference date.",
              },
              endDate: {
                type: "string",
                description:
                  "The end date (e.g., '2023-05-20', 'May 20, 2023').",
              },
            },
            required: ["startDate"],
          }),
        },
      },
    };
  }
}

// Register the tool with the ToolRunner
(() => ToolRunner.getToolRunner().registerTool(new DateDiffTool()))();
