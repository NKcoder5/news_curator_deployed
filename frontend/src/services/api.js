import axios from 'axios';

const api = axios.create({
  baseURL: 'https://news-curator-deployed.onrender.com/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add a request interceptor
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
      console.log('Adding auth token to request:', config.url);
    } else {
      console.log('No auth token found for request:', config.url);
    }
    return config;
  },
  (error) => {
    console.error('Request interceptor error:', error);
    return Promise.reject(error);
  }
);

// Add a response interceptor
api.interceptors.response.use(
  (response) => {
    console.log('API response success:', response.config.url);
    return response;
  },
  (error) => {
    console.error('API response error:', error.config?.url, error.response?.status);
    console.error('Error details:', error.response?.data || error.message);
    
    if (error.response?.status === 401) {
      console.log('Unauthorized request, clearing token');
      // Clear token and redirect to login if unauthorized
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api; 