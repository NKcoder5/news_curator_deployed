import React, { useState, useEffect } from 'react';
import './DashboardPage.css';

const DashboardPage = () => {
  const [currentDate, setCurrentDate] = useState('');
  
  useEffect(() => {
    const date = new Date();
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    setCurrentDate(date.toLocaleDateString('en-US', options));
  }, []);

  // Mock data for newspaper sections
  const headlines = [
    { id: 1, title: "System Update Successfully Deployed", excerpt: "The latest update brings improved performance and new features to all users.", category: "Tech" },
    { id: 2, title: "User Engagement Rises by 27%", excerpt: "Recent analytics show a significant increase in platform activity since last quarter.", category: "Analytics" },
    { id: 3, title: "New Feature Announcement", excerpt: "Exciting new capabilities will be rolling out to users next week.", category: "Features" }
  ];
  
  const sidebarNews = [
    { id: 1, title: "Maintenance Scheduled", time: "2 hours ago" },
    { id: 2, title: "Security Protocol Update", time: "Yesterday" },
    { id: 3, title: "New User Tutorial Available", time: "3 days ago" },
    { id: 4, title: "Community Milestone Reached", time: "1 week ago" }
  ];

  // Dashboard-related emojis for floating background
  const dashboardEmojis = ['📊', '📈', '📉', '📱', '💻', '⚙️', '🔍', '📡'];

  return (
    <div className="dashboard-newspaper">
      {/* Floating emoji container */}
      <div className="floating-emoji-container">
        {dashboardEmojis.map((emoji, index) => (
          <div key={index} className="floating-emoji">
            {emoji}
          </div>
        ))}
      </div>
      
      <div className="newspaper-header">
        <div className="newspaper-name">THE DASHBOARD GAZETTE</div>
        <div className="newspaper-date">{currentDate}</div>
        <div className="newspaper-motto">"All The Updates That Are Fit To Print"</div>
      </div>
      
      <div className="main-headline">
        <h1>Welcome to Your Dashboard</h1>
        <h2 className="subheading">Your daily digest of important information and updates</h2>
      </div>
      
      <div className="newspaper-content">
        <div className="main-column">
          <div className="lead-story">
            <h2>DAILY BRIEFING</h2>
            <p className="lead-paragraph">
              All systems are operating normally. The platform has been stable for the past 24 hours with
              no reported issues. User activity remains consistent with expected patterns for this time period.
            </p>
            <div className="story-image"></div>
            <p>
              Continued monitoring shows positive trends across all key performance indicators.
              Administrators are advised to review the latest analytics report for detailed metrics.
            </p>
          </div>
          
          <div className="news-grid">
            {headlines.map(item => (
              <div key={item.id} className="news-item">
                <span className="category-label">{item.category}</span>
                <h3>{item.title}</h3>
                <p>{item.excerpt}</p>
                <span className="read-more">Read more...</span>
              </div>
            ))}
          </div>
        </div>
        
        <div className="sidebar">
          <div className="sidebar-section">
            <h3 className="sidebar-heading">LATEST UPDATES</h3>
            {sidebarNews.map(item => (
              <div key={item.id} className="sidebar-news-item">
                <h4>{item.title}</h4>
                <span className="news-timestamp">{item.time}</span>
              </div>
            ))}
          </div>
          
          <div className="sidebar-section weather">
            <h3 className="sidebar-heading">SYSTEM STATUS</h3>
            <div className="status-indicator">
              <span className="status-dot online"></span>
              <span className="status-text">All Systems Online</span>
            </div>
            <div className="status-metrics">
              <div className="metric">
                <span className="metric-label">Server Load</span>
                <span className="metric-value">23%</span>
              </div>
              <div className="metric">
                <span className="metric-label">Memory Usage</span>
                <span className="metric-value">42%</span>
              </div>
              <div className="metric">
                <span className="metric-label">Storage</span>
                <span className="metric-value">67%</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div className="newspaper-footer">
        <span>Dashboard Gazette • Volume 1, Issue 12 • Copyright © 2025</span>
      </div>
    </div>
  );
};

export default DashboardPage;