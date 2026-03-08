import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import '../styles/Sidebar.css';

const NAV = [
    { to: '/upload', icon: '⬆️', label: 'Upload Dataset' },
    { to: '/saved', icon: '📁', label: 'Saved Projects' },
];

export default function Sidebar() {
    const { user, signOut } = useAuth();
    const navigate = useNavigate();
    const [collapsed, setCollapsed] = useState(false);

    async function handleSignOut() {
        await signOut();
        toast('Signed out', { icon: '👋' });
        navigate('/login', { replace: true });
    }

    return (
        <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
            {/* Brand */}
            <div className="sidebar-brand">
                <div className="brand-logo">
                    <svg viewBox="0 0 32 32" fill="none">
                        <rect width="32" height="32" rx="9" fill="url(#sb-grad)" />
                        <path d="M16 7v18M7 16h18" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
                        <defs>
                            <linearGradient id="sb-grad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
                                <stop stopColor="#0ea5e9" /><stop offset="1" stopColor="#6366f1" />
                            </linearGradient>
                        </defs>
                    </svg>
                </div>
                {!collapsed && <span className="brand-name">MedAI</span>}
                <button className="collapse-btn" onClick={() => setCollapsed(!collapsed)}>
                    {collapsed ? '›' : '‹'}
                </button>
            </div>

            {/* Navigation */}
            <nav className="sidebar-nav">
                {NAV.map((item) => (
                    <NavLink
                        key={item.to}
                        to={item.to}
                        className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                    >
                        <span className="nav-icon">{item.icon}</span>
                        {!collapsed && <span className="nav-label">{item.label}</span>}
                    </NavLink>
                ))}
            </nav>

            {/* User footer */}
            <div className="sidebar-footer">
                <div className="user-avatar">
                    {user?.email?.[0]?.toUpperCase() ?? user?.phone?.[1] ?? '?'}
                </div>
                {!collapsed && (
                    <div className="user-info">
                        <p className="user-id">{user?.email ?? user?.phone ?? 'User'}</p>
                        <p className="user-role">Hospital Staff</p>
                    </div>
                )}
                <button className="signout-btn" onClick={handleSignOut} title="Sign Out">
                    {collapsed ? '⏏' : '↩ Sign Out'}
                </button>
            </div>
        </aside>
    );
}
