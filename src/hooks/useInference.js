import { useState, useRef, useCallback } from 'react';

/**
 * useInference hook
 * Spawns the inference web worker, sends CSV data, and tracks progress.
 */
export function useInference() {
    const [status, setStatus] = useState('idle'); // idle | running | done | error
    const [progress, setProgress] = useState(0);
    const [progressMessage, setProgressMessage] = useState('');
    const [insights, setInsights] = useState(null);
    const [error, setError] = useState(null);
    const workerRef = useRef(null);

    const runInference = useCallback((csvData) => {
        // Terminate any existing worker
        if (workerRef.current) workerRef.current.terminate();

        setStatus('running');
        setProgress(0);
        setInsights(null);
        setError(null);

        const worker = new Worker(
            new URL('../workers/inferenceWorker.js', import.meta.url),
            { type: 'module' }
        );
        workerRef.current = worker;

        worker.onmessage = (e) => {
            const { type, value, message, insights: result } = e.data;

            if (type === 'progress') {
                setProgress(value);
                setProgressMessage(message);
            } else if (type === 'result') {
                setInsights(result);
                setStatus('done');
                worker.terminate();
            } else if (type === 'error') {
                setError(message);
                setStatus('error');
                worker.terminate();
            }
        };

        worker.onerror = (err) => {
            setError(err.message);
            setStatus('error');
        };

        worker.postMessage(csvData);
    }, []);

    function reset() {
        if (workerRef.current) workerRef.current.terminate();
        setStatus('idle');
        setProgress(0);
        setProgressMessage('');
        setInsights(null);
        setError(null);
    }

    return { status, progress, progressMessage, insights, error, runInference, reset };
}
