import { Link } from 'react-router-dom';
import { homePathFor, useAuth } from '../auth/AuthContext.jsx';
import { EmptyState } from '../components/States.jsx';

export default function NotFoundPage() {
  const { user } = useAuth();
  return (
    <EmptyState
      title="This page doesn't exist"
      action={
        <Link to={homePathFor(user)} className="button">
          Go to the start page
        </Link>
      }
    >
      Check the address, or use the links at the top.
    </EmptyState>
  );
}
