use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter};

use crate::{
    api::{ApiError, AppError},
    convert::{self, ConvertProgress},
    logs,
    models::{
        Job, JobInput, JobLogPayload, JobResult, JobResultPayload, JobStatus, JobUpdatePayload,
        SubTaskStatus,
    },
    pack,
    settings::{ConversionProfile, Settings},
};

type Inner = Arc<Mutex<JobManagerInner>>;

pub struct JobManager {
    inner: Inner,
    app: AppHandle,
}

impl Clone for JobManager {
    fn clone(&self) -> Self {
        Self {
            inner: self.inner.clone(),
            app: self.app.clone(),
        }
    }
}

struct ActiveJob {
    job: Job,
    cancel: Arc<AtomicBool>,
}

struct JobManagerInner {
    queue: VecDeque<Job>,
    active: HashMap<String, ActiveJob>,
    results: HashMap<String, Job>,
    max_packing: usize,
    max_converting: usize,
}

impl JobManager {
    pub fn new(app: AppHandle, settings: &Settings) -> Self {
        Self {
            inner: Arc::new(Mutex::new(JobManagerInner {
                queue: VecDeque::new(),
                active: HashMap::new(),
                results: HashMap::new(),
                max_packing: settings.packing_concurrency.max(1) as usize,
                max_converting: settings.convert_concurrency.max(1) as usize,
            })),
            app,
        }
    }

    pub fn update_settings(&self, settings: &Settings) {
        let mut g = self.inner.lock().unwrap();
        g.max_packing = settings.packing_concurrency.max(1) as usize;
        g.max_converting = settings.convert_concurrency.max(1) as usize;
    }

    pub fn enqueue(
        &self,
        inputs: Vec<JobInput>,
        settings: &Settings,
        calibre_path: Option<String>,
    ) -> Result<Vec<String>, ApiError> {
        let profile = match settings.profile {
            ConversionProfile::Recommended => "recommended",
            ConversionProfile::Compatible => "compatible",
        }
        .to_string();
        let mut ids = Vec::new();
        {
            let mut g = self.inner.lock().unwrap();
            for input in inputs {
                let mut job = Job::new(
                    input,
                    profile.clone(),
                    calibre_path.clone(),
                    settings.overwrite_policy.clone(),
                    600,
                    settings.keep_logs,
                );
                job.rebuild_sub_tasks();
                ids.push(job.job_id.clone());
                g.queue.push_back(job);
            }
        }
        self.tick();
        Ok(ids)
    }

    pub fn cancel(&self, job_id: &str) -> Result<(), ApiError> {
        let finished: Option<Job> = {
            let mut g = self.inner.lock().unwrap();
            let Some(active) = g.active.remove(job_id) else {
                return Err(AppError::custom("E_JOB_NOT_ACTIVE", "任务不在运行中").into());
            };
            active.cancel.store(true, Ordering::Relaxed);
            let mut job = active.job;
            job.status = JobStatus::Cancelled;
            job.error = Some("已取消".into());
            job.finished_at = Some(now_ms());
            g.results.insert(job_id.to_string(), job.clone());
            Some(job)
        };
        if let Some(job) = finished {
            self.emit_update(&job);
            self.emit_result(&job);
            self.tick();
        }
        Ok(())
    }

    pub fn clear_all(&self) -> usize {
        let mut finished: Vec<Job> = Vec::new();
        {
            let mut g = self.inner.lock().unwrap();
            g.queue.clear();
            let drained: Vec<(String, ActiveJob)> = g.active.drain().collect();
            for (id, active) in drained {
                active.cancel.store(true, Ordering::Relaxed);
                let mut job = active.job;
                job.status = JobStatus::Cancelled;
                job.error = Some("已取消".into());
                job.finished_at = Some(now_ms());
                g.results.insert(id, job.clone());
                finished.push(job);
            }
        }
        let count = finished.len();
        for job in finished {
            self.emit_update(&job);
            self.emit_result(&job);
        }
        count
    }

    pub fn retry(&self, job_id: &str) -> Result<String, ApiError> {
        let old = self
            .inner
            .lock()
            .unwrap()
            .results
            .get(job_id)
            .cloned()
            .ok_or_else(|| AppError::custom("E_JOB_NOT_FOUND", "找不到任务记录"))?;
        let input = JobInput {
            comic_id: old.comic_id.clone(),
            comic_name: old.comic_name.clone(),
            folder_path: old.folder_path.clone(),
            output_dir: old.output_dir.clone(),
            formats: old.formats.clone(),
        };
        let mut job = Job::new(
            input,
            old.profile.clone(),
            old.calibre_path.clone(),
            old.overwrite_policy.clone(),
            old.timeout_secs,
            old.keep_logs,
        );
        job.rebuild_sub_tasks();
        let new_id = job.job_id.clone();
        {
            let mut g = self.inner.lock().unwrap();
            g.queue.push_back(job);
        }
        self.tick();
        Ok(new_id)
    }

    fn tick(&self) {
        loop {
            let next = {
                let mut g = self.inner.lock().unwrap();
                if g.packing_count() >= g.max_packing {
                    None
                } else {
                    g.take_next_packing()
                }
            };
            match next {
                Some(job) => self.spawn_packing(job),
                None => break,
            }
        }
        loop {
            let next = {
                let mut g = self.inner.lock().unwrap();
                g.take_next_conversion()
            };
            match next {
                Some((job, format)) => self.spawn_conversion(job, format),
                None => break,
            }
        }
    }

    fn spawn_packing(&self, job: Job) {
        let manager = self.clone();
        let inner = self.inner.clone();
        let app = self.app.clone();
        let job_id = job.job_id.clone();
        let cancel = self
            .inner
            .lock()
            .unwrap()
            .active
            .get(&job_id)
            .map(|a| a.cancel.clone())
            .unwrap_or_else(|| Arc::new(AtomicBool::new(false)));
        self.emit_update(&job);

        tauri::async_runtime::spawn_blocking(move || {
            let mut on_progress = |pct: u32| {
                if let Ok(mut g) = inner.lock() {
                    if let Some(active) = g.active.get_mut(&job_id) {
                        if let Some(sub) = active
                            .job
                            .sub_tasks
                            .iter_mut()
                            .find(|s| s.format == "cbz")
                        {
                            sub.progress = pct.min(100) as u8;
                        }
                        let payload = JobUpdatePayload::from(&active.job);
                        let _ = app.emit("job:update", payload);
                    }
                }
            };
            let result = pack::pack_cbz(&job, &mut on_progress, &cancel);
            manager.finish_packing(&job_id, result);
        });
    }

    fn spawn_conversion(&self, job: Job, format: String) {
        let manager = self.clone();
        let inner = self.inner.clone();
        let app = self.app.clone();
        let job_id = job.job_id.clone();
        let cancel = self
            .inner
            .lock()
            .unwrap()
            .active
            .get(&job_id)
            .map(|a| a.cancel.clone())
            .unwrap_or_else(|| Arc::new(AtomicBool::new(false)));

        tauri::async_runtime::spawn_blocking(move || {
            let current = inner
                .lock()
                .unwrap()
                .active
                .get(&job_id)
                .map(|a| a.job.clone());
            let Some(current) = current else { return };

            let source = if current.formats.iter().any(|f| f == "cbz") {
                current
                    .results
                    .iter()
                    .find(|r| r.format == "cbz")
                    .map(|r| r.path.clone())
                    .unwrap_or_default()
            } else {
                current.folder_path.clone()
            };
            let calibre = current.calibre_path.clone().unwrap_or_default();
            let log_path = if current.keep_logs {
                logs::create_log(&current.comic_name, &format).ok()
            } else {
                None
            };
            let fmt = format.clone();
            let mut on_progress = |p: ConvertProgress| {
                if let Ok(mut g) = inner.lock() {
                    if let Some(active) = g.active.get_mut(&job_id) {
                        if let Some(percent) = p.percent {
                            if let Some(sub) = active
                                .job
                                .sub_tasks
                                .iter_mut()
                                .find(|s| s.format == fmt)
                            {
                                sub.progress = percent.min(100) as u8;
                            }
                        }
                        let payload = JobUpdatePayload::from(&active.job);
                        let _ = app.emit("job:update", payload);
                    }
                }
                if let Some(chunk) = p.chunk {
                    let _ = app.emit(
                        "job:log",
                        JobLogPayload {
                            job_id: job_id.clone(),
                            chunk,
                            is_error: p.is_error,
                        },
                    );
                }
            };

            let result = if calibre.is_empty() {
                Err(AppError::custom(
                    "E_CALIBRE_NOT_FOUND",
                    "未检测到 Calibre，无法转换该格式",
                ))
            } else if source.is_empty() {
                Err(AppError::custom("E_CBZ_MISSING", "CBZ 文件不存在"))
            } else {
                convert::convert(
                    &current,
                    &format,
                    &calibre,
                    &source,
                    log_path.as_deref(),
                    &mut on_progress,
                    &cancel,
                )
            };
            manager.finish_conversion(&job_id, &format, result);
        });
    }

    fn finish_packing(&self, job_id: &str, result: Result<JobResult, AppError>) {
        let finished: Option<Job> = {
            let mut g = self.inner.lock().unwrap();
            let Some(active) = g.active.get_mut(job_id) else { return };
            match result {
                Ok(r) => {
                    if let Some(sub) = active
                        .job
                        .sub_tasks
                        .iter_mut()
                        .find(|s| s.format == "cbz")
                    {
                        sub.status = SubTaskStatus::Done;
                        sub.progress = 100;
                    }
                    active.job.results.push(r);
                }
                Err(e) => {
                    active.job.error = Some(e.to_string());
                    if let Some(sub) = active
                        .job
                        .sub_tasks
                        .iter_mut()
                        .find(|s| s.format == "cbz")
                    {
                        sub.status = SubTaskStatus::Failed;
                        sub.error = Some(e.to_string());
                    }
                }
            }
            let pending = active
                .job
                .sub_tasks
                .iter()
                .any(|s| s.format != "cbz" && s.status == SubTaskStatus::Pending);
            let payload = JobUpdatePayload::from(&active.job);
            let _ = self.app.emit("job:update", payload);
            if pending {
                None
            } else {
                Some(active.job.clone())
            }
        };
        if let Some(job) = finished {
            self.finalize_job(job);
        }
        self.tick();
    }

    fn finish_conversion(
        &self,
        job_id: &str,
        format: &str,
        result: Result<convert::ConvertOutcome, AppError>,
    ) {
        let finished: Option<Job> = {
            let mut g = self.inner.lock().unwrap();
            let Some(active) = g.active.get_mut(job_id) else { return };
            match result {
                Ok(outcome) => {
                    if outcome.ok {
                        if let Some(sub) = active
                            .job
                            .sub_tasks
                            .iter_mut()
                            .find(|s| s.format == format)
                        {
                            sub.status = SubTaskStatus::Done;
                            sub.progress = 100;
                        }
                        active.job.results.push(JobResult {
                            format: format.to_string(),
                            path: outcome.path,
                            renamed: outcome.renamed,
                            log_path: outcome.log_path,
                        });
                    } else {
                        let msg = format!(
                            "Calibre 转换失败，退出码 {}",
                            outcome.exit_code.unwrap_or(-1)
                        );
                        if let Some(sub) = active
                            .job
                            .sub_tasks
                            .iter_mut()
                            .find(|s| s.format == format)
                        {
                            sub.status = SubTaskStatus::Failed;
                            sub.error = Some(msg.clone());
                        }
                        active.job.error = Some(msg);
                    }
                }
                Err(e) => {
                    if let Some(sub) = active
                        .job
                        .sub_tasks
                        .iter_mut()
                        .find(|s| s.format == format)
                    {
                        sub.status = SubTaskStatus::Failed;
                        sub.error = Some(e.to_string());
                    }
                }
            }
            let any_running = active
                .job
                .sub_tasks
                .iter()
                .any(|s| s.format != "cbz" && s.status == SubTaskStatus::Running);
            let any_pending = active
                .job
                .sub_tasks
                .iter()
                .any(|s| s.format != "cbz" && s.status == SubTaskStatus::Pending);
            let payload = JobUpdatePayload::from(&active.job);
            let _ = self.app.emit("job:update", payload);
            if any_running || any_pending {
                None
            } else {
                Some(active.job.clone())
            }
        };
        if let Some(job) = finished {
            self.finalize_job(job);
        }
        self.tick();
    }

    fn finalize_job(&self, mut job: Job) {
        job.finished_at = Some(now_ms());
        job.status = if job
            .sub_tasks
            .iter()
            .any(|s| s.status == SubTaskStatus::Failed)
        {
            JobStatus::Failed
        } else {
            JobStatus::Done
        };
        {
            let mut g = self.inner.lock().unwrap();
            g.active.remove(&job.job_id);
            g.results.insert(job.job_id.clone(), job.clone());
        }
        self.emit_result(&job);
    }

    fn emit_update(&self, job: &Job) {
        let _ = self.app.emit("job:update", JobUpdatePayload::from(job));
    }

    fn emit_result(&self, job: &Job) {
        let _ = self.app.emit("job:result", JobResultPayload::from(job));
    }
}

impl JobManagerInner {
    fn packing_count(&self) -> usize {
        self.active
            .values()
            .filter(|a| a.job.status == JobStatus::Packing)
            .count()
    }

    fn take_next_packing(&mut self) -> Option<Job> {
        let job = self.queue.pop_front()?;
        let cancel = Arc::new(AtomicBool::new(false));
        let mut job = job;
        if job.formats.iter().any(|f| f == "cbz") {
            job.status = JobStatus::Packing;
            self.active.insert(job.job_id.clone(), ActiveJob { job: job.clone(), cancel });
            Some(job)
        } else {
            job.status = JobStatus::Converting;
            self.active.insert(job.job_id.clone(), ActiveJob { job: job.clone(), cancel });
            None
        }
    }

    fn take_next_conversion(&mut self) -> Option<(Job, String)> {
        let running = self
            .active
            .values()
            .filter(|a| {
                a.job
                    .sub_tasks
                    .iter()
                    .any(|s| s.format != "cbz" && s.status == SubTaskStatus::Running)
            })
            .count();
        if running >= self.max_converting {
            return None;
        }
        let ids: Vec<String> = self.active.keys().cloned().collect();

        let pick = |g: &mut Self, prefer_mid: bool| -> Option<(Job, String)> {
            for id in &ids {
                let Some(active) = g.active.get_mut(id) else { continue };
                if !is_conversion_ready(&active.job) {
                    continue;
                }
                let mid = active.job.sub_tasks.iter().any(|s| {
                    s.format != "cbz"
                        && (s.status == SubTaskStatus::Done
                            || s.status == SubTaskStatus::Failed)
                });
                if prefer_mid && !mid {
                    continue;
                }
                if let Some(sub) = active
                    .job
                    .sub_tasks
                    .iter_mut()
                    .find(|s| s.format != "cbz" && s.status == SubTaskStatus::Pending)
                {
                    sub.status = SubTaskStatus::Running;
                    let fmt = sub.format.clone();
                    active.job.status = JobStatus::Converting;
                    return Some((active.job.clone(), fmt));
                }
            }
            None
        };

        if let Some(picked) = pick(self, true) {
            return Some(picked);
        }
        pick(self, false)
    }
}

fn is_conversion_ready(job: &Job) -> bool {
    if job
        .sub_tasks
        .iter()
        .any(|s| s.format != "cbz" && s.status == SubTaskStatus::Running)
    {
        return false;
    }
    if !job
        .sub_tasks
        .iter()
        .any(|s| s.format != "cbz" && s.status == SubTaskStatus::Pending)
    {
        return false;
    }
    if job.formats.iter().any(|f| f == "cbz")
        && !job.results.iter().any(|r| r.format == "cbz")
    {
        return false;
    }
    true
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
