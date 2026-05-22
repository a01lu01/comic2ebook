/**
 * Orchestrator — Job queue with concurrency control
 *
 * State machine:
 *   queued → packing → converting(subTask) → done
 *   any stage → failed / cancelled
 */
const packSvc = require('./pack');
const convertSvc = require('./convert');

function createJob({ comicId, comicName, folderPath, outputDir, formats, profile, calibrePath }) {
    return {
        jobId: require('crypto').randomUUID(),
        comicId, comicName, folderPath, outputDir, formats,
        profile: profile || 'recommended',
        calibrePath,
        status: 'queued',
        subTasks: formats.map(f => ({ format: f, status: 'pending', progress: 0 })),
        results: [],
        error: null,
        createdAt: Date.now(),
        startedAt: null,
        finishedAt: null,
    };
}

class Orchestrator {
    constructor(mainWindow, settings = {}) {
        this.win = mainWindow;
        this.queue = [];
        this.active = new Map();   // jobId → { job, proc }
        this.results = new Map();  // jobId → job (for retry)
        this.maxPacking = settings.packingConcurrency || 2;
        this.maxConverting = settings.convertConcurrency || 1;
    }

    updateSettings(settings) {
        this.maxPacking = settings.packingConcurrency || 2;
        this.maxConverting = settings.convertConcurrency || 1;
    }

    // ── Public API ──

    enqueue(jobs) {
        for (const j of jobs) {
            j.startedAt = Date.now();
            this.queue.push(j);
        }
        this._tick();
    }

    cancel(jobId) {
        const entry = this.active.get(jobId);
        if (!entry) return false;
        if (entry.proc) {
            try { entry.proc.kill(); } catch (_) { /* already dead */ }
        }
        entry.job.status = 'cancelled';
        entry.job.finishedAt = Date.now();
        this.active.delete(jobId);
        this._sendUpdate(entry.job);
        this._tick();
        return true;
    }

    retry(jobId) {
        const job = this.results.get(jobId);
        if (!job) return false;
        const newJob = createJob({
            comicId: job.comicId, comicName: job.comicName,
            folderPath: job.folderPath, outputDir: job.outputDir,
            formats: job.formats, profile: job.profile,
            calibrePath: job.calibrePath,
        });
        this.queue.push(newJob);
        this._tick();
        return newJob.jobId;
    }

    // ── Scheduling ──

    _tick() {
        this._tickPacking();
        this._tickConverting();
    }

    _tickPacking() {
        while (this._countByStage('packing') < this.maxPacking && this.queue.length > 0) {
            const job = this.queue.shift();
            if (!job.formats.includes('cbz')) {
                job.status = 'converting';
                this.active.set(job.jobId, { job, proc: null });
                this._sendUpdate(job);
                this._tickConverting();
                continue;
            }
            job.status = 'packing';
            this._sendUpdate(job);
            this._runPacking(job);
        }
    }

    _tickConverting() {
        while (true) {
            // Count currently running conversions
            const runningNow = [...this.active.values()].reduce((sum, e) =>
                sum + e.job.subTasks.filter(s => s.format !== 'cbz' && s.status === 'running').length, 0);
            if (runningNow >= this.maxConverting) break;

            // Helper: check if a job is ready for conversion
            const isReady = (job) => {
                if (job.subTasks.some(s => s.format !== 'cbz' && s.status === 'running')) return false;
                if (!job.subTasks.some(s => s.format !== 'cbz' && s.status === 'pending')) return false;
                if (job.formats.includes('cbz') && !job.results.some(r => r.format === 'cbz')) return false;
                return true;
            };

            let ready = null;
            let readySub = null;

            // Priority 1: continue the job that already started converting (has done conversions)
            for (const [, entry] of this.active) {
                const job = entry.job;
                if (!isReady(job)) continue;
                // Is this job mid-progress? (has some non-cbz subtask done/failed + still has pending)
                const hasCompleted = job.subTasks.some(s =>
                    s.format !== 'cbz' && (s.status === 'done' || s.status === 'failed'));
                if (!hasCompleted) continue;
                ready = entry;
                readySub = job.subTasks.find(s => s.format !== 'cbz' && s.status === 'pending');
                break;
            }

            // Priority 2: any ready job
            if (!ready) {
                for (const [, entry] of this.active) {
                    if (!isReady(entry.job)) continue;
                    ready = entry;
                    readySub = entry.job.subTasks.find(s => s.format !== 'cbz' && s.status === 'pending');
                    break;
                }
            }

            if (!ready) break;

            // Start conversion
            if (ready.job.status === 'packing') ready.job.status = 'converting';
            this._sendUpdate(ready.job);
            this._runConverting(ready.job, readySub);
        }
    }

    // ── Workers ──

    async _runPacking(job) {
        this.active.set(job.jobId, { job, proc: null });
        const cbzSub = job.subTasks.find(s => s.format === 'cbz');
        if (cbzSub) cbzSub.status = 'running';
        try {
            const result = await packSvc.packCBZ(job, (pct) => {
                if (cbzSub) cbzSub.progress = pct;
                this._sendUpdate(job);
            });
            if (cbzSub) { cbzSub.status = 'done'; cbzSub.progress = 100; }
            job.results.push(result);
            const hasMore = job.subTasks.some(s => s.format !== 'cbz' && s.status === 'pending');
            if (hasMore) {
                this._sendUpdate(job);
                this._tick();
            } else {
                job.status = 'done';
                job.finishedAt = Date.now();
                this.active.delete(job.jobId);
                this.results.set(job.jobId, job);
                this._sendResult(job);
                this._tick();
            }
        } catch (err) {
            job.status = 'failed';
            job.error = err.message;
            job.finishedAt = Date.now();
            if (cbzSub) cbzSub.status = 'failed';
            this.active.delete(job.jobId);
            this.results.set(job.jobId, job);
            this._sendUpdate(job);
            this._tick();
        }
    }

    async _runConverting(job, sub) {
        sub.status = 'running';
        this._sendUpdate(job);

        // Determine CBZ source path
        let cbzPath;
        if (job.formats.includes('cbz')) {
            const cbzResult = job.results.find(r => r.format === 'cbz');
            if (!cbzResult) {
                sub.status = 'failed';
                sub.error = 'CBZ 文件不存在';
                this._sendUpdate(job);
                this._tick();
                return;
            }
            cbzPath = cbzResult.path;
        } else {
            // No CBZ needed: use source folder images directly
            cbzPath = job.folderPath;
        }

        try {
            const { promise, proc } = await convertSvc.convert(
                job, sub.format, job.calibrePath, cbzPath,
                (data) => {
                    if (data.percent != null) sub.progress = data.percent;
                    this._sendUpdate(job);
                    if (data.chunk) {
                        if (this.win && !this.win.isDestroyed() && !this.win.webContents.isDestroyed()) {
                            this.win.webContents.send('job:log', {
                                jobId: job.jobId, chunk: data.chunk, isError: data.isError,
                            });
                        }
                    }
                }
            );

            const entry = this.active.get(job.jobId);
            if (entry) entry.proc = proc;

            // 10-minute timeout: kill hung Calibre process
            const TIMEOUT_MS = 10 * 60 * 1000;
            let result;
            try {
                result = await Promise.race([
                    promise,
                    new Promise((_, reject) => {
                        const tid = setTimeout(() => {
                            try { proc.kill(); } catch (_) {}
                            reject(new Error('转换超时 (10 分钟)'));
                        }, TIMEOUT_MS);
                        // Clean up timer if promise resolves first
                        promise.then(() => clearTimeout(tid), () => clearTimeout(tid));
                    }),
                ]);
            } catch (timeoutErr) {
                sub.status = 'failed';
                sub.error = timeoutErr.message;
                // Don't rethrow — handled below
            }

            if (sub.status === 'failed') {
                // Timed out — skip result processing
            } else if (!result.ok) {
                sub.status = 'failed';
                sub.error = `退出码 ${result.exitCode}`;
            } else {
                sub.status = 'done';
                sub.progress = 100;
                job.results.push({
                    format: sub.format, path: result.path,
                    renamed: result.renamed, logPath: result.logPath,
                });
            }
        } catch (err) {
            sub.status = 'failed';
            sub.error = err.message;
        }

        // Check if all subTasks done
        const allDone = job.subTasks.every(s => s.status !== 'pending' && s.status !== 'running');
        if (allDone) {
            job.status = job.subTasks.some(s => s.status === 'failed') ? 'failed' : 'done';
            job.finishedAt = Date.now();
            this.active.delete(job.jobId);
            this.results.set(job.jobId, job);
            this._sendResult(job);
        }
        this._sendUpdate(job);
        this._tick();
    }

    // ── IPC Events ──

    _sendUpdate(job) {
        if (this.win && !this.win.isDestroyed() && !this.win.webContents.isDestroyed()) {
            this.win.webContents.send('job:update', {
                jobId: job.jobId,
                status: job.status,
                comicName: job.comicName,
                subTasks: job.subTasks.map(s => ({
                    format: s.format, status: s.status,
                    progress: s.progress, error: s.error,
                })),
                error: job.error,
            });
        }
    }

    _sendResult(job) {
        if (this.win && !this.win.isDestroyed() && !this.win.webContents.isDestroyed()) {
            this.win.webContents.send('job:result', {
                jobId: job.jobId,
                comicName: job.comicName,
                status: job.status,
                results: job.results,
                error: job.error,
            });
        }
    }

    // ── Helpers ──

    _countByStage(stage) {
        return [...this.active.values()].filter(e => e.job.status === stage).length;
    }
}

module.exports = { Orchestrator, createJob };
