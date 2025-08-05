import { Tool } from "./toolBase";
import * as _logger from "../utils/logger";

const logger = process.env.PROD ? _logger : console;

export class ToolRunner {
  private tools: Map<string, Tool> = new Map();
  private static instance: ToolRunner;

  private constructor() {}

  static getToolRunner(): ToolRunner {
    logger.log("Getting tool runner");
    if (!this.instance) {
      this.instance = new ToolRunner();
    }
    return this.instance;
  }

  public registerTool(tool: Tool) {
    logger.log("Registering tool:", tool.name);
    this.tools.set(tool.name.toLowerCase(), tool);
  }

  public async runTool(toolName: string, input: object): Promise<unknown> {
    const tool = this.tools.get(toolName.toLowerCase());
    if (!tool) {
      logger.error(`Tool ${toolName} not found`);
      return {
        error: `Tool ${toolName} not found`,
      };
    }
    return tool.run(input);
  }

  public getSpecs(): { [key: string]: unknown }[] {
    const specs = Array.from(this.tools.values()).map((tool) => tool.spec());
    logger.log(JSON.stringify(specs));
    return specs;
  }
}

// Keep this at the end of the file since we need ToolRunner to be defined first
import ".";
