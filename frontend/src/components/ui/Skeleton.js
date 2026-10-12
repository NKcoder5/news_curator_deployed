import cx from './cx';

/**
 * A placeholder in the shape of what is loading. Skeletons are decorative
 * (aria-hidden); the region that contains them says it is busy and carries
 * the words a screen reader needs.
 */
export const Skeleton = ({ width = '100%', height = '1em', radius, className, style }) => (
  <span
    className={cx('ui-skeleton', className)}
    style={{ width, height, borderRadius: radius, ...style }}
    aria-hidden="true"
  />
);

/** A paragraph of skeleton lines, the last one shorter, like real text. */
export const SkeletonText = ({ lines = 3, className }) => (
  <span className={cx('ui-skeleton-text', className)} aria-hidden="true">
    {Array.from({ length: lines }, (_, i) => (
      <Skeleton key={i} height="0.8em" width={i === lines - 1 && lines > 1 ? '62%' : '100%'} />
    ))}
  </span>
);

/**
 * A loading region: skeleton content for the eye, one sentence for the ear.
 * @param {string} props.label - what is loading, read out once
 */
export const LoadingRegion = ({ label, className, children }) => (
  <div className={cx('ui-loading-region', className)} aria-busy="true" role="status">
    <span className="sr-only">{label}</span>
    {children}
  </div>
);

export default Skeleton;
