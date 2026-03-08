import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ children }) {
    const { session, isLoading } = useAuth();

    if (isLoading) {
        return (
            <div className="full-page-loader">
                <div className="spinner" />
                <p>Initialising secure session…</p>
            </div>
        );
    }

    if (!session) {
        return <Navigate to="/login" replace />;
    }

    return children;
}
