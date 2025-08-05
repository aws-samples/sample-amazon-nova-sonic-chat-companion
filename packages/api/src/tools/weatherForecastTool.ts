import { DefaultToolSchema } from "../consts";
import { Tool } from "./toolBase";
import { ToolRunner } from "./toolRunner";
import "dotenv/config";

export class WeatherForecastTool implements Tool {
  name = "getWeatherForecastTool";
  answerInstructions =
    "Keep the answer short. Do not mention pressure but sunset or sunrise times depending on the time of the day." +
    "Do not consider decimal figures in numbers. When speaking about wind, mention the force not the speed. If not extreme, do not mention humidity." +
    "If the user does not explicitly ask for detailed information only mention temperature and general conditions.";
  description =
    "getWeatherForecastTool is a tool for getting weather forecast data for a location for the next 5 days with a 3hrs granularity from OpenWeather API";
  private apiKey: string = process.env.OPENWEATHER_API_KEY || "";
  private baseUrl: string = "https://api.openweathermap.org/data/2.5";

  public async run(input: object): Promise<object> {
    if (!this.apiKey) {
      return {
        error:
          "OpenWeather API key not found. Please set the OPENWEATHER_API_KEY environment variable.",
      };
    }
    console.log("weatherForecastTool", { input });
    try {
      // Parse input parameters

      const { city, units = "metric" } = input as {
        city: string;
        units: string;
      };

      if (!city) {
        return {
          error: "City parameter is required",
        };
      }

      // Fetch current weather data
      const weatherData = await this.fetchWeatherData(city, units);
      return {
        ...this.formatWeatherData(weatherData),
        answerInstructions: this.answerInstructions,
      };
    } catch (error) {
      console.error("Error fetching weather data:", error);
      return {
        error: `Failed to fetch weather data: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async fetchWeatherData(city: string, units: string): Promise<any> {
    const url = `${this.baseUrl}/forecast?q=${encodeURIComponent(city)}&units=${units}&appid=${this.apiKey}`;

    const response = await fetch(url);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenWeather API error: ${response.status} ${errorText}`);
    }

    return response.json();
  }

  private formatWeatherData(data: any): object {
    return {
      location: {
        city: data.city.name,
        country: data.city.country,
        coordinates: {
          latitude: data.city.coord.lat,
          longitude: data.city.coord.lon,
        },
      },
      forecast: data.list.map((x: any) => ({
        temp: x.main.temp,
        temp_feels_like: x.main.temp_feels_like,
        pressure: x.main.pressure,
        humidity: x.main.humidity,
        weather: x.weather[0].description,
        date_time: x.dt_txt,
      })),
    };
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
              city: {
                type: "string",
                description: "The city name to get weather forecast data for",
              },
              units: {
                type: "string",
                enum: ["metric", "imperial", "standard"],
                default: "metric",
                description:
                  "Units of measurement (metric, imperial, or standard)",
              },
            },
            required: ["city"],
          }),
        },
      },
    };
  }
}

// Register the tool with the ToolRunner
(() => ToolRunner.getToolRunner().registerTool(new WeatherForecastTool()))();
