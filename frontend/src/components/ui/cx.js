/** Join class names, skipping empty ones: cx('a', on && 'b') → 'a b' or 'a'. */
const cx = (...names) => names.filter(Boolean).join(' ');

export default cx;
