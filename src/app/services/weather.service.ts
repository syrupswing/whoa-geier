import { Injectable, signal } from '@angular/core';
import { environment } from '../../environments/environment';

export interface WeatherData {
  temperature: number;
  feelsLike: number;
  conditions: string;
  description: string;
  precipitation: number;
  humidity: number;
  windSpeed: number;
  windDirection: number;
  icon: string;
  city: string;
  sunrise: Date;
  sunset: Date;
}

export interface ForecastPeriod {
  part: 'morning' | 'afternoon' | 'evening' | 'night';
  tempF: number;
  /** Chance of precipitation, 0-100. */
  pop: number;
  description: string;
}

/** What's still ahead today, from the 3-hour forecast — slots that have already ended are dropped. */
export interface RemainingForecast {
  periods: ForecastPeriod[];
  highF: number;
  lowF: number;
  maxPrecipChance: number;
}

@Injectable({
  providedIn: 'root'
})
export class WeatherService {
  private readonly API_URL = 'https://api.openweathermap.org/data/2.5/weather';
  private readonly FORECAST_URL = 'https://api.openweathermap.org/data/2.5/forecast';
  
  weather = signal<WeatherData | null>(null);
  forecast = signal<RemainingForecast | null>(null);
  /** When the current conditions were last successfully fetched. */
  lastUpdated = signal<Date | null>(null);
  isLoading = signal<boolean>(false);
  error = signal<string | null>(null);

  constructor() {
    console.log('WeatherService initialized');
    console.log('API configured:', this.isConfigured());
    console.log('API key:', environment.weatherApiKey ? 'Present' : 'Missing');
    this.loadWeather();
    // Refresh weather every 10 minutes
    setInterval(() => this.loadWeather(), 10 * 60 * 1000);
  }

  isConfigured(): boolean {
    return !!environment.weatherApiKey && environment.weatherApiKey !== 'YOUR_OPENWEATHER_API_KEY';
  }

  loadWeather(): void {
    console.log('loadWeather() called');
    
    if (!this.isConfigured()) {
      console.error('Weather service not configured - API key missing or invalid');
      this.error.set('Weather API not configured. Check environment.ts');
      return;
    }

    console.log('Weather service is configured, attempting to load weather...');

    // Default to Minneapolis zipcode 55410
    this.fetchWeatherByZipcode('55410');
    void this.fetchRemainingForecast('55410');
  }

  /** Loads the rest of today's forecast, refreshed alongside the current conditions so it never goes stale. */
  private async fetchRemainingForecast(zipcode: string): Promise<void> {
    try {
      const response = await fetch(`${this.FORECAST_URL}?zip=${zipcode},US&units=imperial&appid=${environment.weatherApiKey}`);
      if (!response.ok) return;
      const data = await response.json();

      const now = Date.now();
      const todayKey = new Date().toDateString();
      const partOf = (hour: number): ForecastPeriod['part'] =>
        hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 21 ? 'evening' : 'night';

      const slots = (data.list || [])
        .map((entry: any) => ({ start: new Date(entry.dt * 1000), entry }))
        // Each slot covers three hours from its timestamp; keep those still in progress or ahead, today only.
        .filter((s: any) => s.start.toDateString() === todayKey && s.start.getTime() + 3 * 3600_000 > now);
      if (!slots.length) {
        this.forecast.set(null);
        return;
      }

      const byPart = new Map<ForecastPeriod['part'], ForecastPeriod>();
      for (const { start, entry } of slots) {
        const part = partOf(start.getHours());
        const tempF = Math.round(entry.main.temp);
        const pop = Math.round((entry.pop || 0) * 100);
        const existing = byPart.get(part);
        if (!existing) {
          byPart.set(part, { part, tempF, pop, description: entry.weather?.[0]?.description || '' });
        } else {
          existing.tempF = Math.max(existing.tempF, tempF);
          existing.pop = Math.max(existing.pop, pop);
        }
      }

      const temps = slots.map((s: any) => Math.round(s.entry.main.temp));
      this.forecast.set({
        periods: Array.from(byPart.values()),
        highF: Math.max(...temps),
        lowF: Math.min(...temps),
        maxPrecipChance: Math.max(...slots.map((s: any) => Math.round((s.entry.pop || 0) * 100)))
      });
    } catch (error) {
      console.error('Error fetching forecast:', error);
    }
  }

  private async fetchWeatherByZipcode(zipcode: string): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);

    try {
      const url = `${this.API_URL}?zip=${zipcode},US&units=imperial&appid=${environment.weatherApiKey}`;
      console.log('Fetching weather for zipcode:', zipcode);
      const response = await fetch(url);

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Invalid API key. Please check your OpenWeatherMap API key.');
        }
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Weather API error: ${response.status}`);
      }

      const data = await response.json();
      console.log('Weather data received:', data);
      this.weather.set(this.parseWeatherData(data));
      this.lastUpdated.set(new Date());
    } catch (error: any) {
      console.error('Error fetching weather by zipcode:', error);
      this.error.set(error.message);
    } finally {
      this.isLoading.set(false);
    }
  }

  private async fetchWeatherByCity(city: string): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);

    try {
      const url = `${this.API_URL}?q=${city}&units=imperial&appid=${environment.weatherApiKey}`;
      console.log('Fetching weather for city:', city);
      const response = await fetch(url);

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Invalid API key. Please check your OpenWeatherMap API key.');
        }
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Weather API error: ${response.status}`);
      }

      const data = await response.json();
      console.log('Weather data received:', data);
      this.weather.set(this.parseWeatherData(data));
      this.lastUpdated.set(new Date());
    } catch (error: any) {
      console.error('Error fetching weather by city:', error);
      this.error.set(error.message);
    } finally {
      this.isLoading.set(false);
    }
  }

  private parseWeatherData(data: any): WeatherData {
    console.log('Parsing weather data:', data);
    
    const parsed = {
      temperature: Math.round(data.main.temp),
      feelsLike: Math.round(data.main.feels_like),
      conditions: data.weather[0].main,
      description: data.weather[0].description,
      precipitation: data.rain?.['1h'] || data.snow?.['1h'] || 0,
      humidity: data.main.humidity,
      windSpeed: Math.round(data.wind.speed),
      windDirection: data.wind.deg,
      icon: data.weather[0].icon,
      city: data.name,
      sunrise: new Date(data.sys.sunrise * 1000),
      sunset: new Date(data.sys.sunset * 1000)
    };
    
    console.log('Parsed weather data:', parsed);
    return parsed;
  }

  getWeatherConditionClass(): string {
    const weather = this.weather();
    if (!weather) return 'clear';

    const condition = weather.conditions.toLowerCase();
    if (condition.includes('rain')) return 'rainy';
    if (condition.includes('snow')) return 'snowy';
    if (condition.includes('cloud')) return 'cloudy';
    if (condition.includes('clear')) return 'clear';
    if (condition.includes('thunder')) return 'stormy';
    if (condition.includes('fog') || condition.includes('mist')) return 'foggy';
    
    return 'clear';
  }
}
