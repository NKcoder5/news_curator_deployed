import { forwardRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

/**
 * A password field with a show/hide button. The button names what it will do
 * ("Show password"), and the field keeps the props Field wires onto it.
 */
const PasswordInput = forwardRef((props, ref) => {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-input">
      <input ref={ref} {...props} type={visible ? 'text' : 'password'} className="ui-input password-input__field" />
      <button
        type="button"
        className="password-input__toggle"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
      >
        {visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
      </button>
    </div>
  );
});

PasswordInput.displayName = 'PasswordInput';

export default PasswordInput;
