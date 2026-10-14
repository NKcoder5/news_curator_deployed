import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Button, EmptyState } from '../components/ui';
import useDocumentTitle from '../hooks/useDocumentTitle';

/**
 * A mistyped or out-of-date address. It used to redirect silently to the
 * landing page, which looked like the link had worked and gone somewhere odd.
 */
const NotFoundPage = ({ signedIn = false }) => {
  useDocumentTitle('Page not found');
  return (
    <div className="page page--narrow">
      <EmptyState
        icon={Compass}
        headingLevel="h1"
        title="That page does not exist"
        description="The address may be mistyped, or the page may have moved. Nothing has been lost: start from one of these."
        action={(
          <>
            <Button as={Link} to={signedIn ? '/check' : '/'}>{signedIn ? 'Check a claim' : 'Go to the home page'}</Button>
            {signedIn && <Button as={Link} to="/home?category=general" variant="secondary">Read the news</Button>}
          </>
        )}
      />
    </div>
  );
};

export default NotFoundPage;
