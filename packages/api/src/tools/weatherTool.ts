import { DefaultToolSchema } from "../consts";
import { Tool } from "./toolBase";
import { ToolRunner } from "./toolRunner";
import "dotenv/config";

export class WeatherTool implements Tool {
  name = "getWeatherTool";
  answerInstructions =
    "Keep the answer short. Do not mention pressure but sunset or sunrise times depending on the time of the day." +
    "Do not consider decimal figures in numbers. When speaking about wind, mention the force not the speed. If not extreme, do not mention humidity." +
    "If the user does not explicitly ask for detailed information only mention temperature and general conditions.";
  description =
    "getWeatherTool is a tool for getting current weather for a location from OpenWeather API";
  private apiKey: string = process.env.OPENWEATHER_API_KEY || "";
  private baseUrl: string = "https://api.openweathermap.org/data/2.5";

  public async run(input: object): Promise<object> {
    if (!this.apiKey) {
      return {
        error:
          "OpenWeather API key not found. Please set the OPENWEATHER_API_KEY environment variable.",
      };
    }
    console.log("weatherTool", { input });
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
    const url = `${this.baseUrl}/weather?q=${encodeURIComponent(city)}&units=${units}&appid=${this.apiKey}`;

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
        city: data.name,
        country: data.sys.country,
        coordinates: {
          latitude: data.coord.lat,
          longitude: data.coord.lon,
        },
      },
      weather: {
        condition: data.weather[0].main,
        description: data.weather[0].description,
        icon: data.weather[0].icon,
      },
      temperature: {
        current: data.main.temp,
        feelsLike: data.main.feels_like,
        min: data.main.temp_min,
        max: data.main.temp_max,
      },
      wind: {
        speed: data.wind.speed,
        direction: data.wind.deg,
      },
      humidity: data.main.humidity,
      pressure: data.main.pressure,
      visibility: data.visibility,
      timestamp: new Date(data.dt * 1000).toISOString(),
      sunrise: new Date(data.sys.sunrise * 1000).toISOString(),
      sunset: new Date(data.sys.sunset * 1000).toISOString(),
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
                description: "The city name to get weather data for",
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
(() => ToolRunner.getToolRunner().registerTool(new WeatherTool()))();
