import { cloneElement, isValidElement, useId } from 'react';
import cx from './cx';

/**
 * A form field: visible label, optional hint, optional error, and the control
 * wired to all three (id, aria-describedby, aria-invalid) so nothing has to
 * be repeated at the call site.
 *
 * <Field label="Email" hint="We never share it"><input className="ui-input" type="email" /></Field>
 */
const Field = ({ label, hint, error, optional = false, className, children }) => {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const control = isValidElement(children)
    ? cloneElement(children, {
      id: children.props.id || id,
      'aria-describedby': [hintId, errorId].filter(Boolean).join(' ') || undefined,
      'aria-invalid': error ? true : undefined
    })
    : children;
  const controlId = isValidElement(children) ? children.props.id || id : id;

  return (
    <div className={cx('ui-field', error && 'has-error', className)}>
      <label className="ui-field__label" htmlFor={controlId}>
        {label}
        {optional && <span className="ui-field__optional"> (optional)</span>}
      </label>
      {hint && <p className="ui-field__hint" id={hintId}>{hint}</p>}
      {control}
      {error && <p className="ui-field__error" id={errorId}>{error}</p>}
    </div>
  );
};

export default Field;
