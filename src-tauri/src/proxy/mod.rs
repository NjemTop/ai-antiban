pub mod hold_queue;
pub mod pac;
pub mod server;

use std::sync::Arc;
pub use hold_queue::{HoldQueue, HoldResolution, InterceptionAction, RiskInterceptPayload};
pub use pac::generate_pac_script;
pub use server::ProxyServer;
use crate::auditor::Auditor;
use crate::state::AppState;

#[derive(Clone)]
pub struct ProxyManager {
    pub server: Arc<ProxyServer>,
    pub hold_queue: Arc<HoldQueue>,
}

impl ProxyManager {
    pub async fn start(
        auditor: Auditor,
        state: AppState,
        app_handle: Option<tauri::AppHandle>,
    ) -> Result<Self, std::io::Error> {
        let hold_queue = Arc::new(HoldQueue::new());
        let server = Arc::new(
            ProxyServer::bind(auditor, state, Arc::clone(&hold_queue), app_handle).await?,
        );

        let srv = Arc::clone(&server);
        tokio::spawn(async move {
            srv.run().await;
        });

        Ok(Self { server, hold_queue })
    }
}
