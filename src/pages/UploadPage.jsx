import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Papa from 'papaparse';
import toast from 'react-hot-toast';
import { useInference } from '../hooks/useInference';
import '../styles/UploadPage.css';

const MAX_FILE_MB = 50;

export default function UploadPage() {
    const navigate = useNavigate();
    const { status, progress, progressMessage, insights, error, runInference } = useInference();
    const [dragging, setDragging] = useState(false);
    const [fileName, setFileName] = useState('');
    const inputRef = useRef(null);

    // Navigate to dashboard when insights are ready
    if (status === 'done' && insights) {
        navigate('/dashboard', { state: { insights }, replace: true });
    }

    const processFile = useCallback(
        (file) => {
            if (!file) return;
            if (!file.name.endsWith('.csv')) {
                toast.error('Only CSV files are supported.');
                return;
            }
            const mb = file.size / 1024 / 1024;
            if (mb > MAX_FILE_MB) {
                toast.error(`File too large (${mb.toFixed(1)} MB). Max is ${MAX_FILE_MB} MB.`);
                return;
            }

            setFileName(file.name);

            Papa.parse(file, {
                header: true,
                skipEmptyLines: true,
                complete: (result) => {
                    if (!result.data.length) {
                        toast.error('CSV appears to be empty.');
                        return;
                    }
                    runInference({
                        rows: result.data,
                        columns: result.meta.fields || [],
                        fileName: file.name,
                        fileSize: file.size,
                    });
                },
                error: (err) => toast.error('Failed to parse CSV: ' + err.message),
            });
        },
        [runInference]
    );

    const onDrop = useCallback(
        (e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files[0];
            processFile(file);
        },
        [processFile]
    );

    return (
        <div className="upload-root">
            <div className="upload-blob blob-a" />
            <div className="upload-blob blob-b" />

            <div className="upload-container">
                <div className="upload-header">
                    <h2>Upload Patient Dataset</h2>
                    <p>
                        Your data <strong>never leaves your device</strong>. All analysis runs locally in the browser.
                    </p>
                </div>

                {status === 'idle' || status === 'error' ? (
                    <>
                        <div
                            className={`drop-zone ${dragging ? 'dragging' : ''}`}
                            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                            onDragLeave={() => setDragging(false)}
                            onDrop={onDrop}
                            onClick={() => inputRef.current?.click()}
                        >
                            <div className="drop-zone-icon">
                                <svg viewBox="0 0 64 64" fill="none">
                                    <rect x="4" y="4" width="56" height="56" rx="16" fill="rgba(14,165,233,0.08)" stroke="rgba(14,165,233,0.3)" strokeWidth="1.5" strokeDasharray="6 4" />
                                    <path d="M32 40V24M24 32l8-8 8 8" stroke="#0ea5e9" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                                    <path d="M20 44h24" stroke="#0ea5e9" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
                                </svg>
                            </div>
                            <p className="drop-label">Drag &amp; drop your CSV file here</p>
                            <p className="drop-sub">or <span className="drop-link">click to browse</span></p>
                            <p className="drop-hint">Supports CSV · Max {MAX_FILE_MB} MB</p>
                        </div>

                        <input
                            ref={inputRef}
                            type="file"
                            accept=".csv"
                            style={{ display: 'none' }}
                            onChange={(e) => processFile(e.target.files[0])}
                        />

                        {status === 'error' && (
                            <div className="upload-error">
                                <span>⚠️ Inference failed — please try again with a different file.</span>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="upload-loading">
                        <div className="loading-icon">🧠</div>
                        <h3>Analysing <span className="file-name">{fileName}</span></h3>
                        <p className="loading-label">{progressMessage || 'Initialising local AI…'}</p>

                        <div className="progress-bar-track">
                            <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
                        </div>
                        <p className="progress-pct">{progress}%</p>

                        <div className="privacy-badge">
                            🔒 Running entirely in your browser — zero network calls
                        </div>
                    </div>
                )}

                <div className="upload-features">
                    {[
                        { icon: '🔒', title: 'Zero Upload', desc: 'Data processed 100% client-side' },
                        { icon: '⚡', title: 'Instant Results', desc: 'ONNX-powered local inference engine' },
                        { icon: '📊', title: 'Rich Charts', desc: 'Bar, Line & Scatter visualisations' },
                    ].map((f) => (
                        <div key={f.title} className="feature-card">
                            <span className="feature-icon">{f.icon}</span>
                            <strong>{f.title}</strong>
                            <p>{f.desc}</p>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
