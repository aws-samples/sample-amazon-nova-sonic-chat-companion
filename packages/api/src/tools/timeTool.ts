import { DefaultToolSchema } from "../consts";
import { Tool } from "./toolBase";
import { ToolRunner } from "./toolRunner";

export class TimeTool implements Tool {
  name: string = "getTimeTool";
  description: string = "getTimeTool is a tool for getting the current time";
  public async run(input: object): Promise<{ formattedTime: string }> {
    const pstTime = new Date().toLocaleString();
    return {
      formattedTime: new Date(pstTime).toLocaleTimeString("se-SV", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
      }),
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

ToolRunner.getToolRunner().registerTool(new TimeTool());
