import { useEffect } from 'react';

export const SITE_NAME = 'Pure Press';

/**
 * Names the browser tab after the page, so a reader with six tabs open (and a
 * screen reader announcing the page on navigation) can tell which is which.
 * Every route used to be "Pure Press — Daily Intelligence".
 *
 * @param {string} [title] - the page's name; omitted, the tab shows the site alone
 */
const useDocumentTitle = (title) => {
  useEffect(() => {
    document.title = title ? `${title} · ${SITE_NAME}` : `${SITE_NAME} — evidence-based fact checking`;
  }, [title]);
};

export default useDocumentTitle;
