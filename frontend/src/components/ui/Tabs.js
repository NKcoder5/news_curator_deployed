import { useRef } from 'react';
import cx from './cx';

/**
 * Tabs following the WAI-ARIA tabs pattern: one tab stop for the whole list,
 * arrow keys (and Home/End) move between tabs and select them, and each tab
 * names the panel it controls. Controlled: the parent owns `value`.
 *
 * @param {{id: string, label: string, icon?: Function}[]} props.tabs
 * @param {string}   props.value     - id of the selected tab
 * @param {Function} props.onChange  - called with the id of the tab chosen
 * @param {string}   props.label     - accessible name of the tab list
 * @param {string}   [props.idPrefix] - prefix for tab and panel ids
 */
export const Tabs = ({ tabs, value, onChange, label, idPrefix = 'tabs', className }) => {
  const refs = useRef([]);

  const focusTab = (index) => {
    const next = (index + tabs.length) % tabs.length;
    refs.current[next]?.focus();
    onChange(tabs[next].id);
  };

  const onKeyDown = (event, index) => {
    const moves = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 };
    if (!(event.key in moves)) return;
    event.preventDefault();
    focusTab(moves[event.key]);
  };

  return (
    <div className={cx('ui-tabs', className)} role="tablist" aria-label={label}>
      {tabs.map((tab, index) => {
        const selected = tab.id === value;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            ref={(el) => { refs.current[index] = el; }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            className={cx('ui-tab', selected && 'is-selected')}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {Icon && <Icon size={16} aria-hidden="true" />}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
};

/** The panel a tab controls. Render only the selected one. */
export const TabPanel = ({ id, idPrefix = 'tabs', className, children }) => (
  <div
    role="tabpanel"
    id={`${idPrefix}-panel-${id}`}
    aria-labelledby={`${idPrefix}-tab-${id}`}
    className={cx('ui-tabpanel', className)}
  >
    {children}
  </div>
);

export default Tabs;
