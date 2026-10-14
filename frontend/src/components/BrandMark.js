import { ShieldCheck } from 'lucide-react';

/** The Pure Press mark and name. The mark alone is decorative; the name is the text. */
const BrandMark = ({ showName = true, size = 32 }) => (
  <span className="brand">
    <span className="brand__mark" style={{ width: size, height: size }} aria-hidden="true">
      <ShieldCheck size={Math.round(size * 0.6)} strokeWidth={2.25} />
    </span>
    {showName && <span className="brand__name">Pure Press</span>}
  </span>
);

export default BrandMark;
