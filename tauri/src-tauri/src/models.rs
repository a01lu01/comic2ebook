use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::settings::OverwritePolicy;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobInput {
    pub comic_id: String,
    pub comic_name: String,
    pub folder_path: String,
    pub output_dir: String,
    pub formats: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum JobStatus {
    Queued,
    Packing,
    Converting,
    Done,
    Failed,
    Cancelled,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum SubTaskStatus {
    Pending,
    Running,
    Done,
    Failed,
    Skipped,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubTask {
    pub format: String,
    pub status: SubTaskStatus,
    pub progress: u8,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobResult {
    pub format: String,
    pub path: String,
    pub renamed: Option<String>,
    pub log_path: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub job_id: String,
    pub comic_id: String,
    pub comic_name: String,
    pub folder_path: String,
    pub output_dir: String,
    pub formats: Vec<String>,
    pub profile: String,
    pub calibre_path: Option<String>,
    pub overwrite_policy: OverwritePolicy,
    pub timeout_secs: u64,
    pub keep_logs: bool,
    pub status: JobStatus,
    pub sub_tasks: Vec<SubTask>,
    pub results: Vec<JobResult>,
    pub error: Option<String>,
    pub created_at: u64,
    pub started_at: Option<u64>,
    pub finished_at: Option<u64>,
}

impl Job {
    pub fn new(
        input: JobInput,
        profile: String,
        calibre_path: Option<String>,
        overwrite_policy: OverwritePolicy,
        timeout_secs: u64,
        keep_logs: bool,
    ) -> Self {
        let now = now_ms();
        Self {
            job_id: Uuid::new_v4().to_string(),
            comic_id: input.comic_id,
            comic_name: input.comic_name,
            folder_path: input.folder_path,
            output_dir: input.output_dir,
            formats: input.formats,
            profile,
            calibre_path,
            overwrite_policy,
            timeout_secs,
            keep_logs,
            status: JobStatus::Queued,
            sub_tasks: Vec::new(),
            results: Vec::new(),
            error: None,
            created_at: now,
            started_at: Some(now),
            finished_at: None,
        }
    }

    pub fn rebuild_sub_tasks(&mut self) {
        self.sub_tasks = self
            .formats
            .iter()
            .map(|f| SubTask {
                format: f.clone(),
                status: SubTaskStatus::Pending,
                progress: 0,
                error: None,
            })
            .collect();
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobUpdatePayload {
    pub job_id: String,
    pub comic_name: String,
    pub status: JobStatus,
    pub sub_tasks: Vec<SubTask>,
    pub error: Option<String>,
}

impl From<&Job> for JobUpdatePayload {
    fn from(job: &Job) -> Self {
        Self {
            job_id: job.job_id.clone(),
            comic_name: job.comic_name.clone(),
            status: job.status.clone(),
            sub_tasks: job.sub_tasks.clone(),
            error: job.error.clone(),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobResultPayload {
    pub job_id: String,
    pub comic_name: String,
    pub status: JobStatus,
    pub results: Vec<JobResult>,
    pub error: Option<String>,
}

impl From<&Job> for JobResultPayload {
    fn from(job: &Job) -> Self {
        Self {
            job_id: job.job_id.clone(),
            comic_name: job.comic_name.clone(),
            status: job.status.clone(),
            results: job.results.clone(),
            error: job.error.clone(),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobLogPayload {
    pub job_id: String,
    pub chunk: String,
    pub is_error: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComicPreview {
    pub path: String,
    pub name: String,
    pub image_count: usize,
    pub main_ext: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalibreStatus {
    pub found: bool,
    pub path: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogContent {
    pub path: String,
    pub content: String,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
