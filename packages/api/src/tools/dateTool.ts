import { DefaultToolSchema } from "../consts";
import { Tool } from "./toolBase";
import { ToolRunner } from "./toolRunner";

export class DateTool implements Tool {
  name: string = "getDateTool";
  description: string = "getDateTool is a tool for getting the current date";
  public async run(input: object): Promise<object> {
    const date = new Date().toLocaleString();
    const pstDate = new Date(date);
    return {
      date: pstDate.toISOString().split("T")[0],
      year: pstDate.getFullYear(),
      month: pstDate.getMonth() + 1,
      day: pstDate.getDate(),
      dayOfWeek: pstDate
        .toLocaleString("en-US", { weekday: "long" })
        .toUpperCase(),
    };
  }

  public spec() {
    return {
      toolSpec: {
        name: this.name,
        description: this.description,
        inputSchema: {
          json: DefaultToolSchema,
        },
      },
    };
  }
}

(() => ToolRunner.getToolRunner().registerTool(new DateTool()))();
