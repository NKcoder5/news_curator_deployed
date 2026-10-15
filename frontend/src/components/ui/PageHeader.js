import cx from './cx';

/**
 * The top of every page: a small overline naming the section, the page's one
 * h1, a sentence saying what the page is for, and the page-level actions.
 */
const PageHeader = ({ eyebrow, title, description, actions, className, children }) => (
  <header className={cx('ui-page-header', className)}>
    <div className="ui-page-header__text">
      {eyebrow && <p className="ui-page-header__eyebrow">{eyebrow}</p>}
      <h1 className="ui-page-header__title">{title}</h1>
      {description && <p className="ui-page-header__description">{description}</p>}
      {children}
    </div>
    {actions && <div className="ui-page-header__actions">{actions}</div>}
  </header>
);

export default PageHeader;
