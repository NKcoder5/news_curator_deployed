import cx from './cx';

/**
 * A short status label. Tones follow the verdict palette (real, fake, partly,
 * misleading, unknown, info) plus neutral and accent, so an evidence tag and
 * the verdict it supports share a colour.
 */
const Badge = ({ tone = 'neutral', size = 'sm', icon: Icon, className, children, ...rest }) => (
  <span className={cx('ui-badge', `ui-badge--${tone}`, `ui-badge--${size}`, className)} {...rest}>
    {Icon && <Icon size={size === 'xs' ? 11 : 13} aria-hidden="true" />}
    {children}
  </span>
);

export default Badge;
