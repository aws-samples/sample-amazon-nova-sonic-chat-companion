import { Tool } from "./toolBase";
import { ToolRunner } from "./toolRunner";

export class WebSearchTool implements Tool {
  public name = "webSearchTool";
  public description =
    "webSearchTool can be used to search the web for real time information or any information you are not sure you know";
  async run(_params: object): Promise<unknown> {
    const params = _params as { query: string };
    try {
      if (!params.query) {
        return {
          error: "No search query provided",
        };
      }

      // Get API key and search engine ID from environment variables
      const apiKey = process.env.GOOGLE_API_KEY;
      const searchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID;

      if (!apiKey || !searchEngineId) {
        throw new Error("Google API key or Search Engine ID not configured");
      }

      // Using Google Custom Search JSON API
      const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${searchEngineId}&q=${encodeURIComponent(params.query)}&num=10&filter=1`;

      const response = await fetch(searchUrl);

      if (!response.ok) {
        throw new Error(`Search API returned status: ${response.status}`);
      }

      const data = (await response.json()) as any;

      // Format the search results
      interface SearchResult {
        title: string;
        content: string;
        url: string;
        source: string;
      }

      const results: SearchResult[] = [];

      // Add search results
      if (data.items && data.items.length > 0) {
        data.items.slice(0, 5).forEach((item: any) => {
          results.push({
            title: item.title || "Search Result",
            content: item.snippet || "",
            url: item.link || "",
            source: item.displayLink || "Google Search",
          });
        });
      }

      return {
        query: params.query,
        results: results,
        // Include any additional information if available
        searchInformation: data.searchInformation || null,
      };
    } catch (error) {
      console.error("Error in web search tool:", error);
      return {
        error: `Failed to perform web search: ${(error as Error).message}`,
        fallbackMessage:
          "I couldn't access web search results at the moment. Please try again later or rephrase your question.",
      };
    }
  }

  spec() {
    return {
      toolSpec: {
        name: this.name,
        description: this.description,
        inputSchema: {
          json: JSON.stringify({
            $schema: "http://json-schema.org/draft-07/schema#",
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "The search query to look up on the web",
              },
            },
            required: ["query"],
          }),
        },
      },
    };
  }
}

ToolRunner.getToolRunner().registerTool(new WebSearchTool());
