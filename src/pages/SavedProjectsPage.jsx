import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabaseClient';
import { deriveKey, decrypt } from '../lib/crypto';
import { useAuth } from '../context/AuthContext';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import '../styles/SavedProjectsPage.css';

export default function SavedProjectsPage() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [expanded, setExpanded] = useState(null);

    useEffect(() => {
        if (!user) return;
        loadProjects();
    }, [user]);

    async function loadProjects() {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('insights')
                .select('id, encrypted_payload, iv, created_at')
                .eq('user_id', user.id)
                .order('created_at', { ascending: false });

            if (error) throw error;

            const key = await deriveKey(user.id);

            const decrypted = await Promise.all(
                data.map(async (row) => {
                    try {
                        const insights = await decrypt(row.encrypted_payload, row.iv, key);
                        return { id: row.id, createdAt: row.created_at, insights, error: null };
                    } catch {
                        return { id: row.id, createdAt: row.created_at, insights: null, error: 'Decryption failed' };
                    }
                })
            );
            setProjects(decrypted);
        } catch (err) {
            toast.error('Failed to load projects: ' + err.message);
        } finally {
            setLoading(false);
        }
    }

    async function handleDelete(id) {
        const { error } = await supabase.from('insights').delete().eq('id', id);
        if (error) { toast.error('Delete failed'); return; }
        toast.success('Project deleted');
        setProjects((p) => p.filter((x) => x.id !== id));
    }

    function handleReopen(insights) {
        navigate('/dashboard', { state: { insights } });
    }

    return (
        <div className="saved-root">
            <div className="saved-header">
                <h2>📁 Saved Projects</h2>
                <p>{projects.length} encrypted insight{projects.length !== 1 ? 's' : ''} found</p>
            </div>

            {loading ? (
                <div className="saved-loading">
                    <div className="spinner" />
                    <p>Fetching &amp; decrypting…</p>
                </div>
            ) : projects.length === 0 ? (
                <div className="saved-empty">
                    <p>🔍 No saved projects yet.</p>
                    <button className="btn-primary" onClick={() => navigate('/upload')}>
                        Upload a Dataset
                    </button>
                </div>
            ) : (
                <div className="saved-grid">
                    {projects.map(({ id, createdAt, insights, error }) => {
                        const isExpanded = expanded === id;
                        const meta = insights?.meta;
                        const colNames = insights ? Object.keys(insights.columnStats) : [];
                        const miniBar = colNames.slice(0, 5).map((c) => ({
                            name: c.slice(0, 10),
                            mean: insights.columnStats[c].mean,
                        }));

                        return (
                            <div key={id} className={`saved-card ${isExpanded ? 'expanded' : ''}`}>
                                <div className="saved-card-header">
                                    <div className="saved-card-info">
                                        <h4>{meta?.fileName ?? 'Unknown File'}</h4>
                                        <span className="saved-date">
                                            {new Date(createdAt).toLocaleString()}
                                        </span>
                                        {meta && (
                                            <div className="saved-chips">
                                                <span className="chip">{meta.rowCount?.toLocaleString()} rows</span>
                                                <span className="chip">{meta.columnCount} cols</span>
                                                <span className="chip chip-secure">🔐 AES-256-GCM</span>
                                            </div>
                                        )}
                                        {error && <span className="saved-error">⚠️ {error}</span>}
                                    </div>
                                    <div className="saved-card-actions">
                                        {insights && (
                                            <>
                                                <button className="btn-sm" onClick={() => setExpanded(isExpanded ? null : id)}>
                                                    {isExpanded ? 'Collapse' : 'Preview'}
                                                </button>
                                                <button className="btn-sm btn-primary-sm" onClick={() => handleReopen(insights)}>
                                                    Open →
                                                </button>
                                            </>
                                        )}
                                        <button className="btn-sm btn-danger-sm" onClick={() => handleDelete(id)}>
                                            Delete
                                        </button>
                                    </div>
                                </div>

                                {isExpanded && insights && (
                                    <div className="saved-preview">
                                        <ResponsiveContainer width="100%" height={160}>
                                            <BarChart data={miniBar} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                                                <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                                                <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} />
                                                <Tooltip />
                                                <Bar dataKey="mean" fill="#0ea5e9" radius={[3, 3, 0, 0]} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                        {insights.topCorrelations?.length > 0 && (
                                            <div className="preview-corr">
                                                <strong>Top Correlation:</strong>{' '}
                                                <span>{insights.topCorrelations[0].pair} — r = {insights.topCorrelations[0].r}</span>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
