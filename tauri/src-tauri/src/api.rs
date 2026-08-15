use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Zip(#[from] zip::result::ZipError),
    #[error(transparent)]
    Image(#[from] image::ImageError),
    #[error("{code}: {message}")]
    Custom {
        code: &'static str,
        message: String,
    },
}

impl AppError {
    pub fn custom(code: &'static str, message: impl Into<String>) -> Self {
        Self::Custom {
            code,
            message: message.into(),
        }
    }

    pub fn code(&self) -> String {
        match self {
            AppError::Io(_) => "E_IO".into(),
            AppError::Json(_) => "E_JSON".into(),
            AppError::Zip(_) => "E_ZIP".into(),
            AppError::Image(_) => "E_IMAGE".into(),
            AppError::Custom { code, .. } => (*code).into(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiError {
    pub code: String,
    pub message: String,
    pub detail: Option<String>,
}

impl From<AppError> for ApiError {
    fn from(err: AppError) -> Self {
        Self {
            code: err.code(),
            message: err.to_string(),
            detail: None,
        }
    }
}
