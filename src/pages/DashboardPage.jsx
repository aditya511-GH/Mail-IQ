import { useLocation, useNavigate } from 'react-router-dom';
import { useRef, useState, useCallback } from 'react';
import {
    BarChart, Bar, LineChart, Line, ScatterChart, Scatter,
    XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    ResponsiveContainer, ReferenceLine,
} from 'recharts';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabaseClient';
import { deriveKey, encrypt } from '../lib/crypto';
import { useAuth } from '../context/AuthContext';
import '../styles/DashboardPage.css';

// Custom chart tooltip
const ChartTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
        <div className="chart-tooltip">
            {label !== undefined && <p className="tooltip-label">{label}</p>}
            {payload.map((p, i) => (
                <p key={i} style={{ color: p.color }}>
                    {p.name}: <strong>{typeof p.value === 'number' ? p.value.toFixed(3) : p.value}</strong>
                </p>
            ))}
        </div>
    );
};

const COLORS = ['#0ea5e9', '#6366f1', '#10b981', '#f59e0b', '#ec4899'];

export default function DashboardPage() {
    const { state } = useLocation();
    const { user } = useAuth();
    const navigate = useNavigate();
    const dashRef = useRef(null);
    const [saving, setSaving] = useState(false);
    const [vanishing, setVanishing] = useState(false);

    const insights = state?.insights;
    if (!insights) {
        navigate('/upload', { replace: true });
        return null;
    }

    const { meta, columnStats, correlations, trendData, scatterData, topCorrelations, anomalies } = insights;
    const colNames = Object.keys(columnStats);

    // Bar chart data: mean per column
    const barData = colNames.slice(0, 10).map((col) => ({
        name: col.length > 14 ? col.slice(0, 14) + '…' : col,
        Mean: columnStats[col].mean,
        Max: columnStats[col].max,
        StdDev: columnStats[col].stdDev,
    }));

    // Line chart from trendData
    const primaryTrend = trendData[0];
    const lineData = primaryTrend?.values.slice(0, 150) ?? [];

    // ── Download PDF ──────────────────────────────────────────────────────────────────────────
    const handleDownload = useCallback(async () => {
        const toastId = toast.loading('Generating PDF…');
        try {
            const target = dashRef.current;

            // html2canvas options tuned for dark SVG charts
            const canvas = await html2canvas(target, {
                backgroundColor: '#060c1a',
                scale: 1.5,
                useCORS: true,
                allowTaint: true,
                logging: false,
                // Resolve CSS custom properties before capture
                onclone: (doc) => {
                    const styles = doc.createElement('style');
                    styles.textContent = `
                        * { font-family: Inter, system-ui, sans-serif !important; }
                        :root {
                            --bg-900:#060c1a;--surface:rgba(14,22,45,0.9);
                            --border:rgba(255,255,255,0.07);
                            --text-100:#f1f5f9;--text-300:#cbd5e1;
                            --text-500:#94a3b8;--text-700:#475569;
                            --blue:#0ea5e9;--indigo:#6366f1;
                            --emerald:#10b981;--amber:#f59e0b;--rose:#f43f5e;
                            --radius-lg:14px;--radius-md:10px;
                        }
                    `;
                    doc.head.appendChild(styles);
                },
            });

            const imgData = canvas.toDataURL('image/png');

            // A4 landscape in mm: 297 x 210
            const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
            const pageW = pdf.internal.pageSize.getWidth();   // 297 mm
            const pageH = pdf.internal.pageSize.getHeight();  // 210 mm

            // Scale canvas width to page width, then split vertically into pages
            const scale = pageW / canvas.width;
            const scaledH = canvas.height * scale;
            const totalPages = Math.ceil(scaledH / pageH);

            for (let page = 0; page < totalPages; page++) {
                if (page > 0) pdf.addPage();
                // Crop each slice from the canvas
                const sliceCanvas = document.createElement('canvas');
                sliceCanvas.width = canvas.width;
                const slicePixels = Math.round(pageH / scale);
                sliceCanvas.height = slicePixels;
                const ctx = sliceCanvas.getContext('2d');
                ctx.drawImage(canvas, 0, page * slicePixels, canvas.width, slicePixels, 0, 0, canvas.width, slicePixels);
                const sliceData = sliceCanvas.toDataURL('image/png');
                pdf.addImage(sliceData, 'PNG', 0, 0, pageW, pageH);
            }

            const fileName = `medai-insights-${meta.fileName?.replace('.csv', '') ?? Date.now()}.pdf`;

            // Use Blob URL → anchor click (universally reliable vs pdf.save())
            const pdfBlob = pdf.output('blob');
            const blobUrl = URL.createObjectURL(pdfBlob);
            const anchor = document.createElement('a');
            anchor.href = blobUrl;
            anchor.download = fileName;
            anchor.style.display = 'none';
            document.body.appendChild(anchor);
            anchor.click();
            document.body.removeChild(anchor);
            // Revoke after a short delay to allow the browser to start the download
            setTimeout(() => URL.revokeObjectURL(blobUrl), 3000);

            toast.success(`PDF saved (${totalPages} page${totalPages > 1 ? 's' : ''})!`, { id: toastId });

        } catch (err) {
            console.error('[PDF]', err);
            toast.error('PDF failed: ' + err.message, { id: toastId });
        }
    }, [meta]);

    // ── Save to Cloud ─────────────────────────────────────────────────────────────────────
    const handleSaveCloud = useCallback(async () => {
        if (!user) {
            toast.error('You must be signed in to save to cloud.');
            return;
        }
        setSaving(true);
        const toastId = toast.loading('Encrypting & uploading…');
        try {
            const key = await deriveKey(user.id);
            const { ciphertext, iv } = await encrypt(insights, key);
            const { error } = await supabase.from('insights').insert({
                user_id: user.id,
                encrypted_payload: ciphertext,
                iv,
            });
            if (error) {
                // 401 / PGRST301 = RLS / auth issue
                if (error.status === 401 || error.code === 'PGRST301' || error.message?.includes('JWT')) {
                    throw new Error(
                        'Session expired or invalid. Please sign out and sign in again with your real Supabase account to save to cloud.'
                    );
                }
                // 42P01 = table doesn’t exist
                if (error.code === '42P01') {
                    throw new Error(
                        'The "insights" table does not exist. Please run the SQL setup in your Supabase dashboard first.'
                    );
                }
                throw error;
            }
            toast.success('Saved to cloud! 🔐', { id: toastId });
        } catch (err) {
            console.error('[SaveCloud]', err);
            toast.error(err.message, { id: toastId, duration: 6000 });
        } finally {
            setSaving(false);
        }
    }, [user, insights]);

    // ── Vanish & End ────────────────────────────────────────────────────────────
    const handleVanish = useCallback(() => {
        setVanishing(true);
        toast('🌪️ Erasing all local data…', { icon: '💨', duration: 1500 });
        setTimeout(() => {
            // Clear all in-memory state by navigating away
            navigate('/upload', { replace: true, state: {} });
        }, 1600);
    }, [navigate]);

    return (
        <div className={`dashboard-root ${vanishing ? 'vanishing' : ''}`}>
            <div className="dashboard-scroll" ref={dashRef}>
                {/* ── Header ─────────────────────────────────────────────── */}
                <div className="dash-header">
                    <div>
                        <h2 className="dash-title">📊 AI Insights Dashboard</h2>
                        <p className="dash-subtitle">{meta.fileName} · {meta.rowCount.toLocaleString()} rows · {meta.columnCount} columns</p>
                    </div>
                    <div className="dash-actions">
                        <button className="action-btn download" onClick={handleDownload}>
                            <span>📥</span> Download PDF
                        </button>
                        <button className="action-btn cloud" onClick={handleSaveCloud} disabled={saving}>
                            <span>☁️</span> {saving ? 'Saving…' : 'Save to Cloud'}
                        </button>
                        <button className="action-btn vanish" onClick={handleVanish}>
                            <span>💣</span> Vanish & End
                        </button>
                    </div>
                </div>

                {/* ── Stats Cards ─────────────────────────────────────────── */}
                <div className="stats-grid">
                    {[
                        { icon: '🗂️', label: 'Total Rows', value: meta.rowCount.toLocaleString() },
                        { icon: '📋', label: 'Columns', value: meta.columnCount },
                        { icon: '🔢', label: 'Numeric Cols', value: meta.numericColumnCount },
                        { icon: '⚠️', label: 'Anomalies', value: anomalies.length },
                        {
                            icon: '🔗',
                            label: 'Top Correlation',
                            value: topCorrelations[0] ? `${topCorrelations[0].r}` : 'N/A',
                            sub: topCorrelations[0]?.pair?.replace(' × ', ' ↔ ') ?? '',
                        },
                        { icon: '🕒', label: 'Analysed At', value: new Date(meta.analysedAt).toLocaleTimeString() },
                        {
                            icon: meta.onnxActive ? '🤖' : '📐',
                            label: 'Inference Engine',
                            value: meta.onnxActive ? 'ONNX Model' : 'Stats Baseline',
                            sub: meta.modelVersion,
                        },
                    ].map((card) => (
                        <div key={card.label} className="stat-card">
                            <span className="stat-icon">{card.icon}</span>
                            <div>
                                <p className="stat-label">{card.label}</p>
                                <p className="stat-value">{card.value}</p>
                                {card.sub && <p className="stat-sub">{card.sub}</p>}
                            </div>
                        </div>
                    ))}
                </div>

                {/* ── Bar Chart ───────────────────────────────────────────── */}
                <div className="chart-card">
                    <h3 className="chart-title">📊 Column Statistics — Mean &amp; Max</h3>
                    <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={barData} margin={{ top: 10, right: 20, left: 0, bottom: 60 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                            <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} angle={-35} textAnchor="end" />
                            <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
                            <Tooltip content={<ChartTooltip />} />
                            <Legend wrapperStyle={{ color: '#94a3b8', paddingTop: 10 }} />
                            <Bar dataKey="Mean" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                            <Bar dataKey="Max" fill="#6366f1" radius={[4, 4, 0, 0]} />
                            <Bar dataKey="StdDev" fill="#10b981" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>

                {/* ── Line Chart ──────────────────────────────────────────── */}
                {primaryTrend && (
                    <div className="chart-card">
                        <h3 className="chart-title">📈 Row Trend — {primaryTrend.column}</h3>
                        <ResponsiveContainer width="100%" height={260}>
                            <LineChart data={lineData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                                <XAxis dataKey="index" tick={{ fill: '#94a3b8', fontSize: 11 }} label={{ value: 'Row', position: 'insideBottom', fill: '#64748b', dy: 12 }} />
                                <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
                                <Tooltip content={<ChartTooltip />} />
                                <ReferenceLine
                                    y={columnStats[primaryTrend.column]?.mean}
                                    stroke="#f59e0b"
                                    strokeDasharray="5 3"
                                    label={{ value: 'Mean', fill: '#f59e0b', fontSize: 11 }}
                                />
                                <Line
                                    type="monotone"
                                    dataKey="value"
                                    stroke="#0ea5e9"
                                    dot={false}
                                    strokeWidth={2}
                                    name={primaryTrend.column}
                                />
                                {trendData[1] && (
                                    <Line
                                        type="monotone"
                                        dataKey="value"
                                        data={trendData[1].values.slice(0, 150)}
                                        stroke="#6366f1"
                                        dot={false}
                                        strokeWidth={2}
                                        name={trendData[1].column}
                                    />
                                )}
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                )}

                {/* ── Scatter Plot ────────────────────────────────────────── */}
                {scatterData.length > 0 && colNames.length >= 2 && (
                    <div className="chart-card">
                        <h3 className="chart-title">
                            🔵 Scatter: {colNames[0]} vs {colNames[1]}
                        </h3>
                        <ResponsiveContainer width="100%" height={280}>
                            <ScatterChart margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                                <XAxis dataKey="x" name={colNames[0]} tick={{ fill: '#94a3b8', fontSize: 11 }} label={{ value: colNames[0], position: 'insideBottom', fill: '#64748b', dy: 12 }} />
                                <YAxis dataKey="y" name={colNames[1]} tick={{ fill: '#94a3b8', fontSize: 11 }} />
                                <Tooltip cursor={{ strokeDasharray: '3 3' }} content={<ChartTooltip />} />
                                <Scatter
                                    data={scatterData}
                                    fill="#6366f1"
                                    fillOpacity={0.7}
                                    name={`${colNames[0]} × ${colNames[1]}`}
                                />
                            </ScatterChart>
                        </ResponsiveContainer>
                    </div>
                )}

                {/* ── Correlation Table ────────────────────────────────────── */}
                {topCorrelations.length > 0 && (
                    <div className="chart-card">
                        <h3 className="chart-title">🔗 Top Feature Correlations</h3>
                        <div className="table-wrapper">
                            <table className="corr-table">
                                <thead>
                                    <tr>
                                        <th>Feature Pair</th>
                                        <th>Pearson r</th>
                                        <th>Strength</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {topCorrelations.map(({ pair, r }) => {
                                        const abs = Math.abs(r);
                                        const strength = abs > 0.7 ? 'Strong' : abs > 0.4 ? 'Moderate' : 'Weak';
                                        const color = abs > 0.7 ? '#10b981' : abs > 0.4 ? '#f59e0b' : '#94a3b8';
                                        return (
                                            <tr key={pair}>
                                                <td>{pair}</td>
                                                <td style={{ color }}>{r}</td>
                                                <td><span className="strength-badge" style={{ background: color + '22', color }}>{strength}</span></td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* ── Column Stats Table ───────────────────────────────────── */}
                <div className="chart-card">
                    <h3 className="chart-title">📋 Detailed Column Metrics</h3>
                    <div className="table-wrapper">
                        <table className="stats-table">
                            <thead>
                                <tr>
                                    <th>Column</th>
                                    <th>Mean</th>
                                    <th>Std Dev</th>
                                    <th>Min</th>
                                    <th>Max</th>
                                    <th>Missing</th>
                                </tr>
                            </thead>
                            <tbody>
                                {colNames.map((col) => {
                                    const s = columnStats[col];
                                    return (
                                        <tr key={col}>
                                            <td className="col-name">{col}</td>
                                            <td>{s.mean}</td>
                                            <td>{s.stdDev}</td>
                                            <td>{s.min}</td>
                                            <td>{s.max}</td>
                                            <td>{s.missing > 0 ? <span className="missing-badge">{s.missing}</span> : '—'}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>

                <p className="dash-watermark">
                    MedAI Insights · Local inference · AES-256-GCM encrypted cloud sync · {new Date(meta.analysedAt).toLocaleString()}
                </p>
            </div>
        </div>
    );
}
