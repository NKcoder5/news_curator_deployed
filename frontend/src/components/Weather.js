import React, { useState, useEffect } from 'react';
import { getWeatherByCity, getWeatherByCoordinates, getLocation } from '../services/weatherService';
import '../styles/Weather.css';

const Weather = () => {
  const [weather, setWeather] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showPermissionRequest, setShowPermissionRequest] = useState(false);
  const [defaultCity] = useState('Perundurai');

  const fetchWeather = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // First try to get weather by location
      try {
        const location = await getLocation();
        const weatherData = await getWeatherByCoordinates(location.latitude, location.longitude);
        setWeather(weatherData);
      } catch (locationError) {
        // If location access is denied, fall back to default city
        console.log('Location access denied, falling back to default city:', defaultCity);
        const weatherData = await getWeatherByCity(defaultCity);
        setWeather(weatherData);
      }
    } catch (err) {
      setError(err.message);
      if (err.message.includes('enable location access')) {
        setShowPermissionRequest(true);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWeather();
  }, []);

  const handleRetry = () => {
    setShowPermissionRequest(false);
    setError(null);
    setLoading(true);
    // Try to get weather for default city
    getWeatherByCity(defaultCity)
      .then(weatherData => {
        setWeather(weatherData);
        setLoading(false);
      })
      .catch(err => {
        setError('Failed to fetch weather data. Please try again later.');
        setLoading(false);
      });
  };

  if (loading) return <div className="weather-loading">Loading weather...</div>;
  
  if (error) {
    return (
      <div className="weather-error">
        {error}
        {showPermissionRequest && (
          <button onClick={handleRetry} className="weather-retry-btn">
            Show Weather for {defaultCity}
          </button>
        )}
      </div>
    );
  }

  if (!weather) return null;

  return (
    <div className="weather-container">
      <div className="weather-info">
        <span className="weather-location">{weather.name}</span>
        <span className="weather-temp">{Math.round(weather.main.temp)}°C</span>
        <img 
          src={`https://openweathermap.org/img/wn/${weather.weather[0].icon}@2x.png`} 
          alt={weather.weather[0].description}
          className="weather-icon"
        />
      </div>
    </div>
  );
};

export default Weather; 