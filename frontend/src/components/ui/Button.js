import { forwardRef } from 'react';
import cx from './cx';

const ICON_SIZE = { sm: 14, md: 16, lg: 18 };

/**
 * The one button. Variants: primary (the page's main action — one per view),
 * secondary, ghost (toolbars, disclosures), danger. Pass `as={Link}` and `to`
 * to render a router link that looks like a button; the router is not
 * imported here so the component tests run without one.
 *
 * `loading` keeps the button's width, shows a spinner and disables it, so a
 * double click cannot send the same request twice.
 */
const Button = forwardRef(({
  as: Component = 'button',
  variant = 'primary',
  size = 'md',
  icon: Icon,
  iconRight: IconRight,
  loading = false,
  block = false,
  className,
  children,
  disabled,
  type,
  ...rest
}, ref) => {
  const isButton = Component === 'button';
  return (
    <Component
      ref={ref}
      className={cx('ui-btn', `ui-btn--${variant}`, `ui-btn--${size}`, block && 'ui-btn--block', !children && 'ui-btn--icon-only', className)}
      type={isButton ? type || 'button' : type}
      disabled={isButton ? disabled || loading : undefined}
      aria-disabled={!isButton && disabled ? true : undefined}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading
        ? <span className="ui-spinner" aria-hidden="true" />
        : Icon && <Icon size={ICON_SIZE[size]} aria-hidden="true" />}
      {children}
      {IconRight && <IconRight size={ICON_SIZE[size]} aria-hidden="true" />}
    </Component>
  );
});

Button.displayName = 'Button';

export default Button;
