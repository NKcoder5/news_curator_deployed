import { CircleCheck, CircleX, Info, TriangleAlert, X } from 'lucide-react';
import cx from './cx';

const ICONS = { info: Info, success: CircleCheck, warning: TriangleAlert, danger: CircleX };

/**
 * A message about the page itself — a failure, a warning, a note — as
 * opposed to a finding about the claim. Danger and warning interrupt a screen
 * reader (role="alert"); info and success wait their turn (role="status").
 */
const Alert = ({ tone = 'info', title, onDismiss, action, className, children }) => {
  const Icon = ICONS[tone] || Info;
  const urgent = tone === 'danger' || tone === 'warning';
  return (
    <div className={cx('ui-alert', `ui-alert--${tone}`, className)} role={urgent ? 'alert' : 'status'}>
      <Icon className="ui-alert__icon" size={18} aria-hidden="true" />
      <div className="ui-alert__body">
        {title && <p className="ui-alert__title">{title}</p>}
        {children && <div className="ui-alert__text">{children}</div>}
        {action && <div className="ui-alert__action">{action}</div>}
      </div>
      {onDismiss && (
        <button type="button" className="ui-alert__dismiss" onClick={onDismiss} aria-label="Dismiss message">
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
};

export default Alert;
