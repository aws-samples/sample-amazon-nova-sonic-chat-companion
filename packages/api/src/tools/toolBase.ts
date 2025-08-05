// You can use answerInstruction to tell the LLM how to process the data in
// the answer from the tool. Look at weatherTool for an example.

export interface Tool {
  name: string;
  answerInstructions?: string;
  description: string;
  run: (params: object) => Promise<unknown>;
  spec: () => { [key: string]: unknown };
}
