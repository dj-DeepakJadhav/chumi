# Security and privacy

Chumi is a local prototype. The HTTP server binds to 127.0.0.1 and checks Host and Origin on controller requests. Do not expose it through a tunnel, public network interface or shared hosting without a separate deployment review.

`.env` and `.local/` are ignored by Git. OAuth access/refresh tokens and the private controller URL belong there. The controller token is generated at server start; authenticated actions require its header. Server startup writes local files with restricted Unix permissions. Windows file permissions follow the account and directory ACLs; do not put credentials in a shared folder.

The browser keeps the controller credential in session storage. This is a local trusted-machine design, not an authentication design for a hosted multi-user application.

Camera frames and landmark inference stay in the browser. Twitch processes OAuth and chat messages. Public state includes viewer display names associated with interactions, so avoid exposing the local server or recording information you do not want shared.

Never post a credential in a GitHub issue. If one is exposed, revoke it at the provider and reauthorize. Deleting the visible file does not remove it from Git history.
