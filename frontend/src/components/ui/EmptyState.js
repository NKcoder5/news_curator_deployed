import cx from './cx';

/**
 * What a region shows when there is nothing in it yet: what would be here,
 * and the one action that fills it.
 */
const EmptyState = ({ icon: Icon, title, description, action, headingLevel: Heading = 'h2', className, children }) => (
  <div className={cx('ui-empty', className)}>
    {Icon && (
      <span className="ui-empty__icon" aria-hidden="true">
        <Icon size={24} />
      </span>
    )}
    <Heading className="ui-empty__title">{title}</Heading>
    {description && <p className="ui-empty__description">{description}</p>}
    {children}
    {action && <div className="ui-empty__action">{action}</div>}
  </div>
);

export default EmptyState;
