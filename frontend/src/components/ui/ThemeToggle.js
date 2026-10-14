import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { applyTheme, currentTheme, readStoredTheme, storeTheme } from '../../services/theme';

/**
 * Switches between the light and dark themes and remembers the choice.
 * Until the reader chooses, the page follows the system setting, including
 * when it changes while the page is open.
 */
const ThemeToggle = ({ className }) => {
  const [theme, setTheme] = useState(currentTheme);

  useEffect(() => {
    if (readStoredTheme() || !window.matchMedia) return undefined;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const follow = (event) => setTheme(event.matches ? 'dark' : 'light');
    query.addEventListener?.('change', follow);
    return () => query.removeEventListener?.('change', follow);
  }, []);

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    storeTheme(next);
    setTheme(next);
  };

  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className={['ui-btn', 'ui-btn--ghost', 'ui-btn--md', 'ui-btn--icon-only', className].filter(Boolean).join(' ')}
      onClick={toggle}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
    >
      {theme === 'dark' ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
    </button>
  );
};

export default ThemeToggle;
