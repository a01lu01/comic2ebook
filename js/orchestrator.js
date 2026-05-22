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
        comicId,
        comicName,
        folderPath,
        outputDir,
        formats,
        profile: profile || 'recommended',
        calibrePath,
        status: 'queued',
        subTasks: formats.map(f => ({
            format: f,
            status: 'pending',
            progress: 0,
        })),
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
        this.active = new Map();
        this.results = new Map(); // jobId → job (for retry)
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
            try { entry.proc.kill(); } catch (e) { /* already dead */ }
        }
        entry.job.status = 'cancelled';
        entry.job.finishedAt = Date.now();
        this.active.delete(jobId);
        this._sendUpdate(entry.job);
        this._tick(); // release slot for next job
        return true;
    }

    retry(jobId) {
        const job = this.results.get(jobId);
        if (!job) return false;
        const newJob = createJob({
            comicId: job.comicId,
            comicName: job.comicName,
            folderPath: job.folderPath,
            outputDir: job.outputDir,
            formats: job.formats,
            profile: job.profile,
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
                // No CBZ needed — add to active and let _tickConverting pick up
                job.status = 'converting';
                this.active.set(job.jobId, { job, proc: null });
                this._sendUpdate(job);
                this._tickConverting();
                return;
            }
            job.status = 'packing';
            this._sendUpdate(job);
            this._runPacking(job);
        }
    }

    _tickConverting() {
        while (this._countByStage('converting') < this.maxConverting) {
            // Find a job in active that has CBZ done and pending calibre formats
            const ready = [...this.active.values()].find(e => {
                const job = e.job;
                return job.status === 'packing' && // still in packing state = CBZ done
                       job.results.some(r => r.format === 'cbz') &&
                       job.subTasks.some(s => s.format !== 'cbz' && s.status === 'pending');
            }) || [...this.active.values()].find(e => {
                // Or a queued job with no CBZ format
                const job = e.job;
                return job.status === 'converting' &&
                       job.subTasks.some(s => s.format !== 'cbz' && s.status === 'pending');
            });
            if (!ready) break;
            const sub = ready.job.subTasks.find(s => s.format !== 'cbz' && s.status === 'pending');
            ready.job.status = 'converting';
            this._runConverting(ready.job, sub);
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

            if (cbzSub) {
                cbzSub.status = 'done';
                cbzSub.progress = 100;
            }
            job.results.push(result);

            const hasMoreFormats = job.subTasks.some(s => s.format !== 'cbz' && s.status === 'pending');
            if (hasMoreFormats) {
                // Stay in 'packing' status — _tickConverting will pick it up
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

        try {
            const { promise, proc } = await convertSvc.convert(
                job, sub.format, job.calibrePath,
                (data) => {
                    if (data.percent != null) sub.progress = data.percent;
                    this._sendUpdate(job);
                    if (data.chunk) {
                        this.win.webContents.send('job:log', { jobId: job.jobId, chunk: data.chunk, isError: data.isError });
                    }
                }
            );

            const entry = this.active.get(job.jobId);
            if (entry) entry.proc = proc;

            const result = await promise;

            if (!result.ok) {
                sub.status = 'failed';
                sub.error = `退出码 ${result.exitCode}`;
            } else {
                sub.status = 'done';
                sub.progress = 100;
                job.results.push({ format: sub.format, path: result.path, renamed: result.renamed, logPath: result.logPath });
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
        this.win.webContents.send('job:update', {
            jobId: job.jobId,
            status: job.status,
            comicName: job.comicName,
            subTasks: job.subTasks.map(s => ({ format: s.format, status: s.status, progress: s.progress, error: s.error })),
            error: job.error,
        });
    }

    _sendResult(job) {
        this.win.webContents.send('job:result', {
            jobId: job.jobId,
            comicName: job.comicName,
            status: job.status,
            results: job.results,
            error: job.error,
        });
    }

    // ── Helpers ──

    _countByStage(stage) {
        return [...this.active.values()].filter(e => e.job.status === stage).length;
    }
}

module.exports = { Orchestrator, createJob };
