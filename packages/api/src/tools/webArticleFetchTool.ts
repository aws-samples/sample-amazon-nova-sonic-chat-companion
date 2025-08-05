import { Tool } from "./toolBase";
import { ToolRunner } from "./toolRunner";
import { JSDOM } from "jsdom";

export class WebArticleFetchTool implements Tool {
  public name = "webArticleFetchTool";
  public description =
    "webArticleFetchTool can be used to fetch the content of an article from a given URL. It extracts the text from the article tag of the webpage.";
  public answerInstructions =
    "Summarize the article content in a concise manner. Focus on the main points and key information. If the article is not found or there's an error, inform the user clearly.";

  async run(_params: object): Promise<unknown> {
    const params = _params as { url: string };
    try {
      if (!params.url) {
        return {
          error: "No URL provided",
        };
      }

      // Validate URL format
      try {
        new URL(params.url);
      } catch (e) {
        return {
          error: "Invalid URL format",
        };
      }

      // Fetch the webpage content
      const response = await fetch(params.url, {
        headers: {
          // Set a user agent to avoid being blocked by some websites
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        },
      });

      if (!response.ok) {
        throw new Error(
          `Failed to fetch URL: ${response.status} ${response.statusText}`
        );
      }

      const html = await response.text();

      // Parse the HTML using JSDOM
      const dom = new JSDOM(html);
      const document = dom.window.document;

      // Find the article element
      const articleElement = document.querySelector("article");

      if (!articleElement) {
        return {
          error: "No article tag found on the page",
          url: params.url,
          suggestion:
            "This page might not use the article tag for its content. Consider using a different tool to extract the content.",
        };
      }

      // Extract text content from the article
      const articleContent = articleElement.textContent?.trim();

      // Get the title if available
      const titleElement = document.querySelector("title");
      const title = titleElement
        ? titleElement.textContent?.trim()
        : "Unknown Title";

      // Get meta description if available
      const metaDescription = document.querySelector(
        'meta[name="description"]'
      );
      const description = metaDescription
        ? metaDescription.getAttribute("content")
        : "No description available";

      return {
        url: params.url,
        title,
        description,
        content: articleContent || "No content found in the article tag",
        answerInstructions: this.answerInstructions,
      };
    } catch (error) {
      console.error("Error in web article fetch tool:", error);
      return {
        error: `Failed to fetch article content: ${(error as Error).message}`,
        url: params.url,
        fallbackMessage:
          "I couldn't extract the article content from this URL. The page might be protected, require authentication, or use a different structure.",
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
              url: {
                type: "string",
                description:
                  "The URL of the webpage containing the article to fetch",
              },
            },
            required: ["url"],
          }),
        },
      },
    };
  }
}

// Register the tool with the ToolRunner
ToolRunner.getToolRunner().registerTool(new WebArticleFetchTool());
