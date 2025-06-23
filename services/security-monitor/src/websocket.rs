use axum::extract::ws::{Message, WebSocket};
use dashmap::DashMap;
use serde_json::json;
use std::sync::Arc;
use tokio::sync::broadcast;
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::models::{Alert, SecurityEvent};

pub struct WebSocketManager {
    connections: Arc<DashMap<String, broadcast::Sender<String>>>,
    event_broadcast: broadcast::Sender<String>,
    alert_broadcast: broadcast::Sender<String>,
}

impl WebSocketManager {
    pub fn new() -> Self {
        let (event_tx, _) = broadcast::channel(1000);
        let (alert_tx, _) = broadcast::channel(1000);
        
        Self {
            connections: Arc::new(DashMap::new()),
            event_broadcast: event_tx,
            alert_broadcast: alert_tx,
        }
    }

    pub async fn broadcast_event(&self, event: &SecurityEvent) {
        let message = json!({
            "type": "security_event",
            "data": event
        }).to_string();

        if let Err(e) = self.event_broadcast.send(message) {
            warn!("Failed to broadcast security event: {}", e);
        }
    }

    pub async fn broadcast_alert(&self, alert: Alert) {
        let message = json!({
            "type": "alert",
            "data": alert
        }).to_string();

        if let Err(e) = self.alert_broadcast.send(message) {
            warn!("Failed to broadcast alert: {}", e);
        }
    }

    pub async fn broadcast_metrics(&self, metrics: serde_json::Value) {
        let message = json!({
            "type": "metrics_update",
            "data": metrics
        }).to_string();

        // Send to all connected clients
        for connection in self.connections.iter() {
            if let Err(e) = connection.value().send(message.clone()) {
                warn!("Failed to send metrics to client {}: {}", connection.key(), e);
            }
        }
    }

    pub fn add_connection(&self, connection_id: String) -> broadcast::Receiver<String> {
        let (tx, rx) = broadcast::channel(100);
        self.connections.insert(connection_id.clone(), tx.clone());
        
        // Subscribe to global broadcasts
        let mut event_rx = self.event_broadcast.subscribe();
        let mut alert_rx = self.alert_broadcast.subscribe();
        let local_tx = tx.clone();
        
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    event_msg = event_rx.recv() => {
                        match event_msg {
                            Ok(msg) => {
                                if let Err(e) = local_tx.send(msg) {
                                    error!("Failed to forward event message: {}", e);
                                    break;
                                }
                            }
                            Err(e) => {
                                error!("Event broadcast receiver error: {}", e);
                                break;
                            }
                        }
                    }
                    alert_msg = alert_rx.recv() => {
                        match alert_msg {
                            Ok(msg) => {
                                if let Err(e) = local_tx.send(msg) {
                                    error!("Failed to forward alert message: {}", e);
                                    break;
                                }
                            }
                            Err(e) => {
                                error!("Alert broadcast receiver error: {}", e);
                                break;
                            }
                        }
                    }
                }
            }
        });
        
        rx
    }

    pub fn remove_connection(&self, connection_id: &str) {
        self.connections.remove(connection_id);
        info!("Removed WebSocket connection: {}", connection_id);
    }

    pub fn connection_count(&self) -> usize {
        self.connections.len()
    }
}

pub async fn handle_connection(mut socket: WebSocket, ws_manager: Arc<WebSocketManager>) {
    let connection_id = Uuid::new_v4().to_string();
    info!("New WebSocket connection: {}", connection_id);

    let mut rx = ws_manager.add_connection(connection_id.clone());

    // Send initial connection message
    let welcome_msg = json!({
        "type": "connection_established",
        "connection_id": connection_id,
        "timestamp": chrono::Utc::now()
    }).to_string();

    if socket.send(Message::Text(welcome_msg)).await.is_err() {
        error!("Failed to send welcome message to {}", connection_id);
        ws_manager.remove_connection(&connection_id);
        return;
    }

    loop {
        tokio::select! {
            // Handle incoming messages from client
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        if let Err(e) = handle_client_message(&text, &connection_id).await {
                            error!("Failed to handle client message: {}", e);
                        }
                    }
                    Some(Ok(Message::Close(_))) => {
                        info!("Client {} closed connection", connection_id);
                        break;
                    }
                    Some(Err(e)) => {
                        error!("WebSocket error for {}: {}", connection_id, e);
                        break;
                    }
                    None => {
                        info!("Client {} disconnected", connection_id);
                        break;
                    }
                    _ => {
                        // Ignore other message types (binary, ping, pong)
                    }
                }
            }
            // Handle outgoing messages from broadcasts
            broadcast_msg = rx.recv() => {
                match broadcast_msg {
                    Ok(msg) => {
                        if let Err(e) = socket.send(Message::Text(msg)).await {
                            error!("Failed to send broadcast message to {}: {}", connection_id, e);
                            break;
                        }
                    }
                    Err(e) => {
                        error!("Broadcast receiver error for {}: {}", connection_id, e);
                        break;
                    }
                }
            }
        }
    }

    ws_manager.remove_connection(&connection_id);
}

async fn handle_client_message(message: &str, connection_id: &str) -> Result<(), Box<dyn std::error::Error>> {
    // Parse client message
    let parsed: serde_json::Value = serde_json::from_str(message)?;
    
    match parsed.get("type").and_then(|t| t.as_str()) {
        Some("ping") => {
            info!("Received ping from {}", connection_id);
            // Pong response would be sent here in a real implementation
        }
        Some("subscribe") => {
            if let Some(channel) = parsed.get("channel").and_then(|c| c.as_str()) {
                info!("Client {} subscribed to channel: {}", connection_id, channel);
                // Handle subscription logic here
            }
        }
        Some("unsubscribe") => {
            if let Some(channel) = parsed.get("channel").and_then(|c| c.as_str()) {
                info!("Client {} unsubscribed from channel: {}", connection_id, channel);
                // Handle unsubscription logic here
            }
        }
        _ => {
            warn!("Unknown message type from {}: {}", connection_id, message);
        }
    }
    
    Ok(())
}