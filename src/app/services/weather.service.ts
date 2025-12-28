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

@Injectable({
  providedIn: 'root'
})
export class WeatherService {
  private readonly API_URL = 'https://api.openweathermap.org/data/2.5/weather';
  
  weather = signal<WeatherData | null>(null);
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

    // Try to get user's location with timeout, or default to a city
    if (navigator.geolocation) {
      console.log('Attempting to get geolocation...');
      navigator.geolocation.getCurrentPosition(
        (position) => {
          console.log('Geolocation success:', position.coords.latitude, position.coords.longitude);
          this.fetchWeatherByCoords(position.coords.latitude, position.coords.longitude);
        },
        (error) => {
          // Fallback to default city if geolocation fails
          console.log('Geolocation failed, using default city:', error.message);
          this.fetchWeatherByCity(environment.defaultCity || 'Minneapolis');
        },
        {
          timeout: 5000, // 5 second timeout
          maximumAge: 300000, // Accept cached position up to 5 minutes old
          enableHighAccuracy: false // Faster, less battery
        }
      );
    } else {
      console.log('Geolocation not available, using default city');
      this.fetchWeatherByCity(environment.defaultCity || 'Minneapolis');
    }
  }

  private async fetchWeatherByCoords(lat: number, lon: number): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);

    try {
      const url = `${this.API_URL}?lat=${lat}&lon=${lon}&units=imperial&appid=${environment.weatherApiKey}`;
      console.log('Fetching weather by coordinates:', lat, lon);
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
    } catch (error: any) {
      console.error('Error fetching weather by coords:', error);
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
