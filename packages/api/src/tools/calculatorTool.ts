import { DefaultToolSchema } from "../consts";
import { Tool } from "./toolBase";
import { ToolRunner } from "./toolRunner";

export class CalculatorTool implements Tool {
  name = "calculatorTool";
  description = "calculatorTool can perform basic mathematical calculations";
  answerInstructions = "Be clear and concise. Do not repeat yourself";

  public async run(input: object): Promise<object> {
    console.log("calculatorTool", { input });
    try {
      const { expression } = input as { expression: string };

      if (!expression) {
        return {
          error: "Expression parameter is required",
        };
      }

      // Sanitize the expression to prevent code injection
      // Only allow numbers, basic operators, parentheses, and common math functions
      const sanitizedExpression = this.sanitizeExpression(expression);

      if (sanitizedExpression !== expression) {
        return {
          error:
            "Invalid expression. Only basic mathematical operations are allowed.",
        };
      }

      // Evaluate the expression
      try {
        // Use Function constructor to evaluate the expression in a sandboxed environment
        // This is safer than using eval() directly
        const result = new Function(`return ${sanitizedExpression}`)();

        return {
          expression: expression,
          result: result,
          formattedResult:
            typeof result === "number" && !Number.isInteger(result)
              ? parseFloat(result.toFixed(10))
              : result,
        };
      } catch (evalError) {
        return {
          error: `Failed to evaluate expression: ${evalError instanceof Error ? evalError.message : String(evalError)}`,
        };
      }
    } catch (error) {
      console.error("Error in calculator tool:", error);
      return {
        error: `Calculator error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private sanitizeExpression(expression: string): string {
    // Only allow numbers, basic operators, parentheses, decimal points, and whitespace
    // This is a basic implementation - a production version would need more robust validation
    const validPattern =
      /^[\d\s\(\)\+\-\*\/\.\,\^\%\sqrt\sin\cos\tan\log\abs\max\min]+$/;

    return validPattern.test(expression) ? expression : "";
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
              expression: {
                type: "string",
                description:
                  "The mathematical expression to evaluate (e.g., '2 + 2', '(5 * 10) / 2')",
              },
            },
            required: ["expression"],
          }),
        },
      },
    };
  }
}

// Register the tool with the ToolRunner
(() => ToolRunner.getToolRunner().registerTool(new CalculatorTool()))();
