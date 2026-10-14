import cx from './cx';

/**
 * A bordered surface. `variant`: default (white card), sunken (a well inside
 * a card), outline (no fill). `padding`: none | sm | md | lg.
 * `tone` tints the left edge for a card that belongs to one verdict.
 */
export const Card = ({ as: Component = 'div', variant = 'default', padding = 'md', tone, className, children, ...rest }) => (
  <Component
    className={cx('ui-card', `ui-card--${variant}`, `ui-card--pad-${padding}`, tone && `ui-card--tone-${tone}`, className)}
    {...rest}
  >
    {children}
  </Component>
);

/** Title row of a card: heading, optional description, actions on the right. */
export const CardHeader = ({ title, description, actions, icon: Icon, as: Heading = 'h2', id, className }) => (
  <div className={cx('ui-card__header', className)}>
    <div className="ui-card__heading">
      <Heading className="ui-card__title" id={id}>
        {Icon && <Icon size={18} aria-hidden="true" className="ui-card__icon" />}
        {title}
      </Heading>
      {description && <p className="ui-card__description">{description}</p>}
    </div>
    {actions && <div className="ui-card__actions">{actions}</div>}
  </div>
);

export default Card;
