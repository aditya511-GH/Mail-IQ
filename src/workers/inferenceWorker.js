/**
 * Inference Web Worker
 * -------------------------------------------------------------------
 * This worker runs entirely off the main thread.
 *
 * Execution order:
 *   1. Build numeric data matrix from CSV rows.
 *   2. Attempt ONNX Runtime Web inference (model.onnx in /public/models/).
 *      → On success, raw tensor output stored in insights.onnxRawOutput.
 *      → On failure (missing model, shape mismatch, etc.) falls back silently.
 *   3. Always run the statistical engine for structured chart data.
 *      (mean, std-dev, Pearson correlations, Z-score anomaly detection)
 */

// ──────────────────────────────────────────────────────────────────────────────
// ONNX Runtime Web — Active
// Drop /public/models/model.onnx to enable real inference.
// ──────────────────────────────────────────────────────────────────────────────
import * as ort from 'onnxruntime-web';

async function runOnnxInference(numericData, columnNames) {
    try {
        const session = await ort.InferenceSession.create('/models/model.onnx', {
            executionProviders: ['wasm'],
            graphOptimizationLevel: 'all',
        });

        // Build input tensor — shape: [rows, columns]
        const flat = numericData.flat();
        const tensor = new ort.Tensor('float32', Float32Array.from(flat), [
            numericData.length,
            columnNames.length,
        ]);

        const results = await session.run({ input: tensor });
        return results.output.data; // model-specific output
    } catch (err) {
        console.warn('[Worker] ONNX model not available, using stats baseline:', err.message);
        return null;
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Statistical Inference Engine (functional baseline)
// ──────────────────────────────────────────────────────────────────────────────

function colStats(values) {
    const nums = values.filter((v) => !isNaN(v) && v !== null && v !== '');
    if (nums.length === 0) return { mean: 0, min: 0, max: 0, stdDev: 0, missing: values.length };

    const mean = nums.reduce((s, v) => s + v, 0) / nums.length;
    const variance = nums.reduce((s, v) => s + (v - mean) ** 2, 0) / nums.length;

    return {
        mean: parseFloat(mean.toFixed(4)),
        min: parseFloat(Math.min(...nums).toFixed(4)),
        max: parseFloat(Math.max(...nums).toFixed(4)),
        stdDev: parseFloat(Math.sqrt(variance).toFixed(4)),
        missing: values.length - nums.length,
        count: nums.length,
    };
}

function pearsonCorrelation(x, y) {
    const n = Math.min(x.length, y.length);
    if (n < 2) return 0;
    const mx = x.slice(0, n).reduce((a, b) => a + b, 0) / n;
    const my = y.slice(0, n).reduce((a, b) => a + b, 0) / n;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) {
        num += (x[i] - mx) * (y[i] - my);
        dx += (x[i] - mx) ** 2;
        dy += (y[i] - my) ** 2;
    }
    const denom = Math.sqrt(dx * dy);
    return denom === 0 ? 0 : parseFloat((num / denom).toFixed(4));
}

function detectAnomalies(values, mean, stdDev) {
    return values
        .map((v, i) => ({ index: i, value: v, zScore: Math.abs((v - mean) / (stdDev || 1)) }))
        .filter((r) => r.zScore > 3)
        .slice(0, 20);
}

// ──────────────────────────────────────────────────────────────────────────────
// Main message handler
// ──────────────────────────────────────────────────────────────────────────────

self.onmessage = async (e) => {
    const { rows, columns, fileName, fileSize } = e.data;

    try {
        self.postMessage({ type: 'progress', value: 10, message: 'Parsing columns…' });

        // Identify numeric columns & build matrix
        const numericCols = {};
        columns.forEach((col) => {
            const vals = rows.map((r) => parseFloat(r[col]));
            if (vals.some((v) => !isNaN(v))) numericCols[col] = vals;
        });

        const numColNames = Object.keys(numericCols);

        // ── ONNX Inference (runs first, non-blocking fallback) ────────────────
        self.postMessage({ type: 'progress', value: 20, message: 'Loading ONNX model…' });
        // Build numeric matrix [rows × cols] for the tensor
        const numericMatrix = rows.map((row) =>
            numColNames.map((col) => (isNaN(parseFloat(row[col])) ? 0 : parseFloat(row[col])))
        );
        const onnxResult = await runOnnxInference(numericMatrix, numColNames);
        const modelVersion = onnxResult ? 'onnx-model-v1' : 'stats-baseline-v1';
        if (onnxResult) {
            self.postMessage({ type: 'progress', value: 35, message: 'ONNX inference complete ✓' });
        } else {
            self.postMessage({ type: 'progress', value: 30, message: 'Computing statistics…' });
        }

        // Per-column statistics (always computed — used by all charts)
        const columnStats = {};
        Object.entries(numericCols).forEach(([col, vals]) => {
            columnStats[col] = colStats(vals);
        });

        self.postMessage({ type: 'progress', value: 55, message: 'Analysing correlations…' });

        // Pairwise correlations (first 8 numeric cols max for performance)
        const corrColNames = numColNames.slice(0, 8);
        const correlations = {};
        for (let i = 0; i < corrColNames.length; i++) {
            for (let j = i + 1; j < corrColNames.length; j++) {
                const key = `${corrColNames[i]} × ${corrColNames[j]}`;
                correlations[key] = pearsonCorrelation(
                    numericCols[corrColNames[i]],
                    numericCols[corrColNames[j]]
                );
            }
        }

        self.postMessage({ type: 'progress', value: 75, message: 'Detecting anomalies…' });

        // Anomaly detection on first numeric col
        const firstCol = corrColNames[0];
        const anomalies = firstCol
            ? detectAnomalies(
                numericCols[firstCol],
                columnStats[firstCol].mean,
                columnStats[firstCol].stdDev
            )
            : [];

        self.postMessage({ type: 'progress', value: 90, message: 'Finalising insights…' });

        // Row-level trend data (for line chart) — sample max 200 rows
        const step = Math.max(1, Math.floor(rows.length / 200));
        const trendData = corrColNames.slice(0, 3).map((col) => ({
            column: col,
            values: numericCols[col]
                .filter((_, i) => i % step === 0)
                .map((v, i) => ({ index: i * step, value: v })),
        }));

        // Scatter data for first two numeric cols
        const scatterData =
            corrColNames.length >= 2
                ? numericCols[corrColNames[0]]
                    .slice(0, 300)
                    .map((v, i) => ({ x: v, y: numericCols[corrColNames[1]][i] ?? 0 }))
                : [];

        const insights = {
            meta: {
                fileName,
                fileSize,
                rowCount: rows.length,
                columnCount: columns.length,
                numericColumnCount: numColNames.length,
                analysedAt: new Date().toISOString(),
                modelVersion,
                onnxActive: !!onnxResult,
            },
            // Raw ONNX tensor output (Float32Array → Array) — null if model not loaded
            onnxRawOutput: onnxResult ? Array.from(onnxResult) : null,
            columnStats,
            correlations,
            anomalies,
            trendData,
            scatterData,
            topCorrelations: Object.entries(correlations)
                .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
                .slice(0, 5)
                .map(([pair, r]) => ({ pair, r })),
        };

        self.postMessage({ type: 'progress', value: 100, message: 'Done!' });
        self.postMessage({ type: 'result', insights });
    } catch (err) {
        self.postMessage({ type: 'error', message: err.message });
    }
};
