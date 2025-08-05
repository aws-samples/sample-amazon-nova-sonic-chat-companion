import { Tool } from "./toolBase";
import { ToolRunner } from "./toolRunner";
import { parseString } from "xml2js";

export class LatestNewsTool implements Tool {
  public name = "latestNewsTool";
  public description =
    "latestNewsTool can be used to provide real-time news updates.";
  public answerInstructions =
    'Given the latest news items, summarize the titles and descriptions around the main topics. Start with a "In the news today, they talks about"';

  async run(_params: object): Promise<unknown> {
    const params = _params as { url: string };
    try {
      // Fetch the webpage content
      const r = await fetch(
        `https://content.guardianapis.com/search?api-key=${process.env["GUARDIAN_API_KEY"]}`
      );
      if (!r.ok) {
        throw new Error(`Failed to fetch URL: ${r.status} ${r.statusText}`);
      }
      const j = JSON.stringify(
        (await r.json()).response.results.map((i: any) => ({
          sectionName: i["sectionName"],
          title: i["webTitle"],
          webUrl: i["webUrl"],
          published: i["webPublicationDate"],
          pillar: i["pillarName"],
        }))
      );

      return { newsItems: j, answerInstructions: this.answerInstructions };
    } catch (error) {
      console.error("Error in latest news fetch tool:", error);
      return {
        error: `Failed to fetch latest news: ${(error as Error).message}`,
        fallbackMessage: "I couldn't get the latest news from The Guardian API",
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
            properties: {},
            required: [],
          }),
        },
      },
    };
  }
}

interface RssItem {
  title: string[];
  link: string[];
  description: string[];
}

interface RssChannel {
  item: RssItem[];
}

interface RssRoot {
  rss: {
    channel: RssChannel[];
  };
}

interface TransformedItem {
  title: string;
  link: string;
  description: string;
}

// Function to transform XML to JSON
function transformRssToJson(xmlData: string): Promise<TransformedItem[]> {
  return new Promise((resolve, reject) => {
    parseString(xmlData, (err, result: RssRoot) => {
      if (err) {
        reject(err);
        return;
      }

      try {
        const channel = result.rss.channel[0];
        const items = channel.item;

        const transformedItems: TransformedItem[] = items.map((item) => ({
          title: item.title[0].trim(),
          link: item.link[0],
          description: item.description[0],
        }));

        resolve(transformedItems);
      } catch (error) {
        reject(error);
      }
    });
  });
}

// Register the tool with the ToolRunner
ToolRunner.getToolRunner().registerTool(new LatestNewsTool());
